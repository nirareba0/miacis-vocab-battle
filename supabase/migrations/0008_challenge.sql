-- 0008_challenge.sql: 連続チャレンジ（5問ごとに範囲が上がる・時間切れは1回だけ復活）と 100本ノック
-- miacis-vocab-battle
--
-- 対戦（matches）と違い、1問ずつサーバーが出題・採点する。
--   - 連続チャレンジは「間違えたら終わり」なので、答えを返すたびに正誤が決まっている必要がある
--   - 記録を競うので、正解と制限時間はサーバーだけが持つ（出題した時刻もサーバーが記録する）
-- 端末に正解を渡すのは、その問いに答えた後だけ。
begin;

-- 1. 設定
insert into public.app_settings (key, value)
values
  ('streak_base_ms', '7000'),   -- 第1ステージの制限時間
  ('streak_step_ms', '400'),    -- ステージが1つ上がるごとに短くする時間
  ('streak_min_ms', '3500'),    -- これより短くしない
  ('knock_limit_ms', '6000'),   -- 100本ノックの1問の制限時間
  ('run_grace_ms', '2500'),     -- 通信の遅れとして許す時間
  -- 木の実は「1日1時間遊ぶと10連（150個）1回ぶん」が目安（2026-10-01 本人）
  ('streak_nuts_per_stage', '2'),  -- 連続チャレンジ: 5問連続ごとに
  ('knock_nuts_per_10', '1'),      -- 100本ノック: 正解10問ごとに
  ('knock_nuts_complete', '5'),    -- 100本ノック: 100問やり切ったら
  ('knock_nuts_90', '3')           -- 100本ノック: 90問以上正解でさらに
on conflict (key) do nothing;

-- もらう木の実に倍率を掛ける（四捨五入。0 は 0 のまま、1以上の素点は最低1）。
-- 倍率 nuts_scale は 0009 で 1/3 にする（ガチャの値下げと合わせて）。ここでの既定は 1
create or replace function public.scale_nuts(p_raw int)
returns int as $$
  select case when coalesce(p_raw, 0) <= 0 then 0
              else greatest(1, round(p_raw * public.setting_num('nuts_scale', 1))::int) end;
$$ language sql stable security definer set search_path = public;

-- 2. 表
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  mode text not null check (mode in ('streak', 'knock')),
  band smallint check (band is null or band between 1 and 5),   -- knock だけ（開始時の段）
  status text not null default 'active' check (status in ('active', 'revive_offer', 'finished')),
  answered int not null default 0,     -- 採点した問題数（復活で飛ばした時間切れは数えない）
  correct int not null default 0,      -- 正解数（連続チャレンジでは = 連続記録）
  total_ms int not null default 0,     -- 正解した問題にかかった時間の合計（同点の順位に使う）
  revive_used boolean not null default false,
  current jsonb,                       -- 出題中の問題（answer_index つき。端末には出さない）
  used_word_ids int[] not null default '{}',
  correct_word_ids int[] not null default '{}',   -- 図鑑に入れる（正解した単語）
  missed jsonb not null default '[]'::jsonb,   -- 間違えた・時間切れの問題（振り返り用）
  end_reason text check (end_reason is null or end_reason in ('wrong', 'timeout', 'complete', 'quit', 'abandoned')),
  learn_points int not null default 0,
  nuts int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  week_start date not null
);

create index idx_runs_player_mode on public.runs(player_id, mode, finished_at desc);
create index idx_runs_mode_week on public.runs(mode, week_start, correct desc);

alter table public.runs enable row level security;
-- 行の読み取りも関数経由だけ（current に正解が入っているため、GRANT しない）

-- 3. 出題範囲
-- 連続チャレンジは全員同じコース。単語を頻度順に10の範囲へ分け、5問ごとに1つ上がる。
create or replace function public.streak_range_of(p_stage int)
returns int as $$
  select least(greatest(p_stage, 1), 10);
$$ language sql immutable;

create or replace function public.streak_limit_ms(p_stage int)
returns int as $$
  select greatest(
    public.setting_num('streak_min_ms', 3500)::int,
    public.setting_num('streak_base_ms', 7000)::int
      - (greatest(p_stage, 1) - 1) * public.setting_num('streak_step_ms', 400)::int
  );
$$ language sql stable security definer set search_path = public;

-- 出題する単語の集まり（連続チャレンジは範囲、100本ノックは段）
create or replace function public.run_pool(p_mode text, p_range int, p_band int)
returns table (id int, en text, ja text) as $$
  select t.id, t.en, t.ja
  from (
    select w.id, w.en, w.ja, w.band, ntile(10) over (order by w.rank) as r
    from public.words w
  ) t
  where case when p_mode = 'streak' then t.r = p_range else t.band = p_band end;
$$ language sql stable security definer set search_path = public;

-- 4. 1問つくる（current に入れる形と、端末に返す形）
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
    v_range := public.streak_range_of(v_stage);
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

-- 端末に返す形（正解と出題時刻を抜く）
create or replace function public.run_client_question(p_q jsonb)
returns jsonb as $$
  select case when p_q is null then null else p_q - 'answer_index' - 'issued_at' end;
$$ language sql immutable;

-- 5. 記録
create or replace function public.run_best(p_player_id uuid, p_mode text, p_week date)
returns jsonb as $$
  select jsonb_build_object('correct', r.correct, 'total_ms', r.total_ms, 'finished_at', r.finished_at)
  from public.runs r
  where r.player_id = p_player_id
    and r.mode = p_mode
    and r.status = 'finished'
    and (p_week is null or r.week_start = p_week)
    and (p_mode = 'streak' or r.end_reason = 'complete')
  order by r.correct desc, r.total_ms asc, r.finished_at asc
  limit 1;
$$ language sql stable security definer set search_path = public;

-- 6. 終わらせる（ポイント・木の実を付ける）。呼ぶ側で行ロックを取っていること
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
begin
  select * into v_run from public.runs where id = p_run_id;

  if v_run.status = 'finished' then
    return public.run_result(v_run.id);
  end if;

  v_prev_best := public.run_best(v_run.player_id, v_run.mode, null);
  v_prev_week_best := public.run_best(v_run.player_id, v_run.mode, v_run.week_start);

  -- 学習ポイントは対戦と同じく「正解1問 = 1点」
  v_learn := v_run.correct;

  if v_run.mode = 'streak' then
    -- 木の実: 5問連続ごとに 2。1回 1〜2分・1時間で 5問の区切りを 70〜80 回越える想定で 約150
    v_nuts_raw := (v_run.correct / 5) * public.setting_num('streak_nuts_per_stage', 2)::int;
  else
    -- 木の実: 正解10問ごとに 1、やり切って +5、90問以上で +3。1回 約7分・1時間で約8回 × 13〜17 で 約120〜140
    v_nuts_raw := (v_run.correct / 10) * public.setting_num('knock_nuts_per_10', 1)::int
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

create or replace function public.run_result(p_run_id uuid)
returns jsonb as $$
  select jsonb_build_object(
    'run_id', r.id,
    'mode', r.mode,
    'status', r.status,
    'end_reason', r.end_reason,
    'answered', r.answered,
    'correct', r.correct,
    'total_ms', r.total_ms,
    'revive_used', r.revive_used,
    'missed', r.missed,
    'learn_points', r.learn_points,
    'nuts', r.nuts,
    'best', public.run_best(r.player_id, r.mode, null),
    'week_best', public.run_best(r.player_id, r.mode, r.week_start)
  )
  from public.runs r where r.id = p_run_id;
$$ language sql stable security definer set search_path = public;

-- 7. 端末から呼ぶ関数

-- 始める。やりかけ（30分以上前・別端末で放置など）は、そこまでの記録で締める
create or replace function public.start_run(p_mode text)
returns jsonb as $$
declare
  v_uid uuid;
  v_player public.players;
  v_old record;
  v_run public.runs;
  v_q jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_mode is null or p_mode not in ('streak', 'knock') then
    raise exception 'invalid_mode';
  end if;

  select * into v_player from public.players where id = v_uid;
  if not found then
    raise exception 'player_not_found';
  end if;

  for v_old in
    select id from public.runs
    where player_id = v_uid and status <> 'finished'
    for update
  loop
    perform public.run_finish(v_old.id, 'abandoned');
  end loop;

  insert into public.runs (player_id, mode, band, started_at, week_start)
  values (v_uid, p_mode, case when p_mode = 'knock' then v_player.tier else null end,
          public.jst_now(), public.jst_week_start())
  returning * into v_run;

  v_q := public.run_make_question(v_run);
  update public.runs set current = v_q where id = v_run.id;

  return jsonb_build_object(
    'run_id', v_run.id,
    'mode', p_mode,
    'band', v_run.band,
    'total', case when p_mode = 'knock' then 100 else null end,
    'best', public.run_best(v_uid, p_mode, null),
    'week_best', public.run_best(v_uid, p_mode, public.jst_week_start()),
    'question', public.run_client_question(v_q)
  );
end;
$$ language plpgsql security definer set search_path = public;

-- 答える。p_choice が null なら時間切れ。p_ms は端末が測った回答時間
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

-- 復活する（連続チャレンジで時間切れになったとき、1回だけ）。次の問題が出る
create or replace function public.revive_run(p_run_id uuid)
returns jsonb as $$
declare
  v_uid uuid;
  v_run public.runs;
  v_q jsonb;
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
  if v_run.status <> 'revive_offer' or v_run.revive_used then
    raise exception 'revive_not_available';
  end if;

  -- 迷っていられるのは 10 秒（画面では 5 秒。残りは通信の遅れ）
  if public.jst_now() - (v_run.current->>'offered_at')::timestamptz > interval '10 seconds' then
    return jsonb_build_object('state', 'finished', 'result', public.run_finish(v_run.id, 'timeout'));
  end if;

  -- 時間切れの1問は「数えない」: 採点数を戻し、振り返りには残す
  v_run.answered := v_run.answered - 1;
  v_run.revive_used := true;
  v_q := public.run_make_question(v_run);

  update public.runs
  set status = 'active',
      revive_used = true,
      answered = v_run.answered,
      current = v_q
  where id = v_run.id;

  return jsonb_build_object(
    'state', 'next',
    'revive_used', true,
    'score', v_run.correct,
    'question', public.run_client_question(v_q)
  );
end;
$$ language plpgsql security definer set search_path = public;

-- やめる（復活しない・途中でやめる）
create or replace function public.end_run(p_run_id uuid)
returns jsonb as $$
declare
  v_uid uuid;
  v_run public.runs;
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

  if v_run.status = 'finished' then
    return public.run_result(v_run.id);
  end if;

  return public.run_finish(v_run.id, case when v_run.status = 'revive_offer' then 'timeout' else 'quit' end);
end;
$$ language plpgsql security definer set search_path = public;

-- 自分の記録
create or replace function public.my_run_bests()
returns jsonb as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  return jsonb_build_object(
    'streak', public.run_best(v_uid, 'streak', null),
    'streak_week', public.run_best(v_uid, 'streak', public.jst_week_start()),
    'knock', public.run_best(v_uid, 'knock', null),
    'knock_week', public.run_best(v_uid, 'knock', public.jst_week_start())
  );
end;
$$ language plpgsql security definer set search_path = public;

-- 8. ランキング（ニックネームと段だけ。学年・スタッフは出さない）

-- 連続チャレンジ: 今週の自己ベスト。同じ数なら、かかった時間が短い人が上
create or replace view public.ranking_streak_week as
with best as (
  select distinct on (r.player_id)
    r.player_id, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.week_start = public.jst_week_start()
    and r.correct > 0
  order by r.player_id, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.correct as best_streak,
  b.total_ms,
  rank() over (order by b.correct desc, b.total_ms asc)::int as rank
from best b
join public.players p on p.id = b.player_id
where p.account_type = 'student'
order by rank asc, nickname asc;

-- 連続チャレンジ: これまでの最高記録
create or replace view public.ranking_streak_all as
with best as (
  select distinct on (r.player_id)
    r.player_id, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.correct > 0
  order by r.player_id, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.correct as best_streak,
  b.total_ms,
  rank() over (order by b.correct desc, b.total_ms asc)::int as rank
from best b
join public.players p on p.id = b.player_id
where p.account_type = 'student'
order by rank asc, nickname asc;

-- 100本ノック: 今週の自己ベスト（100問やり切った回だけ）。段ごと
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
  rank() over (partition by b.band order by b.correct desc, b.total_ms asc)::int as rank
from best b
join public.players p on p.id = b.player_id
where p.account_type = 'student'
order by band asc, rank asc, nickname asc;


-- 単語図鑑に、連続チャレンジ・100本ノックで正解した単語も入れる（それまでは対戦だけだった）
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

  with band_totals as (
    select b.band, coalesce(count(w.id), 0)::int as total
    from generate_series(1, 5) as b(band)
    left join public.words w on w.band = b.band
    group by b.band
  ),
  player_matches as (
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
  ),
  distinct_words as (
    select distinct word_id from unwound
  ),
  band_collected as (
    select b.band, coalesce(count(dw.word_id), 0)::int as collected
    from generate_series(1, 5) as b(band)
    left join (
      distinct_words dw
      join public.words w on w.id = dw.word_id
    ) on w.band = b.band
    group by b.band
  )
  select jsonb_agg(
    jsonb_build_object(
      'band', bt.band,
      'total', bt.total,
      'collected', coalesce(bc.collected, 0)
    ) order by bt.band asc
  )
  into v_bands
  from band_totals bt
  join band_collected bc on bc.band = bt.band;

  return jsonb_build_object(
    'words', v_words,
    'bands', v_bands
  );
end;
$$ language plpgsql security definer set search_path = public;

-- 9. 権限（全部取り消してから要るものだけ）
revoke all on public.runs from public, anon, authenticated;
revoke all on public.ranking_streak_week, public.ranking_streak_all, public.ranking_knock_week from public, anon, authenticated;

revoke execute on function public.scale_nuts(int) from public, anon, authenticated;
revoke execute on function public.streak_range_of(int) from public, anon, authenticated;
revoke execute on function public.streak_limit_ms(int) from public, anon, authenticated;
revoke execute on function public.run_pool(text, int, int) from public, anon, authenticated;
revoke execute on function public.run_make_question(public.runs) from public, anon, authenticated;
revoke execute on function public.run_client_question(jsonb) from public, anon, authenticated;
revoke execute on function public.run_best(uuid, text, date) from public, anon, authenticated;
revoke execute on function public.run_finish(uuid, text) from public, anon, authenticated;
revoke execute on function public.run_result(uuid) from public, anon, authenticated;
revoke execute on function public.start_run(text) from public, anon, authenticated;
revoke execute on function public.answer_run(uuid, int, int) from public, anon, authenticated;
revoke execute on function public.revive_run(uuid) from public, anon, authenticated;
revoke execute on function public.end_run(uuid) from public, anon, authenticated;
revoke execute on function public.my_run_bests() from public, anon, authenticated;
revoke execute on function public.my_words() from public, anon, authenticated;
grant execute on function public.my_words() to authenticated;

grant select on public.ranking_streak_week, public.ranking_streak_all, public.ranking_knock_week to anon, authenticated;
grant execute on function
  public.start_run(text),
  public.answer_run(uuid, int, int),
  public.revive_run(uuid),
  public.end_run(uuid),
  public.my_run_bests()
  to authenticated;

commit;
