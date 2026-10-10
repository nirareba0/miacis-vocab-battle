-- 0036: 英単語バトルを「LINE で参加」「中高生／それ以外」に（2026-10-10 本人「問いサイトや英単語バトルも同じような形式にしていきたい」
--   → 英単語バトルから、① LINE で参加 ② 中高生／それ以外。設計は AIOS core/projects/miacis/specs/vocab-line-login-20261010.md）
--   - players.account_type に 'adult'（それ以外。学年なし）。景品・称号・抽選・週の賞はもともと 'student' だけなので、おとなは入らない
--     ガチャの抽選券と景品の率は、スタッフと同じく 0 にする（'staff' → 'student' 以外）
--   - ランキングのビューは、おとなを別の順位にして末尾に is_adult を足す（画面で 中高生／おとな を切り替える）
--   - おとなのレベルは最初から受験レベル（band 4）まで開く（中高生の学年の開き方 0027 の高3 と同じ）
--   - line_links: LINE の ID（クイズと同じ LINE ログインのチャネル）↔ Auth のユーザー。1つの LINE に1人
--     はじめての人は Edge Function line-login が Auth のユーザーを作り、line_register で players と line_links を同時に入れる
--     前から遊んでいる人は、いつものニックネームとあいことばでログインしてから line_link でつなぐ
begin;

-- 1. おとな
alter table public.players drop constraint players_account_type_check;
alter table public.players add constraint players_account_type_check check (account_type in ('student', 'staff', 'adult'));
alter table public.players drop constraint players_account_grade_check;
alter table public.players add constraint players_account_grade_check check (
  (account_type = 'student' and grade is not null and grade between 1 and 6)
  or (account_type in ('staff', 'adult') and grade is null));

-- 登録の中身（ニックネームの検査・学年・重複）。学年が null ならおとな
create or replace function public.register_player_core(p_uid uuid, p_nickname text, p_grade int)
returns public.players as $$
declare
  v_clean_nick text;
  v_player public.players;
begin
  v_clean_nick := trim(p_nickname);
  if v_clean_nick is null or length(v_clean_nick) < 1 or length(v_clean_nick) > 10 then
    raise exception 'invalid_nickname_length';
  end if;
  if v_clean_nick ~ '[\x00-\x1F\x7F]' then
    raise exception 'invalid_nickname_control_chars';
  end if;
  if p_grade is not null and (p_grade < 1 or p_grade > 6) then
    raise exception 'invalid_grade';
  end if;
  if exists (select 1 from public.players where nickname = v_clean_nick) then
    raise exception 'nickname_taken';
  end if;

  insert into public.players (id, nickname, grade, account_type, tier, is_picker, created_at, last_active_at)
  values (p_uid, v_clean_nick, p_grade, case when p_grade is null then 'adult' else 'student' end, 1, false, public.jst_now(), public.jst_now())
  returning * into v_player;
  return v_player;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function public.register_player_core(uuid, text, int) from public, anon, authenticated;

-- ニックネーム＋あいことばの登録（0005 と同じ。学年を null で送るとおとな）
create or replace function public.register_player(p_nickname text, p_grade int, p_invite_code text)
returns public.players as $$
declare
  v_uid uuid;
  v_player public.players;
  v_stored_code text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_player from public.players where id = v_uid;
  if found then
    return v_player;
  end if;

  -- 合言葉が設定されているときだけ検査する（未設定なら誰でも登録できる）
  select value into v_stored_code from public.app_settings where key = 'invite_code';
  if found and v_stored_code is not null and trim(v_stored_code) <> '' then
    if p_invite_code is null or lower(trim(p_invite_code)) <> lower(trim(v_stored_code)) then
      raise exception 'invite_invalid';
    end if;
  end if;

  return public.register_player_core(v_uid, p_nickname, p_grade);
end;
$$ language plpgsql security definer set search_path = public;

-- おとなは最初から受験レベル（band 4）まで。最難関（5）は全員 20 連続で
create or replace function public.stage_unlocked(p_player_id uuid, p_band int)
returns boolean as $$
  select p_band <= 1
    or exists (select 1 from public.players where id = p_player_id and account_type = 'staff')
    or p_band <= coalesce((select case when account_type = 'adult' then 4 else public.grade_open_band(grade) end
                           from public.players where id = p_player_id), 1)
    or coalesce((select max(correct) from public.runs
                 where player_id = p_player_id and mode = 'streak' and status = 'finished' and band = p_band - 1), 0)
       >= public.setting_num('stage_unlock_correct', 20)::int;
$$ language sql stable security definer set search_path = public;
revoke all on function public.stage_unlocked(uuid, int) from public, anon, authenticated;

-- ガチャ: 抽選券と景品は中高生だけ（0021・0016 の 'staff' を 'student' 以外に）
create or replace function public.pull_gacha(p_count int)
returns jsonb as $$
declare
  v_uid uuid;
  v_cost int;
  v_balance int;
  v_shards_balance int;
  v_prize_rate numeric;
  v_results jsonb := '[]'::jsonb;
  v_has_sr_or_above boolean := false;
  v_has_prize boolean := false;
  v_prize public.prizes;
  v_ticket_id uuid;
  v_item public.items;
  v_rnd double precision;
  v_target_rarity smallint;
  v_existing_count int;
  v_is_new boolean;
  v_shard_gain int;
  v_total int;
  v_raffle_rate numeric;
  v_has_raffle boolean := false;
  v_raffle_no int;
  v_month date;
  i int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_count not in (1, 10) then
    raise exception 'invalid_pull_count';
  end if;

  -- p_count = 10 は「まとめ引き」の合図（端末との約束を変えないため数字はそのまま）。
  -- 出てくる数は pull10_count（既定 11 = 10回ぶんの値段で1回おまけ）
  if p_count = 1 then
    v_cost := public.setting_num('pull_cost', 5)::int;
    v_total := 1;
  else
    v_cost := public.setting_num('pull10_cost', 50)::int;
    v_total := greatest(10, public.setting_num('pull10_count', 11)::int);
  end if;

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  if v_balance < v_cost then
    raise exception 'not_enough_nuts';
  end if;

  -- Serialize this player's balance and the shared weekly prize quota.
  perform 1 from public.players where id=v_uid for update;
  perform pg_advisory_xact_lock(73421,public.jst_week_start()-date '2000-01-01');
  -- 木の実を消費
  perform public.add_nuts(v_uid, -v_cost, 'gacha', p_count::text || '_' || gen_random_uuid()::text);

  -- 実物景品は直接当たらない。代わりに「抽選券」が出て、月末の抽選で当たる（券が多いほど当たりやすい）
  v_raffle_rate := greatest(0, least(1, public.setting_num('raffle_rate', 0.10)));
  if exists(select 1 from public.players where id=v_uid and account_type<>'student') then v_raffle_rate := 0; end if;
  v_month := date_trunc('month', public.jst_today())::date;

  for i in 1..v_total loop
    -- 1. 抽選券（まとめ引きは 10 回目で未入手なら確定。最後の 1 回は SR 以上確定のために空けておく）
    v_prize := null;
    if v_raffle_rate > 0 and (
         (random() < v_raffle_rate and (p_count = 1 or i < v_total))
         or (p_count = 10 and i = v_total - 1 and not v_has_raffle)
       ) then
      insert into public.raffle_entries (player_id, month, source, ref)
      values (v_uid, v_month, 'gacha', gen_random_uuid()::text)
      returning no into v_raffle_no;
      v_has_raffle := true;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'kind', 'raffle',
        'name', '抽選券',
        'slot', null,
        'rarity', 3,
        'display', jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'no', v_raffle_no),
        'no', v_raffle_no,
        'is_new', false,
        'shards', 0,
        'ticket_id', null
      ));
      continue;
    end if;

    -- 着せ替え・称号の抽選
    if true then
      -- SECRET（ネコ・イヌのすがた など）: 超低確率。SR以上保証の枠でも同じ確率で出る
      if random() < greatest(0, least(1, public.setting_num('secret_rate', 0.003))) then
        v_target_rarity := 5;
      -- まとめ引きのSR以上保証: 最後の1回でまだSR以上が出ていなければSR以上から選出
      elsif p_count = 10 and i = v_total and not v_has_sr_or_above then
        if random() < 0.875 then
          v_target_rarity := 3;
        else
          v_target_rarity := 4;
        end if;
      else
        v_rnd := random();
        if v_rnd < 0.70 then
          v_target_rarity := 1;
        elsif v_rnd < 0.92 then
          v_target_rarity := 2;
        elsif v_rnd < 0.99 then
          v_target_rarity := 3;
        else
          v_target_rarity := 4;
        end if;
      end if;

      if v_target_rarity >= 3 then
        v_has_sr_or_above := true;
      end if;

      select * into v_item
      from public.items
      where active = true and source = 'gacha' and rarity = v_target_rarity
      order by random()
      limit 1;

      if not found then
        select * into v_item from public.items where active = true and source = 'gacha' order by random() limit 1;
      end if;

      -- 重なり判定 & かけら付与
      select count into v_existing_count
      from public.player_items
      where player_id = v_uid and item_id = v_item.id;

      if not found then
        v_is_new := true;
        v_shard_gain := 0;
        insert into public.player_items (player_id, item_id, count, first_at)
        values (v_uid, v_item.id, 1, public.jst_now());
      else
        v_is_new := false;
        v_shard_gain := case v_item.rarity
          when 1 then 1
          when 2 then 3
          when 3 then 10
          when 4 then 30
          when 5 then 100
          else 0
        end;

        update public.player_items
        set count = count + 1
        where player_id = v_uid and item_id = v_item.id;

        if v_shard_gain > 0 then
          insert into public.player_shards (player_id, amount)
          values (v_uid, v_shard_gain)
          on conflict (player_id) do update set amount = public.player_shards.amount + excluded.amount;
        end if;
      end if;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'kind', 'item',
        'id', v_item.id,
        'name', v_item.name,
        'slot', v_item.slot,
        'rarity', v_item.rarity,
        'display', v_item.display,
        'is_new', v_is_new,
        'shards', v_shard_gain,
        'ticket_id', null
      ));
    end if;
  end loop;

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  select coalesce(amount, 0) into v_shards_balance
  from public.player_shards
  where player_id = v_uid;

  return jsonb_build_object(
    'results', v_results,
    'spent_nuts', v_cost,
    'count', v_total,
    'raffle_entries_month', (select count(*) from public.raffle_entries where player_id = v_uid and month = v_month),
    'balance', v_balance,
    'shards_balance', v_shards_balance
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.gacha_rates() returns jsonb as $$
declare v_prizes jsonb; v_rate numeric; v_staff boolean;
begin
 v_staff:=exists(select 1 from public.players where id=auth.uid() and account_type<>'student');
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'stock',p.stock) order by p.created_at),'[]'::jsonb)
 into v_prizes from public.prizes p where p.reward_channel='raffle' and p.active and p.stock>0;
 v_rate:=0;
 return jsonb_build_object('prize_rate',case when v_staff or jsonb_array_length(v_prizes)=0 then 0 else v_rate end,'configured_prize_rate',v_rate,
 'prizes',case when v_staff then '[]'::jsonb else v_prizes end,'staff_mode',v_staff,'weekly_limit',1,
 'weekly_remaining',case when exists(select 1 from public.weekly_prize_awards where week_start=public.jst_week_start() and channel='gacha') then 0 else 1 end,
 'item_rates',jsonb_build_object('N',0.70,'R',0.22,'SR',0.07,'UR',0.01,'SECRET',greatest(0,least(1,public.setting_num('secret_rate',0.003)))),
 'pull_cost',public.setting_num('pull_cost',5)::int,'pull10_cost',public.setting_num('pull10_cost',50)::int,
 'pull10_count',greatest(10,public.setting_num('pull10_count',11)::int),
 'raffle_rate',case when v_staff then 0 else greatest(0,least(1,public.setting_num('raffle_rate',0.10))) end,
 'raffle_month',to_char(date_trunc('month',public.jst_today()),'YYYY-MM'),
 'raffle_total_entries',(select count(*) from public.raffle_entries e join public.players p on p.id=e.player_id where e.month=date_trunc('month',public.jst_today())::date and p.account_type='student'),
 'raffle_my_entries',(select count(*) from public.raffle_entries where player_id=auth.uid() and month=date_trunc('month',public.jst_today())::date));
end; $$ language plpgsql stable security definer set search_path=public;

-- 2. ランキング（おとなは別の順位）
create or replace view public.ranking_learn_week as
with weekly_lp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    p.account_type,
    p.staff_label,
    coalesce(sum(pt.amount), 0)::int as learn_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'learn'
    and pt.week_start = public.jst_week_start()
  group by p.id, p.tier, p.nickname, p.account_type, p.staff_label
)
select
  tier,
  nickname,
  learn_points,
  rank() over (partition by tier, account_type = 'adult' order by learn_points desc, nickname asc)::int as rank,
  (account_type = 'staff') as is_staff,
  staff_label,
  (account_type = 'adult') as is_adult
from weekly_lp
order by tier asc, rank asc, nickname asc;

create or replace view public.ranking_commit_week as
with weekly_cp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    p.account_type,
    p.staff_label,
    coalesce(sum(pt.amount), 0)::int as commit_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'commit'
    and pt.week_start = public.jst_week_start()
  group by p.id, p.tier, p.nickname, p.account_type, p.staff_label
)
select
  nickname,
  tier,
  commit_points,
  rank() over (partition by account_type = 'adult' order by commit_points desc, nickname asc)::int as rank,
  (account_type = 'staff') as is_staff,
  staff_label,
  (account_type = 'adult') as is_adult
from weekly_cp
order by rank asc, nickname asc;

create or replace view public.ranking_knock_week as
with best as (
  select distinct on (r.player_id, r.band)
    r.player_id, r.band, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'knock'
    and r.status = 'finished'
    and r.end_reason = 'complete'
    and r.week_start = public.jst_week_start()
  order by r.player_id, r.band, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  b.band,
  p.nickname,
  p.tier,
  b.correct as best_correct,
  b.total_ms,
  rank() over (partition by b.band, p.account_type = 'adult' order by b.correct desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff,
  p.staff_label,
  (p.account_type = 'adult') as is_adult
from best b
join public.players p on p.id = b.player_id
order by band asc, rank asc, nickname asc;

create or replace view public.ranking_streak_week as
with best as (
  select distinct on (r.player_id, r.band)
    r.player_id, r.band, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.week_start = public.jst_week_start()
    and r.correct > 0
    and r.band is not null
  order by r.player_id, r.band, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.correct as best_streak,
  b.total_ms,
  rank() over (partition by b.band, p.account_type = 'adult' order by b.correct desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff,
  b.band,
  p.staff_label,
  (p.account_type = 'adult') as is_adult
from best b
join public.players p on p.id = b.player_id
order by band asc, rank asc, nickname asc;

create or replace view public.ranking_streak_all as
with best as (
  select distinct on (r.player_id, r.band)
    r.player_id, r.band, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.correct > 0
    and r.band is not null
  order by r.player_id, r.band, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.correct as best_streak,
  b.total_ms,
  rank() over (partition by b.band, p.account_type = 'adult' order by b.correct desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff,
  b.band,
  p.staff_label,
  (p.account_type = 'adult') as is_adult
from best b
join public.players p on p.id = b.player_id
order by band asc, rank asc, nickname asc;


-- 3. LINE
create table public.line_links (
  line_sub text primary key check (char_length(line_sub) between 1 and 100),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.line_links enable row level security;
revoke all on public.line_links from anon, authenticated;

-- Edge Function（service_role）から: LINE の ID トークンを確かめ、つながっている Auth のユーザーを返す
create or replace function public.line_lookup(p_id_token text)
returns jsonb as $$
declare
  v_sub text := public.quiz_line_verify(p_id_token);
begin
  return jsonb_build_object('sub', v_sub,
    'user_id', (select user_id from public.line_links where line_sub = v_sub));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- Edge Function（service_role）から: はじめての人の players と line_links を同時に入れる
create or replace function public.line_register(p_sub text, p_user uuid, p_nickname text, p_grade int)
returns public.players as $$
declare
  v_player public.players;
begin
  if exists (select 1 from public.line_links where line_sub = p_sub) then
    raise exception 'line_already_linked';
  end if;
  v_player := public.register_player_core(p_user, p_nickname, p_grade);
  insert into public.line_links (line_sub, user_id) values (p_sub, p_user);
  return v_player;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.line_lookup(text), public.line_register(text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.line_lookup(text), public.line_register(text, uuid, text, int) to service_role;

-- 前から遊んでいる人: ログインしたまま、LINE の ID トークンを送ってつなぐ（1回だけ。次からは LINE で開くだけ）
create or replace function public.line_link(p_id_token text)
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_sub text;
  v_other uuid;
begin
  if v_uid is null or not exists (select 1 from public.players where id = v_uid) then
    raise exception 'not_authenticated';
  end if;
  v_sub := public.quiz_line_verify(p_id_token);
  select user_id into v_other from public.line_links where line_sub = v_sub;
  if v_other = v_uid then
    return jsonb_build_object('linked', true);
  elsif v_other is not null then
    raise exception 'line_already_linked';
  end if;
  if exists (select 1 from public.line_links where user_id = v_uid) then
    raise exception 'account_already_linked';
  end if;
  insert into public.line_links (line_sub, user_id) values (v_sub, v_uid);
  return jsonb_build_object('linked', true);
end;
$$ language plpgsql volatile security definer set search_path = public;

-- 自分の LINE がつながっているか（自分の画面に出す）
create or replace function public.my_line_linked()
returns boolean as $$
  select exists (select 1 from public.line_links where user_id = auth.uid());
$$ language sql stable security definer set search_path = public;

revoke execute on function public.line_link(text), public.my_line_linked() from public, anon, authenticated;
grant execute on function public.line_link(text), public.my_line_linked() to authenticated;

commit;
