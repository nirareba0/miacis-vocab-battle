-- 0011_raffle_tuning.sql: 抽選券・難度の平地・木の実の素点・称号・スタッフの設定変更（2026-10-02 本人）
-- 元: core/projects/miacis/specs/sakurai-principles-applied-20261002.md の B1/B2/B5/B8 と、景品の抽選券化
begin;

-- 1. 設定
insert into public.app_settings (key, value) values
  ('raffle_rate', '0.10'),        -- ガチャ1回で抽選券が出る確率（11連の最後は未入手なら確定）
  ('nut_score_per_nut', '25')     -- 木の実の素点 25 で 1 個
on conflict (key) do nothing;
update public.app_settings set value = '0' where key = 'prize_rate';   -- 実物景品はガチャで直接当たらない

-- 2. 抽選券
create table public.raffle_entries (
  id bigserial primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  month date not null,            -- その月の 1 日（JST）
  source text not null,           -- 'gacha' ほか
  ref text,
  created_at timestamptz not null default public.jst_now(),
  unique (player_id, source, ref)
);
create index idx_raffle_entries_month on public.raffle_entries(month, player_id);
alter table public.raffle_entries enable row level security;
create policy "raffle_entries_select_own" on public.raffle_entries for select using (player_id = auth.uid());

create table public.raffle_results (
  month date not null,
  prize_id uuid not null references public.prizes(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  ticket_id uuid references public.prize_tickets(id) on delete set null,
  total_entries int not null,
  winner_entries int not null,
  drawn_at timestamptz not null default public.jst_now(),
  primary key (month, prize_id)
);
alter table public.raffle_results enable row level security;

alter table public.prizes drop constraint if exists prizes_reward_channel_check;
alter table public.prizes add constraint prizes_reward_channel_check check (reward_channel in ('gacha','ranking','raffle'));
alter table public.prizes alter column reward_channel set default 'raffle';   -- スタッフ画面から足す景品は月末抽選の景品
update public.prizes set active = false where reward_channel = 'gacha';          -- ガチャ直当ての景品は止める

-- 月末抽選。券の枚数 = くじの本数。景品ごとに 1 人（同じ月に同じ人が 2 つ当たらない）
create or replace function public.draw_monthly_raffle(p_month date)
returns jsonb as $$
declare
  v_prize public.prizes;
  v_total int;
  v_winner uuid;
  v_winner_entries int;
  v_ticket uuid;
  v_out jsonb := '[]'::jsonb;
begin
  if p_month <> date_trunc('month', p_month)::date then
    raise exception 'invalid_month';
  end if;
  if p_month >= date_trunc('month', public.jst_today())::date then
    raise exception 'month_not_closed';
  end if;

  perform pg_advisory_xact_lock(73422, (p_month - date '2000-01-01'));

  for v_prize in
    select * from public.prizes
    where reward_channel = 'raffle' and active and stock > 0
    order by created_at, id
    for update
  loop
    if exists (select 1 from public.raffle_results where month = p_month and prize_id = v_prize.id) then
      continue;
    end if;

    select count(*) into v_total
    from public.raffle_entries e join public.players p on p.id = e.player_id
    where e.month = p_month and p.account_type = 'student'
      and e.player_id not in (select player_id from public.raffle_results where month = p_month and player_id is not null);

    if v_total = 0 then
      continue;
    end if;

    select e.player_id into v_winner
    from public.raffle_entries e join public.players p on p.id = e.player_id
    where e.month = p_month and p.account_type = 'student'
      and e.player_id not in (select player_id from public.raffle_results where month = p_month and player_id is not null)
    order by random() limit 1;

    select count(*) into v_winner_entries from public.raffle_entries where month = p_month and player_id = v_winner;

    insert into public.prize_tickets (player_id, prize_id, won_at) values (v_winner, v_prize.id, public.jst_now()) returning id into v_ticket;
    update public.prizes set stock = stock - 1 where id = v_prize.id;
    insert into public.raffle_results (month, prize_id, player_id, ticket_id, total_entries, winner_entries)
    values (p_month, v_prize.id, v_winner, v_ticket, v_total, v_winner_entries);

    v_out := v_out || jsonb_build_array(jsonb_build_object('prize', v_prize.name, 'player_id', v_winner, 'total_entries', v_total, 'winner_entries', v_winner_entries));
  end loop;

  return v_out;
end;
$$ language plpgsql security definer set search_path = public;

-- pg_cron から毎日呼ぶ。JST の 1 日だけ前月分を抽選する
create or replace function public.draw_monthly_raffle_if_due()
returns jsonb as $$
begin
  if extract(day from public.jst_today()) <> 1 then
    return '[]'::jsonb;
  end if;
  return public.draw_monthly_raffle((date_trunc('month', public.jst_today()) - interval '1 month')::date);
end;
$$ language plpgsql security definer set search_path = public;

-- スタッフが手で抽選する（前月以前のみ）
create or replace function public.staff_draw_raffle(p_month date)
returns jsonb as $$
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  return public.draw_monthly_raffle(p_month);
end;
$$ language plpgsql security definer set search_path = public;

-- 自分の抽選券と、直近の結果（勝者はニックネームだけ）
create or replace function public.my_raffle()
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', public.jst_today())::date;
  v_prev date := (date_trunc('month', public.jst_today()) - interval '1 month')::date;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'),
    'my_entries', (select count(*) from public.raffle_entries where player_id = v_uid and month = v_month),
    'total_entries', (select count(*) from public.raffle_entries e join public.players p on p.id = e.player_id where e.month = v_month and p.account_type = 'student'),
    'holders', (select count(distinct e.player_id) from public.raffle_entries e join public.players p on p.id = e.player_id where e.month = v_month and p.account_type = 'student'),
    'prizes', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'description', description, 'stock', stock) order by created_at), '[]'::jsonb) from public.prizes where reward_channel = 'raffle' and active and stock > 0),
    'last_results', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(r.month, 'YYYY-MM'), 'prize', pr.name, 'nickname', p.nickname, 'is_me', r.player_id = v_uid, 'total_entries', r.total_entries, 'winner_entries', r.winner_entries) order by r.drawn_at desc), '[]'::jsonb)
                     from public.raffle_results r join public.prizes pr on pr.id = r.prize_id left join public.players p on p.id = r.player_id where r.month = v_prev)
  );
end;
$$ language plpgsql security definer set search_path = public;

-- 3. 称号（条件達成で入手。ガチャには出ない）
alter table public.items add column if not exists source text not null default 'gacha' check (source in ('gacha', 'achievement'));
insert into public.items (id, name, slot, rarity, display, active, source) values
  ('title_streak10',   '10連続サバイバー',     'title', 2, '{}'::jsonb, true, 'achievement'),
  ('title_streak20',   '20連続サバイバー',     'title', 3, '{}'::jsonb, true, 'achievement'),
  ('title_stage5',     'STAGE5 到達',          'title', 3, '{}'::jsonb, true, 'achievement'),
  ('title_comeback',   '逆転のサバイバー',     'title', 3, '{}'::jsonb, true, 'achievement'),
  ('title_knock_done', '100本 完走',           'title', 2, '{}'::jsonb, true, 'achievement'),
  ('title_knock_oni',  'ノックの鬼',           'title', 4, '{}'::jsonb, true, 'achievement')
on conflict (id) do nothing;

-- 4. 走行の素点
alter table public.runs add column if not exists nut_score int not null default 0;

create or replace function public.run_make_question(p_run public.runs)
returns jsonb as $$
declare
  v_stage int;
  v_range int;
  v_limit int;
  v_word public.words;
  v_dir text;
  v_correct text;
  v_distractors text[];
  v_choices text[] := '{}';
  v_answer_idx int;
begin
  if p_run.mode = 'streak' then
    v_stage := p_run.correct / 5 + 1;
    -- 段差の直後 2 問は 1 つ前の範囲（壁のあとに平地。桜井「単調な坂は山登りにならない」）。時間は新ステージのまま
    v_range := public.streak_range_of(case when v_stage > 1 and p_run.correct % 5 < 2 then v_stage - 1 else v_stage end);
    v_limit := public.streak_limit_ms(v_stage);

  else
    v_stage := p_run.answered / 10 + 1;   -- 100本ノックは10問ごとの区切りを表示に使うだけ
    v_range := null;
    v_limit := public.setting_num('knock_limit_ms', 6000)::int;

  end if;

  select w.* into v_word
  from public.words w
  join public.run_pool(p_run.mode, v_range, p_run.band) p on p.id = w.id
  where w.id <> all(p_run.used_word_ids)
  order by random()
  limit 1;

  if not found then
    -- 範囲を使い切ったら重複を許す
    select w.* into v_word
    from public.words w
    join public.run_pool(p_run.mode, v_range, p_run.band) p on p.id = w.id
    order by random()
    limit 1;
  end if;

  if not found then
    raise exception 'no_words';
  end if;

  v_dir := case when random() < 0.5 then 'en2ja' else 'ja2en' end;

  if v_dir = 'en2ja' then
    v_correct := v_word.ja;
    select array_agg(ja) into v_distractors from (
      select distinct ja from public.run_pool(p_run.mode, v_range, p_run.band) where ja <> v_correct order by ja
    ) d;
  else
    v_correct := v_word.en;
    select array_agg(en) into v_distractors from (
      select distinct en from public.run_pool(p_run.mode, v_range, p_run.band) where en <> v_correct order by en
    ) d;
  end if;

  select array_agg(x) into v_distractors from (
    select x from unnest(coalesce(v_distractors, '{}')) as x order by random() limit 3
  ) s;

  while coalesce(array_length(v_distractors, 1), 0) < 3 loop
    v_distractors := array_append(v_distractors, 'dummy_' || coalesce(array_length(v_distractors, 1), 0));
  end loop;

  v_answer_idx := floor(random() * 4)::int;
  for c_pos in 0..3 loop
    if c_pos = v_answer_idx then
      v_choices := array_append(v_choices, v_correct);
    else
      v_choices := array_append(v_choices, v_distractors[1]);
      v_distractors := v_distractors[2:];
    end if;
  end loop;

  return jsonb_build_object(
    'no', p_run.answered + 1,
    'stage', v_stage,
    'range', v_range,
    'limit_ms', v_limit,
    'word_id', v_word.id,
    'dir', v_dir,
    'prompt', case when v_dir = 'en2ja' then v_word.en else v_word.ja end,
    'choices', to_jsonb(v_choices),
    'answer_index', v_answer_idx,
    'issued_at', public.jst_now()
  );
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function public.answer_run(p_run_id uuid, p_choice int, p_ms int)
returns jsonb as $$
declare
  v_uid uuid;
  v_run public.runs;
  v_q jsonb;
  v_limit int;
  v_elapsed int;
  v_ms int;
  v_timeout boolean;
  v_correct boolean;
  v_answer_idx int;
  v_next jsonb;
  v_state text;
  v_result jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_run from public.runs where id = p_run_id for update;
  if not found then
    raise exception 'run_not_found';
  end if;
  if v_run.player_id <> v_uid then
    raise exception 'permission_denied';
  end if;
  if v_run.status <> 'active' or v_run.current is null then
    raise exception 'run_not_active';
  end if;

  v_q := v_run.current;
  v_limit := (v_q->>'limit_ms')::int;
  v_answer_idx := (v_q->>'answer_index')::int;
  v_elapsed := (extract(epoch from (public.jst_now() - (v_q->>'issued_at')::timestamptz)) * 1000)::int;

  -- 端末の時間は信用しすぎない: サーバーで測った時間より大きく短いことはありえない
  v_ms := greatest(0, least(v_limit, coalesce(p_ms, v_limit)));
  v_ms := greatest(v_ms, least(v_limit, v_elapsed - public.setting_num('run_grace_ms', 2500)::int));

  v_timeout := p_choice is null
    or p_ms is null
    or p_ms >= v_limit
    or v_elapsed > v_limit + public.setting_num('run_grace_ms', 2500)::int;
  v_correct := not v_timeout and p_choice = v_answer_idx;

  if v_correct then
    v_run.correct := v_run.correct + 1;
    v_run.total_ms := v_run.total_ms + v_ms;
    v_run.correct_word_ids := array_append(v_run.correct_word_ids, (v_q->>'word_id')::int);
    -- 木の実の素点: 基本 10、ステージが上がるほど +3、残り 30% を切ってからの正解に +5（桜井「どれぐらい良いことをした?」）
    v_run.nut_score := v_run.nut_score
      + 10
      + (case when v_run.mode = 'streak' then 3 * (coalesce((v_q->>'stage')::int, 1) - 1) else 0 end)
      + (case when v_ms >= v_limit * 0.7 then 5 else 0 end);
  else
    v_run.missed := v_run.missed || jsonb_build_array(jsonb_build_object(
      'word_id', v_q->'word_id',
      'prompt', v_q->'prompt',
      'correct_text', v_q->'choices'->v_answer_idx,
      'your_text', case when v_timeout then null else v_q->'choices'->p_choice end,
      'timeout', v_timeout
    ));
  end if;
  v_run.answered := v_run.answered + 1;
  v_run.used_word_ids := array_append(v_run.used_word_ids, (v_q->>'word_id')::int);

  if v_run.mode = 'streak' then
    if v_correct then
      v_state := 'next';
    elsif v_timeout and not v_run.revive_used then
      v_state := 'revive_offer';
    else
      v_state := 'finished';
    end if;
  else
    v_state := case when v_run.answered >= 100 then 'finished' else 'next' end;
  end if;

  if v_state = 'next' then
    v_next := public.run_make_question(v_run);
  end if;

  update public.runs
  set correct = v_run.correct,
      total_ms = v_run.total_ms,
      answered = v_run.answered,
      used_word_ids = v_run.used_word_ids,
      correct_word_ids = v_run.correct_word_ids,
      nut_score = v_run.nut_score,
      missed = v_run.missed,
      status = case when v_state = 'revive_offer' then 'revive_offer' else status end,
      current = case when v_state = 'next' then v_next
                     when v_state = 'revive_offer' then current || jsonb_build_object('offered_at', public.jst_now())
                     else current end
  where id = v_run.id;

  if v_state = 'finished' then
    v_result := public.run_finish(v_run.id,
      case when v_run.mode = 'knock' then 'complete'
           when v_timeout then 'timeout'
           else 'wrong' end);
  end if;

  return jsonb_build_object(
    'correct', v_correct,
    'timeout', v_timeout,
    'answer_index', v_answer_idx,
    'state', v_state,
    'answered', v_run.answered,
    'score', v_run.correct,
    'revive_used', v_run.revive_used,
    'question', public.run_client_question(v_next),
    'result', v_result
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.run_finish(p_run_id uuid, p_reason text)
returns jsonb as $$
declare
  v_run public.runs;
  v_learn int := 0;
  v_nuts_raw int := 0;
  v_nuts int := 0;
  v_commit int := 0;
  v_prev_best jsonb;
  v_prev_week_best jsonb;
  v_rank int;
  v_rival jsonb;
  v_me jsonb;
  v_is_student boolean;
  v_new_titles jsonb := '[]'::jsonb;
  v_t record;
begin
  select * into v_run from public.runs where id = p_run_id;

  if v_run.status = 'finished' then
    return public.run_result(v_run.id);
  end if;

  v_prev_best := public.run_best(v_run.player_id, v_run.mode, null);
  v_prev_week_best := public.run_best(v_run.player_id, v_run.mode, v_run.week_start);

  -- 学習ポイントは対戦と同じく「正解1問 = 1点」
  v_learn := v_run.correct;

  -- 木の実: 素点（nut_score。後半の正解・ギリギリの正解ほど高い）÷ 25。100本ノックは完走 +5、90問以上 +3
  v_nuts_raw := v_run.nut_score / public.setting_num('nut_score_per_nut', 25)::int;
  if v_run.mode = 'knock' then
    v_nuts_raw := v_nuts_raw
      + (case when p_reason = 'complete' then public.setting_num('knock_nuts_complete', 5)::int else 0 end)
      + (case when p_reason = 'complete' and v_run.correct >= 90 then public.setting_num('knock_nuts_90', 3)::int else 0 end);
  end if;

  if v_learn > 0 then
    insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
    values (v_run.player_id, 'learn', v_run.mode, v_learn, v_run.week_start, public.jst_today(), public.jst_now());
  end if;

  if v_run.answered > 0 then
    v_commit := public.add_commit(v_run.player_id, v_run.mode, 1);
  end if;

  v_nuts_raw := public.scale_nuts(v_nuts_raw);

  if v_nuts_raw > 0 then
    v_nuts := public.add_nuts(v_run.player_id, v_nuts_raw, v_run.mode, v_run.id::text);
  end if;

  update public.runs
  set status = 'finished',
      end_reason = p_reason,
      current = null,
      learn_points = v_learn,
      nuts = v_nuts,
      finished_at = public.jst_now()
  where id = v_run.id;

  -- 称号（条件達成で入手。ガチャには出ない）。1位以外にも光を当てる（桜井「ゲームに与える賞」）
  for v_t in
    select it.id, it.name from public.items it
    where it.source = 'achievement'
      and (
        (it.id = 'title_streak10' and v_run.mode = 'streak' and v_run.correct >= 10)
        or (it.id = 'title_streak20' and v_run.mode = 'streak' and v_run.correct >= 20)
        or (it.id = 'title_stage5' and v_run.mode = 'streak' and v_run.correct >= 20)
        or (it.id = 'title_comeback' and v_run.mode = 'streak' and v_run.revive_used and v_run.correct >= 10)
        or (it.id = 'title_knock_done' and v_run.mode = 'knock' and p_reason = 'complete')
        or (it.id = 'title_knock_oni' and v_run.mode = 'knock' and p_reason = 'complete' and v_run.correct >= 90)
      )
      and not exists (select 1 from public.player_items pi where pi.player_id = v_run.player_id and pi.item_id = it.id)
  loop
    insert into public.player_items (player_id, item_id, count, first_at)
    values (v_run.player_id, v_t.id, 1, public.jst_now())
    on conflict do nothing;
    v_new_titles := v_new_titles || jsonb_build_array(jsonb_build_object('id', v_t.id, 'name', v_t.name));
  end loop;

  -- 今週の順位と、すぐ上の相手（「あと何問で抜ける」を画面に出す）。記録になる回だけ
  select account_type = 'student' into v_is_student from public.players where id = v_run.player_id;
  if v_is_student and (v_run.mode = 'streak' or p_reason = 'complete') then
    v_me := public.run_best(v_run.player_id, v_run.mode, v_run.week_start);
    if v_run.mode = 'streak' then
      select r.rank into v_rank from public.ranking_streak_week r
        join public.players p on p.nickname = r.nickname where p.id = v_run.player_id;
      select jsonb_build_object('nickname', r.nickname, 'correct', r.best_streak, 'rank', r.rank) into v_rival
        from public.ranking_streak_week r
        where r.rank < coalesce(v_rank, 999999)
        order by r.rank desc limit 1;
    else
      select r.rank into v_rank from public.ranking_knock_week r
        join public.players p on p.nickname = r.nickname where p.id = v_run.player_id and r.band = v_run.band;
      select jsonb_build_object('nickname', r.nickname, 'correct', r.best_correct, 'rank', r.rank) into v_rival
        from public.ranking_knock_week r
        where r.band = v_run.band and r.rank < coalesce(v_rank, 999999)
        order by r.rank desc limit 1;
    end if;
  end if;

  return public.run_result(v_run.id)
    || jsonb_build_object(
      'commit_points', v_commit,
      'nuts_raw', v_nuts_raw,
      'week_rank', v_rank,
      'rival', v_rival,
      'new_titles', v_new_titles,
      'new_best', (v_run.mode = 'streak' or p_reason = 'complete')
        and v_run.correct > 0
        and (v_prev_best is null or v_run.correct > (v_prev_best->>'correct')::int
             or (v_run.correct = (v_prev_best->>'correct')::int and v_run.total_ms < (v_prev_best->>'total_ms')::int)),
      'new_week_best', (v_run.mode = 'streak' or p_reason = 'complete')
        and v_run.correct > 0
        and (v_prev_week_best is null or v_run.correct > (v_prev_week_best->>'correct')::int
             or (v_run.correct = (v_prev_week_best->>'correct')::int and v_run.total_ms < (v_prev_week_best->>'total_ms')::int))
    );
end;
$$ language plpgsql security definer set search_path = public;

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
  if exists(select 1 from public.players where id=v_uid and account_type='staff') then v_raffle_rate := 0; end if;
  v_month := date_trunc('month', public.jst_today())::date;

  for i in 1..v_total loop
    -- 1. 抽選券（まとめ引きは 10 回目で未入手なら確定。最後の 1 回は SR 以上確定のために空けておく）
    v_prize := null;
    if v_raffle_rate > 0 and (
         (random() < v_raffle_rate and (p_count = 1 or i < v_total))
         or (p_count = 10 and i = v_total - 1 and not v_has_raffle)
       ) then
      insert into public.raffle_entries (player_id, month, source, ref)
      values (v_uid, v_month, 'gacha', gen_random_uuid()::text);
      v_has_raffle := true;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'kind', 'raffle',
        'name', '抽選券',
        'slot', null,
        'rarity', 3,
        'display', jsonb_build_object('month', to_char(v_month, 'YYYY-MM')),
        'is_new', false,
        'shards', 0,
        'ticket_id', null
      ));
      continue;
    end if;

    -- 着せ替え・称号の抽選
    if true then
      -- まとめ引きのSR以上保証: 最後の1回でまだSR以上が出ていなければSR以上から選出
      if p_count = 10 and i = v_total and not v_has_sr_or_above then
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
 v_staff:=exists(select 1 from public.players where id=auth.uid() and account_type='staff');
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'stock',p.stock) order by p.created_at),'[]'::jsonb)
 into v_prizes from public.prizes p where p.reward_channel='raffle' and p.active and p.stock>0;
 v_rate:=0;
 return jsonb_build_object('prize_rate',case when v_staff or jsonb_array_length(v_prizes)=0 then 0 else v_rate end,'configured_prize_rate',v_rate,
 'prizes',case when v_staff then '[]'::jsonb else v_prizes end,'staff_mode',v_staff,'weekly_limit',1,
 'weekly_remaining',case when exists(select 1 from public.weekly_prize_awards where week_start=public.jst_week_start() and channel='gacha') then 0 else 1 end,
 'item_rates',jsonb_build_object('N',0.70,'R',0.22,'SR',0.07,'UR',0.01),
 'pull_cost',public.setting_num('pull_cost',5)::int,'pull10_cost',public.setting_num('pull10_cost',50)::int,
 'pull10_count',greatest(10,public.setting_num('pull10_count',11)::int),
 'raffle_rate',case when v_staff then 0 else greatest(0,least(1,public.setting_num('raffle_rate',0.10))) end,
 'raffle_month',to_char(date_trunc('month',public.jst_today()),'YYYY-MM'),
 'raffle_total_entries',(select count(*) from public.raffle_entries e join public.players p on p.id=e.player_id where e.month=date_trunc('month',public.jst_today())::date and p.account_type='student'),
 'raffle_my_entries',(select count(*) from public.raffle_entries where player_id=auth.uid() and month=date_trunc('month',public.jst_today())::date));
end; $$ language plpgsql stable security definer set search_path=public;

create or replace function public.staff_reward_overview() returns jsonb as $$
declare v_stats jsonb; v_rewards jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.staff where user_id=auth.uid()) then raise exception 'not_a_staff'; end if;
 select jsonb_build_object('students',count(*) filter(where account_type='student'),'staff',count(*) filter(where account_type='staff'),
 'weekly_active',count(*) filter(where account_type='student' and last_active_at >= (public.jst_week_start()::timestamp at time zone 'Asia/Tokyo'))) into v_stats from public.players;
 v_stats:=v_stats||jsonb_build_object('weekly_pulls',(select coalesce(sum(case when n.ref like '10_%' then greatest(10,public.setting_num('pull10_count',11)::int) else 1 end),0) from public.nut_ledger n join public.players p on p.id=n.player_id where p.account_type='student' and n.reason='gacha' and n.day>=public.jst_week_start()),
 'gacha_issued',(select count(*) from public.weekly_prize_awards where week_start=public.jst_week_start() and channel='gacha'),
 'raffle_month',to_char(date_trunc('month',public.jst_today()),'YYYY-MM'),
 'raffle_entries',(select count(*) from public.raffle_entries e join public.players p on p.id=e.player_id where e.month=date_trunc('month',public.jst_today())::date and p.account_type='student'),
 'raffle_holders',(select count(distinct e.player_id) from public.raffle_entries e join public.players p on p.id=e.player_id where e.month=date_trunc('month',public.jst_today())::date and p.account_type='student'),
 'ranking_issued_last_week',(select count(*) from public.weekly_prize_awards where week_start=public.jst_week_start()-7 and channel='ranking'));
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'channel',p.reward_channel,'active',p.active,'remaining',public.available_prize_stock(p,public.jst_week_start())) order by p.reward_channel),'[]'::jsonb) into v_rewards from public.prizes p where p.weekly_refill;
 return jsonb_build_object('stats',v_stats,'rewards',v_rewards,'prize_rate',greatest(0,least(1,public.setting_num('prize_rate',0.01))),'week_start',public.jst_week_start());
end; $$ language plpgsql stable security definer set search_path=public;

-- 5. スタッフが変えられる設定（鍵は決め打ち。値は数値か true/false だけ）
create or replace function public.staff_settings()
returns jsonb as $$
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  return (
    select coalesce(jsonb_object_agg(k.key, jsonb_build_object('value', coalesce(s.value, k.def), 'label', k.label, 'kind', k.kind, 'min', k.lo, 'max', k.hi)), '{}'::jsonb)
    from (values
      ('streak_base_ms',   '7000', '連続チャレンジ 最初の制限時間（ミリ秒）', 'int',  '2000', '15000'),
      ('streak_step_ms',   '400',  '連続チャレンジ ステージごとに短くする時間（ミリ秒）', 'int', '0', '2000'),
      ('streak_min_ms',    '3500', '連続チャレンジ 制限時間の下限（ミリ秒）', 'int', '1500', '10000'),
      ('knock_limit_ms',   '6000', '100本ノック 1問の制限時間（ミリ秒）', 'int', '2000', '15000'),
      ('nut_score_per_nut','25',   '木の実 素点いくつで1個', 'int', '5', '200'),
      ('nuts_scale',       '0.3333','木の実 倍率（対戦・ログインにも効く）', 'num', '0.05', '3'),
      ('nuts_daily_cap',   '200',  '木の実 1日の上限', 'int', '10', '5000'),
      ('pull_cost',        '5',    'ガチャ 1回の値段', 'int', '1', '500'),
      ('pull10_cost',      '50',   'ガチャ まとめ引きの値段', 'int', '1', '5000'),
      ('pull10_count',     '11',   'ガチャ まとめ引きで出る数', 'int', '10', '20'),
      ('raffle_rate',      '0.10', '抽選券 ガチャ1回で出る確率（0〜1）', 'num', '0', '1'),
      ('rank_mode_enabled','false','ランクモード（段の表示）', 'bool', '', '')
    ) as k(key, def, label, kind, lo, hi)
    left join public.app_settings s on s.key = k.key
  );
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function public.staff_set_setting(p_key text, p_value text)
returns jsonb as $$
declare
  v_kind text;
  v_lo numeric;
  v_hi numeric;
  v_num numeric;
  v_val text := trim(coalesce(p_value, ''));
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  select (public.staff_settings()->p_key->>'kind'), nullif(public.staff_settings()->p_key->>'min', '')::numeric, nullif(public.staff_settings()->p_key->>'max', '')::numeric
    into v_kind, v_lo, v_hi;
  if v_kind is null then
    raise exception 'setting_not_allowed';
  end if;
  if v_kind = 'bool' then
    if v_val not in ('true', 'false') then raise exception 'invalid_setting_value'; end if;
  else
    begin
      v_num := v_val::numeric;
    exception when others then
      raise exception 'invalid_setting_value';
    end;
    if v_kind = 'int' and v_num <> floor(v_num) then raise exception 'invalid_setting_value'; end if;
    if v_num < v_lo or v_num > v_hi then raise exception 'setting_out_of_range'; end if;
    v_val := v_num::text;
  end if;
  insert into public.app_settings (key, value) values (p_key, v_val)
  on conflict (key) do update set value = excluded.value;
  return public.staff_settings();
end;
$$ language plpgsql security definer set search_path = public;

-- 6. 権限
revoke all on public.raffle_entries, public.raffle_results from public, anon, authenticated;
revoke all on sequence public.raffle_entries_id_seq from public, anon, authenticated;
grant select on public.raffle_entries to authenticated;
revoke all on function
  public.draw_monthly_raffle(date), public.draw_monthly_raffle_if_due(), public.staff_draw_raffle(date), public.my_raffle(),
  public.staff_settings(), public.staff_set_setting(text, text),
  public.run_make_question(public.runs), public.answer_run(uuid, int, int), public.run_finish(uuid, text),
  public.pull_gacha(int), public.gacha_rates(), public.staff_reward_overview()
  from public, anon, authenticated;
grant execute on function public.answer_run(uuid, int, int), public.pull_gacha(int), public.staff_reward_overview(),
  public.staff_draw_raffle(date), public.my_raffle(), public.staff_settings(), public.staff_set_setting(text, text)
  to authenticated;
grant execute on function public.gacha_rates() to anon, authenticated;

commit;
