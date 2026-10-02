-- 0017_roguelike.sql: 連続チャレンジのローグライク化（2026-10-02 本人）
-- 仕様: core/projects/miacis/specs/roguelike-design-20261002.md（AIOS）
--   1. カード: STAGE が上がるたびに 3 枚（Lv5 は 4 枚）から 1 枚。たて／50:50／じかん+2／スキップ／Mi×2
--   2. スタート地点: 1・3・5・8・10。一度たどり着いた段階から始められる。記録は「到達」= (スタート-1)×5 + 連続
--   3. 系統樹: 累計正解でレベル。Lv2 スキップ、Lv3 Mi×2、Lv4 最初にカード、Lv5 候補 4 枚
begin;

alter table public.runs drop constraint if exists runs_status_check;
alter table public.runs add constraint runs_status_check check (status in ('active', 'revive_offer', 'card_offer', 'finished'));
alter table public.runs add column if not exists start_stage smallint not null default 1 check (start_stage in (1, 3, 5, 8, 10));
alter table public.runs add column if not exists shields int not null default 0;
alter table public.runs add column if not exists fifties int not null default 0;
alter table public.runs add column if not exists skips int not null default 0;
alter table public.runs add column if not exists time_bonus_ms int not null default 0;
alter table public.runs add column if not exists coin_mult int not null default 1;
alter table public.runs add column if not exists cards jsonb not null default '[]'::jsonb;
alter table public.runs add column if not exists offer jsonb;
alter table public.runs add column if not exists depth int generated always as ((start_stage - 1) * 5 + correct) stored;

-- 系統樹: 累計正解（すべての挑戦の正解数の合計）からレベル・解放を出す
create or replace function public.meta_of(p_player_id uuid)
returns jsonb as $$
  with t as (
    select coalesce(sum(correct), 0)::int as total from public.runs where player_id = p_player_id
  ), l as (
    select total,
      case when total >= 600 then 5 when total >= 300 then 4 when total >= 150 then 3 when total >= 50 then 2 else 1 end as level
    from t
  )
  select jsonb_build_object(
    'total_correct', total,
    'level', level,
    'next_at', case level when 1 then 50 when 2 then 150 when 3 then 300 when 4 then 600 else null end,
    'cards', (select jsonb_agg(c) from unnest(case
                when level >= 3 then array['shield','fifty','time','skip','double']
                when level >= 2 then array['shield','fifty','time','skip']
                else array['shield','fifty','time'] end) as c),
    'offer_size', case when level >= 5 then 4 else 3 end,
    'start_card', level >= 4,
    'max_depth', coalesce((select max(depth) from public.runs where player_id = p_player_id and mode = 'streak' and status = 'finished'), 0)
  ) from l;
$$ language sql stable security definer set search_path = public;

-- カードの候補（解放済みから、重ならない種類を offer_size 枚）
create or replace function public.card_offer(p_player_id uuid)
returns jsonb as $$
  with m as (select public.meta_of(p_player_id) as j)
  select coalesce(jsonb_agg(c), '[]'::jsonb) from (
    select c from m, jsonb_array_elements_text(m.j->'cards') as c
    order by random()
    limit (select (j->>'offer_size')::int from m)
  ) s;
$$ language sql volatile security definer set search_path = public;

create or replace function public.run_inventory(p_run public.runs)
returns jsonb as $$
  select jsonb_build_object(
    'shields', coalesce(p_run.shields, 0),
    'fifties', coalesce(p_run.fifties, 0),
    'skips', coalesce(p_run.skips, 0),
    'time_bonus_ms', coalesce(p_run.time_bonus_ms, 0),
    'coin_mult', coalesce(p_run.coin_mult, 1),
    'cards', coalesce(p_run.cards, '[]'::jsonb)
  );
$$ language sql immutable;

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
    -- 到達 = スタート地点のぶん + 連続正解（0017）
    v_stage := ((coalesce(p_run.start_stage, 1) - 1) * 5 + p_run.correct) / 5 + 1;
    -- 段差の直後 2 問は 1 つ前の範囲（壁のあとに平地）。スタート直後は平地にしない
    v_range := public.streak_range_of(case when v_stage > 1 and p_run.correct >= 5 and p_run.correct % 5 < 2 then v_stage - 1 else v_stage end);
    v_limit := public.streak_limit_ms(v_stage) + coalesce(p_run.time_bonus_ms, 0);

  else
    v_stage := p_run.answered / 10 + 1;   -- 100本ノックは10問ごとの区切りを表示に使うだけ
    v_range := null;
    v_limit := public.setting_num('knock_limit_ms', 6000)::int;

  end if;

  -- 1. 今の範囲から、まだ出ていない単語。すでに出た単語と日本語訳が同じもの（start / begin など）も出さない
  select w.* into v_word
  from public.words w
  join public.run_pool(p_run.mode, v_range, p_run.band) p on p.id = w.id
  where w.id <> all(p_run.used_word_ids)
    and w.ja not in (select u.ja from public.words u where u.id = any(p_run.used_word_ids))
  order by random()
  limit 1;

  -- 2. 範囲を使い切ったら、範囲の外のまだ出ていない単語。連続チャレンジは難しい（頻度の低い）方から、
  --    100本ノックは段の近い方から（2026-10-02: 361問連続で範囲10の264語を使い切り、同じ単語が出た）
  if not found then
    select w.* into v_word
    from public.words w
    where w.active
      and w.id <> all(p_run.used_word_ids)
      and w.ja not in (select u.ja from public.words u where u.id = any(p_run.used_word_ids))
    order by
      case when p_run.mode = 'streak' then -(coalesce(w.sort_key, w.rank) / 50) else abs(w.band - coalesce(p_run.band, 1)) end,
      random()
    limit 1;
  end if;

  -- 3. 全部の単語を使い切ったときだけ、重複を許す
  if not found then
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
      -- 訳が同じ単語は「もう一つの正解」になるので選択肢に入れない
      select distinct en from public.run_pool(p_run.mode, v_range, p_run.band) where en <> v_correct and ja <> v_word.ja order by en
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
  v_shield_used boolean := false;
  v_offer jsonb;
  v_depth int;
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

  v_depth := (coalesce(v_run.start_stage, 1) - 1) * 5 + v_run.correct;

  if v_run.mode = 'streak' then
    if v_correct then
      v_state := 'next';
      -- STAGE が上がった瞬間（5問ごと）にカードを選ぶ（0017）
      if v_depth % 5 = 0 then
        v_offer := public.card_offer(v_run.player_id);
        if jsonb_array_length(v_offer) > 0 then
          v_state := 'card_offer';
        end if;
      end if;
    elsif coalesce(v_run.shields, 0) > 0 then
      -- たて: この1回の不正解を無効にする（連続は止まらない）
      v_run.shields := v_run.shields - 1;
      v_shield_used := true;
      v_state := 'next';
    elsif v_timeout and not v_run.revive_used then
      v_state := 'revive_offer';
    else
      v_state := 'finished';
    end if;
  else
    v_state := case when v_run.answered >= 100 then 'finished' else 'next' end;
  end if;

  if v_state in ('next', 'card_offer') then
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
      shields = v_run.shields,
      offer = case when v_state = 'card_offer' then v_offer else null end,
      status = case when v_state = 'revive_offer' then 'revive_offer' when v_state = 'card_offer' then 'card_offer' else status end,
      current = case when v_state in ('next', 'card_offer') then v_next
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
    'depth', v_depth,
    'shield_used', v_shield_used,
    'inventory', public.run_inventory(v_run),
    'offer', v_offer,
    -- カードを選ぶ間は問題を渡さない（選んでから pick_card が出す）
    'question', case when v_state = 'card_offer' then null else public.run_client_question(v_next) end,
    'result', v_result
  );
end;
$$ language plpgsql security definer set search_path = public;

-- カードを選ぶ。効果をつけ、止めていた問題を「いま」出す
create or replace function public.pick_card(p_run_id uuid, p_card text)
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_run public.runs;
  v_q jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_run from public.runs where id = p_run_id for update;
  if not found then raise exception 'run_not_found'; end if;
  if v_run.player_id <> v_uid then raise exception 'permission_denied'; end if;
  if v_run.status <> 'card_offer' or v_run.offer is null then raise exception 'no_card_offer'; end if;
  if not (v_run.offer ? p_card) then raise exception 'card_not_offered'; end if;

  case p_card
    when 'shield' then v_run.shields := v_run.shields + 1;
    when 'fifty'  then v_run.fifties := v_run.fifties + 1;
    when 'skip'   then v_run.skips := v_run.skips + 1;
    when 'time'   then v_run.time_bonus_ms := v_run.time_bonus_ms + 2000;
    when 'double' then v_run.coin_mult := least(8, v_run.coin_mult * 2);
  end case;

  -- じかん+ は止めていた問題にも効かせる
  v_q := v_run.current
    || jsonb_build_object('issued_at', public.jst_now())
    || case when p_card = 'time' then jsonb_build_object('limit_ms', (v_run.current->>'limit_ms')::int + 2000) else '{}'::jsonb end;

  update public.runs
  set status = 'active', offer = null, current = v_q,
      shields = v_run.shields, fifties = v_run.fifties, skips = v_run.skips,
      time_bonus_ms = v_run.time_bonus_ms, coin_mult = v_run.coin_mult,
      cards = v_run.cards || jsonb_build_array(p_card)
  where id = v_run.id
  returning * into v_run;

  return jsonb_build_object('card', p_card, 'inventory', public.run_inventory(v_run), 'question', public.run_client_question(v_q));
end;
$$ language plpgsql security definer set search_path = public;

-- 50:50: いまの問題のハズレを 2 つ消す（同じ問題で 1 回まで）
create or replace function public.use_fifty(p_run_id uuid)
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_run public.runs;
  v_hidden jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_run from public.runs where id = p_run_id for update;
  if not found then raise exception 'run_not_found'; end if;
  if v_run.player_id <> v_uid then raise exception 'permission_denied'; end if;
  if v_run.status <> 'active' or v_run.current is null then raise exception 'run_not_active'; end if;
  if v_run.fifties < 1 then raise exception 'no_card_left'; end if;
  if v_run.current ? 'hidden' then raise exception 'already_used_here'; end if;

  select jsonb_agg(i) into v_hidden from (
    select i from generate_series(0, 3) as i
    where i <> (v_run.current->>'answer_index')::int
    order by random() limit 2
  ) s;

  update public.runs
  set fifties = fifties - 1, current = current || jsonb_build_object('hidden', v_hidden)
  where id = v_run.id
  returning * into v_run;

  return jsonb_build_object('hidden', v_hidden, 'inventory', public.run_inventory(v_run));
end;
$$ language plpgsql security definer set search_path = public;

-- スキップ: いまの問題を数えずに次へ（その単語はこの回ではもう出さない）
create or replace function public.skip_question(p_run_id uuid)
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_run public.runs;
  v_q jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_run from public.runs where id = p_run_id for update;
  if not found then raise exception 'run_not_found'; end if;
  if v_run.player_id <> v_uid then raise exception 'permission_denied'; end if;
  if v_run.status <> 'active' or v_run.current is null then raise exception 'run_not_active'; end if;
  if v_run.skips < 1 then raise exception 'no_card_left'; end if;

  v_run.used_word_ids := array_append(v_run.used_word_ids, (v_run.current->>'word_id')::int);
  v_run.skips := v_run.skips - 1;
  v_q := public.run_make_question(v_run);
  update public.runs set skips = v_run.skips, used_word_ids = v_run.used_word_ids, current = v_q where id = v_run.id;

  return jsonb_build_object('inventory', public.run_inventory(v_run), 'question', public.run_client_question(v_q));
end;
$$ language plpgsql security definer set search_path = public;

-- 自己ベスト: 記録は「到達」で並べ、depth も返す
create or replace function public.run_best(p_player_id uuid, p_mode text, p_week date, p_band int)
returns jsonb as $$
  select jsonb_build_object('correct', r.correct, 'depth', r.depth, 'total_ms', r.total_ms, 'finished_at', r.finished_at)
  from public.runs r
  where r.player_id = p_player_id
    and r.mode = p_mode
    and r.status = 'finished'
    and (p_week is null or r.week_start = p_week)
    and (p_band is null or r.band = p_band)
    and (p_mode = 'streak' or r.end_reason = 'complete')
  order by r.depth desc, r.total_ms asc, r.finished_at asc
  limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function public.run_best(p_player_id uuid, p_mode text, p_week date)
returns jsonb as $$
  select public.run_best(p_player_id, p_mode, p_week, null);
$$ language sql stable security definer set search_path = public;

drop function if exists public.start_run(text, int);
create or replace function public.start_run(p_mode text, p_band int default null, p_start_stage int default 1)
returns jsonb as $$
declare
  v_uid uuid;
  v_player public.players;
  v_old record;
  v_run public.runs;
  v_q jsonb;
  v_start int := coalesce(p_start_stage, 1);
  v_meta jsonb;
  v_offer jsonb;
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

  -- スタート地点は 1・3・5・8・10。一度たどり着いたところだけ（0017）
  if p_mode = 'streak' then
    if v_start not in (1, 3, 5, 8, 10) then
      raise exception 'invalid_start_stage';
    end if;
    if v_start > 1 and coalesce((select max(depth) from public.runs where player_id = v_uid and mode = 'streak' and status = 'finished'), 0) < (v_start - 1) * 5 then
      raise exception 'start_stage_locked';
    end if;
  else
    v_start := 1;
  end if;

  for v_old in
    select id from public.runs
    where player_id = v_uid and status <> 'finished'
    for update
  loop
    perform public.run_finish(v_old.id, 'abandoned');
  end loop;

  insert into public.runs (player_id, mode, band, start_stage, started_at, week_start)
  -- 100本ノックはレベルを選ぶ（A1=1 … 最難関=5）。選ばなければ自分の段
  values (v_uid, p_mode, case when p_mode = 'knock' then least(5, greatest(1, coalesce(p_band, v_player.tier))) else null end,
          v_start, public.jst_now(), public.jst_week_start())
  returning * into v_run;

  v_q := public.run_make_question(v_run);
  -- 系統樹 Lv4 から、最初の1問の前にカードを1枚選べる
  v_meta := public.meta_of(v_uid);
  if p_mode = 'streak' and (v_meta->>'level')::int >= 4 then
    v_offer := public.card_offer(v_uid);
  end if;
  if v_offer is not null and jsonb_array_length(v_offer) > 0 then
    update public.runs set current = v_q, offer = v_offer, status = 'card_offer' where id = v_run.id;
  else
    update public.runs set current = v_q where id = v_run.id;
    v_offer := null;
  end if;

  return jsonb_build_object(
    'run_id', v_run.id,
    'mode', p_mode,
    'band', v_run.band,
    'total', case when p_mode = 'knock' then 100 else null end,
    'best', public.run_best(v_uid, p_mode, null, v_run.band),
    'week_best', public.run_best(v_uid, p_mode, public.jst_week_start(), v_run.band),
    'start_stage', v_start,
    'depth', (v_start - 1) * 5,
    'inventory', public.run_inventory(v_run),
    'offer', v_offer,
    'question', case when v_offer is null then public.run_client_question(v_q) else null end
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
  -- depth は生成列。直前の update の値で読み直すため、ここでは select の結果を使う

  if v_run.status = 'finished' then
    return public.run_result(v_run.id);
  end if;

  v_prev_best := public.run_best(v_run.player_id, v_run.mode, null, v_run.band);
  v_prev_week_best := public.run_best(v_run.player_id, v_run.mode, v_run.week_start, v_run.band);

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

  v_nuts_raw := public.scale_nuts(v_nuts_raw * greatest(1, coalesce(v_run.coin_mult, 1)));

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
  -- スタッフもランキングに出る（2026-10-02）。順位と相手はスタッフにも返す
  if v_run.mode = 'streak' or p_reason = 'complete' then
    v_me := public.run_best(v_run.player_id, v_run.mode, v_run.week_start, v_run.band);
    if v_run.mode = 'streak' then
      select r.rank into v_rank from public.ranking_streak_week r
        join public.players p on p.nickname = r.nickname where p.id = v_run.player_id;
      select jsonb_build_object('nickname', r.nickname, 'correct', r.best_streak, 'rank', r.rank, 'is_staff', r.is_staff) into v_rival
        from public.ranking_streak_week r
        where r.rank < coalesce(v_rank, 999999)
        order by r.rank desc limit 1;
    else
      select r.rank into v_rank from public.ranking_knock_week r
        join public.players p on p.nickname = r.nickname where p.id = v_run.player_id and r.band = v_run.band;
      select jsonb_build_object('nickname', r.nickname, 'correct', r.best_correct, 'rank', r.rank, 'is_staff', r.is_staff) into v_rival
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
      -- 記録は「到達」（スタート地点のぶん＋連続）で比べる（0017）
      'new_best', (v_run.mode = 'streak' or p_reason = 'complete')
        and v_run.correct > 0
        and (v_prev_best is null or v_run.depth > (v_prev_best->>'depth')::int
             or (v_run.depth = (v_prev_best->>'depth')::int and v_run.total_ms < (v_prev_best->>'total_ms')::int)),
      'new_week_best', (v_run.mode = 'streak' or p_reason = 'complete')
        and v_run.correct > 0
        and (v_prev_week_best is null or v_run.depth > (v_prev_week_best->>'depth')::int
             or (v_run.depth = (v_prev_week_best->>'depth')::int and v_run.total_ms < (v_prev_week_best->>'total_ms')::int)),
      'meta', public.meta_of(v_run.player_id),
      'meta_gain', v_run.correct
    );
end;
$$ language plpgsql security definer set search_path = public;

create or replace view public.ranking_streak_week as
with best as (
  select distinct on (r.player_id)
    r.player_id, r.depth, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.week_start = public.jst_week_start()
    and r.correct > 0
  order by r.player_id, r.depth desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.depth as best_streak,   -- 0017 から「到達」（スタート地点のぶん＋連続）
  b.total_ms,
  rank() over (order by b.depth desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff
from best b
join public.players p on p.id = b.player_id
order by rank asc, nickname asc;

create or replace view public.ranking_streak_all as
with best as (
  select distinct on (r.player_id)
    r.player_id, r.depth, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.correct > 0
  order by r.player_id, r.depth desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.depth as best_streak,   -- 0017 から「到達」（スタート地点のぶん＋連続）
  b.total_ms,
  rank() over (order by b.depth desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff
from best b
join public.players p on p.id = b.player_id
order by rank asc, nickname asc;

create or replace function public.my_meta()
returns jsonb as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return public.meta_of(auth.uid());
end;
$$ language plpgsql stable security definer set search_path = public;

revoke all on function public.meta_of(uuid), public.card_offer(uuid), public.run_inventory(public.runs),
  public.run_make_question(public.runs), public.run_finish(uuid, text),
  public.run_best(uuid, text, date, int), public.run_best(uuid, text, date) from public, anon, authenticated;
revoke all on function public.answer_run(uuid, int, int), public.pick_card(uuid, text), public.use_fifty(uuid),
  public.skip_question(uuid), public.start_run(text, int, int), public.my_meta() from public, anon, authenticated;
grant execute on function public.answer_run(uuid, int, int), public.pick_card(uuid, text), public.use_fifty(uuid),
  public.skip_question(uuid), public.start_run(text, int, int), public.my_meta() to authenticated;
grant select on public.ranking_streak_week, public.ranking_streak_all to anon, authenticated;

commit;
