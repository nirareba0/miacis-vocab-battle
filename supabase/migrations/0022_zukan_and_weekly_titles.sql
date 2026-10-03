-- 0022_zukan_and_weekly_titles.sql（2026-10-03 本人）
-- 1.「それぞれ図鑑埋めたら なんかスキンをプレゼントしよう」
--    単語図鑑のレベル（A1・A2・B1・B2・最難関）を全部埋めると、すがたを1つ。学校生活の順に 新入生 → 生徒会長 → 高校生 → 受験生 → ハカセ
-- 2.「週間1位だと その称号もプレゼントしよう」
--    週の締めで、サバイバル各ステージ・トレーニング各レベル・コミットの1位（生徒）に称号。何度取っても1つで、回数（count）が増える
-- 3. 定期実行は supabase/cron.sql（close-week-job を close_week_all に。本番に無かった draw-raffle-job も）。migration には入れない
begin;

insert into public.items (id, name, slot, rarity, display, active, source) values
  ('zukan_a1', '新入生のミアキス', 'form', 4, '{}'::jsonb, true, 'achievement'),
  ('zukan_a2', '生徒会長のミアキス', 'form', 4, '{}'::jsonb, true, 'achievement'),
  ('zukan_b1', '高校生のミアキス', 'form', 4, '{}'::jsonb, true, 'achievement'),
  ('zukan_b2', '受験生のミアキス', 'form', 4, '{}'::jsonb, true, 'achievement'),
  ('zukan_ac', 'ハカセのミアキス', 'form', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_sv1', 'サバイバル王 A1', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_sv2', 'サバイバル王 A2', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_sv3', 'サバイバル王 B1', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_sv4', 'サバイバル王 B2', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_sv5', 'サバイバル王 最難関', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_tr1', 'トレーニング王 A1', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_tr2', 'トレーニング王 A2', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_tr3', 'トレーニング王 B1', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_tr4', 'トレーニング王 B2', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_tr5', 'トレーニング王 最難関', 'title', 4, '{}'::jsonb, true, 'achievement'),
  ('title_wk_commit', 'コミット王', 'title', 4, '{}'::jsonb, true, 'achievement')
on conflict (id) do nothing;

-- 1. 図鑑
create or replace function public.zukan_reward_id(p_band int)
returns text as $$
  select (array['zukan_a1', 'zukan_a2', 'zukan_b1', 'zukan_b2', 'zukan_ac'])[p_band];
$$ language sql immutable;

-- レベルごとの「出題に使う語の数」と「正解したことのある語の数」（対戦の6秒以内の正解＋サバイバル・トレーニングの正解）
create or replace function public.zukan_collected(p_uid uuid)
returns table (band int, total int, collected int) as $$
  with got as (
    select (q.value->>'word_id')::int as word_id
    from public.matches m,
      jsonb_array_elements(m.questions) with ordinality q(value, idx),
      jsonb_array_elements(m.answers) with ordinality a(value, idx)
    where m.player_id = p_uid and m.finished_at is not null
      and q.idx = a.idx
      and (a.value->>'choice') is not null
      and (a.value->>'ms')::int < 6000
      and (a.value->>'choice')::int = (q.value->>'answer_index')::int
    union
    select unnest(r.correct_word_ids) from public.runs r where r.player_id = p_uid
  )
  select b.band::int,
    (select count(*)::int from public.words w where w.band = b.band and w.active),
    (select count(*)::int from public.words w where w.band = b.band and w.active and w.id in (select word_id from got))
  from generate_series(1, 5) as b(band);
$$ language sql stable security definer set search_path = public;

-- 埋まったレベルのすがたを渡す。何度呼んでもよい（持っていれば何もしない）。新しく渡したものを返す
create or replace function public.claim_zukan_rewards()
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := '[]'::jsonb;
  v_z record;
  v_item public.items;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  for v_z in select * from public.zukan_collected(v_uid) where total > 0 and collected >= total loop
    select * into v_item from public.items where id = public.zukan_reward_id(v_z.band) and active;
    if not found then continue; end if;
    insert into public.player_items (player_id, item_id, count, first_at)
    values (v_uid, v_item.id, 1, public.jst_now())
    on conflict (player_id, item_id) do nothing;
    if found then
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_item.id, 'name', v_item.name, 'slot', v_item.slot, 'band', v_z.band));
    end if;
  end loop;
  return v_out;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.my_words()
returns jsonb as $$
declare
  v_uid uuid;
  v_words jsonb;
  v_bands jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  with player_matches as (
    select questions, answers
    from public.matches
    where player_id = v_uid
      and finished_at is not null
  ),
  unwound as (
    select
      (q.value->>'word_id')::int as word_id
    from player_matches m,
    jsonb_array_elements(m.questions) with ordinality q(value, idx),
    jsonb_array_elements(m.answers) with ordinality a(value, idx)
    where q.idx = a.idx
      and (a.value->>'choice') is not null
      and (a.value->>'ms')::int < 6000
      and (a.value->>'choice')::int = (q.value->>'answer_index')::int
    union
    select unnest(r.correct_word_ids)
    from public.runs r
    where r.player_id = v_uid
  ),
  distinct_words as (
    select distinct word_id from unwound
  ),
  words_with_meta as (
    select
      w.id as word_id,
      w.en,
      w.ja,
      w.band,
      w.rank
    from distinct_words dw
    join public.words w on w.id = dw.word_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'word_id', wm.word_id,
      'en', wm.en,
      'ja', wm.ja,
      'band', wm.band,
      'rank', wm.rank
    ) order by wm.band asc, wm.rank asc
  ), '[]'::jsonb)
  into v_words
  from words_with_meta wm;

  -- 0022: 覚えた数は対戦とサバイバル・トレーニングの正解を合わせて数える（前は対戦だけで、一覧と数がずれていた）。
  --       レベルごとに、コンプリートでもらえる「すがた」も返す
  select jsonb_agg(jsonb_build_object(
      'band', z.band, 'total', z.total, 'collected', z.collected,
      'reward', jsonb_build_object('id', it.id, 'name', it.name,
                  'owned', exists (select 1 from public.player_items pi where pi.player_id = v_uid and pi.item_id = it.id))
    ) order by z.band)
  into v_bands
  from public.zukan_collected(v_uid) z
  left join public.items it on it.id = public.zukan_reward_id(z.band);

  return jsonb_build_object(
    'words', v_words,
    'bands', v_bands
  );
end;
$$ language plpgsql security definer set search_path = public;

-- 2. 週間1位の称号
create table if not exists public.weekly_title_awards (
  week_start date not null,
  kind text not null check (kind in ('streak', 'knock', 'commit')),
  band int not null default 0,          -- commit は 0
  player_id uuid not null references public.players(id) on delete cascade,
  item_id text not null references public.items(id),
  awarded_at timestamptz not null default public.jst_now(),
  primary key (week_start, kind, band)
);
alter table public.weekly_title_awards enable row level security;

create or replace function public.award_weekly_titles(p_week date)
returns jsonb as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_b int;
  v_kind text;
  v_player uuid;
  v_item text;
begin
  if p_week >= public.jst_week_start() or extract(isodow from p_week) <> 1 then raise exception 'invalid_reward_week'; end if;
  perform pg_advisory_xact_lock(73424, p_week - date '2000-01-01');

  foreach v_kind in array array['streak', 'knock'] loop
    for v_b in 1..5 loop
      if exists (select 1 from public.weekly_title_awards where week_start = p_week and kind = v_kind and band = v_b) then continue; end if;
      -- ランキングの見え方と同じ順（多い順、同じなら速い順、先に出した順）。賞は生徒だけ（スタッフが1位なら生徒の1位へ）
      select r.player_id into v_player
      from public.runs r join public.players p on p.id = r.player_id
      where r.mode = v_kind and r.status = 'finished' and r.week_start = p_week and r.band = v_b
        and p.account_type = 'student' and r.correct > 0
        and (v_kind = 'streak' or r.end_reason = 'complete')
      order by r.correct desc, r.total_ms asc, r.finished_at asc, r.player_id
      limit 1;
      if v_player is null then continue; end if;
      v_item := case v_kind when 'streak' then 'title_wk_sv' else 'title_wk_tr' end || v_b;
      insert into public.weekly_title_awards (week_start, kind, band, player_id, item_id) values (p_week, v_kind, v_b, v_player, v_item);
      insert into public.player_items (player_id, item_id, count, first_at) values (v_player, v_item, 1, public.jst_now())
      on conflict (player_id, item_id) do update set count = public.player_items.count + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'band', v_b, 'player_id', v_player, 'item_id', v_item));
      v_player := null;
    end loop;
  end loop;

  -- コミット: 週の締め（weekly_results）の1位
  if not exists (select 1 from public.weekly_title_awards where week_start = p_week and kind = 'commit') then
    select wr.player_id into v_player
    from public.weekly_results wr join public.players p on p.id = wr.player_id
    where wr.week_start = p_week and wr.commit_rank = 1 and wr.commit_points > 0 and p.account_type = 'student'
    limit 1;
    if v_player is not null then
      insert into public.weekly_title_awards (week_start, kind, band, player_id, item_id) values (p_week, 'commit', 0, v_player, 'title_wk_commit');
      insert into public.player_items (player_id, item_id, count, first_at) values (v_player, 'title_wk_commit', 1, public.jst_now())
      on conflict (player_id, item_id) do update set count = public.player_items.count + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'commit', 'band', 0, 'player_id', v_player, 'item_id', 'title_wk_commit'));
    end if;
  end if;
  return v_out;
end;
$$ language plpgsql security definer set search_path = public;

-- 週の締め（pg_cron が毎週月曜 0:05 に呼ぶ）: 段の昇降と週間の券 → 週間1位の称号
create or replace function public.close_week_all(p_week date default (public.jst_week_start() - interval '7 days')::date)
returns jsonb as $$
begin
  perform public.close_week(p_week);
  return public.award_weekly_titles(p_week);
end;
$$ language plpgsql security definer set search_path = public;

-- 自分が先週もらった称号（ホームで「先週 1位！」を出す）
create or replace function public.my_week_titles()
returns jsonb as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'week_start', a.week_start, 'kind', a.kind, 'band', a.band, 'item_id', a.item_id, 'name', it.name,
      'count', (select pi.count from public.player_items pi where pi.player_id = a.player_id and pi.item_id = a.item_id))
    order by a.kind, a.band), '[]'::jsonb)
  from public.weekly_title_awards a join public.items it on it.id = a.item_id
  where a.player_id = auth.uid() and a.week_start = (public.jst_week_start() - interval '7 days')::date;
$$ language sql stable security definer set search_path = public;


revoke all on public.weekly_title_awards from public, anon, authenticated;
revoke all on function public.zukan_reward_id(int), public.zukan_collected(uuid), public.claim_zukan_rewards(), public.my_words(),
  public.award_weekly_titles(date), public.close_week_all(date), public.my_week_titles()
  from public, anon, authenticated;
grant execute on function public.claim_zukan_rewards(), public.my_words(), public.my_week_titles() to authenticated;

commit;
