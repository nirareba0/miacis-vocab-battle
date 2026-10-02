-- 0015_words_v2.sql: 単語の段階を CEFR-J（A1〜B2）で付け直し、最難関に NAWL を足すための器（2026-10-02 本人「A にしよう。Stage10 から」）
-- データは seed/words_v2.sql（tools/build-words-v2.mjs が data/words_v2.csv から作る）。
--   level       : A1 / A2 / B1 / B2 / AC（AC = NAWL の学術語。CEFR-J に無いもの）
--   stage_range : 連続チャレンジの範囲 1〜10（A1=1-2, A2=3-4, B1=5-7, B2=8-9, AC=10）。STAGE 10（45問連続）から最難関
--   band        : 100本ノック・対戦の段（A1=1, A2=2, B1=3, B2=4, AC=5）
--   sort_key    : 全体の難しさの順（段階の中はよく使う順）
--   active      : 出題に使うか（新しいリストに無い NGSL の語は false。図鑑・履歴のために行は残す）
begin;

alter table public.words add column if not exists level text check (level is null or level in ('A1','A2','B1','B2','AC'));
alter table public.words add column if not exists stage_range smallint check (stage_range is null or stage_range between 1 and 10);
alter table public.words add column if not exists sort_key int;
alter table public.words add column if not exists source text not null default 'ngsl';
alter table public.words add column if not exists active boolean not null default true;
create unique index if not exists words_en_key on public.words (en);
create index if not exists idx_words_stage on public.words (stage_range) where active;

-- 出題する単語の集まり。stage_range が無い（古い・テストの）データは、よく使う順の 10 等分で代わりにする
create or replace function public.run_pool(p_mode text, p_range int, p_band int)
returns table (id int, en text, ja text) as $$
  select t.id, t.en, t.ja
  from (
    select w.id, w.en, w.ja, w.band, w.stage_range,
           ntile(10) over (order by coalesce(w.sort_key, w.rank)) as nt
    from public.words w
    where w.active
  ) t
  where case when p_mode = 'streak' then coalesce(t.stage_range, t.nt) = p_range else t.band = p_band end;
$$ language sql stable security definer set search_path = public;

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

create or replace function public.start_match()
returns jsonb as $$
declare
  v_uid uuid;
  v_tier smallint;
  v_match_id uuid;
  v_wrong_word_ids int[] := '{}';
  v_selected_word_ids int[] := '{}';
  v_picked_count int := 0;
  v_db_questions jsonb := '[]'::jsonb;
  v_client_questions jsonb := '[]'::jsonb;
  v_dirs text[] := array['en2ja','en2ja','en2ja','en2ja','en2ja','ja2en','ja2en','ja2en','ja2en','ja2en'];
  v_opp_record record;
  v_opponent jsonb;
  v_opp_summary jsonb;
  v_opp_correct smallint;
  v_opp_total_ms int;

  v_target_word public.words;
  v_distractors text[];
  v_choices text[];
  v_answer_idx int;
  v_prompt text;
  v_correct_choice text;
  v_dir text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select tier into v_tier from public.players where id = v_uid;
  if not found then
    raise exception 'player_not_found';
  end if;

  -- 1. Prioritize up to 4 words the player got wrong recently in this band
  with player_finished_matches as (
    select id, questions, answers, finished_at
    from public.matches
    where player_id = v_uid
      and finished_at is not null
      and band = v_tier
    order by finished_at desc
    limit 20
  ),
  unwound_answers as (
    select
      (q.elem->>'word_id')::int as word_id,
      m.finished_at
    from player_finished_matches m,
         jsonb_array_elements(m.questions) with ordinality as q(elem, idx),
         jsonb_array_elements(m.answers) with ordinality as a(elem, idx)
    where q.idx = a.idx
      and (
        (a.elem->>'choice') is null
        or (a.elem->>'choice')::int <> (q.elem->>'answer_index')::int
        or (a.elem->>'ms') is null
        or (a.elem->>'ms')::int >= 6000
      )
  ),
  distinct_wrong as (
    select distinct on (ua.word_id) ua.word_id, ua.finished_at
    from unwound_answers ua
    join public.words w on w.id = ua.word_id and w.band = v_tier and w.active
    order by ua.word_id, ua.finished_at desc
  )
  select array_agg(word_id)
  into v_wrong_word_ids
  from (
    select word_id from distinct_wrong order by finished_at desc limit 4
  ) sub;

  if v_wrong_word_ids is not null then
    v_selected_word_ids := v_wrong_word_ids;
    v_picked_count := array_length(v_selected_word_ids, 1);
  else
    v_selected_word_ids := '{}';
    v_picked_count := 0;
  end if;

  -- 2. Pick remaining words randomly from same band
  if v_picked_count < 10 then
    select v_selected_word_ids || coalesce(array_agg(id), '{}')
    into v_selected_word_ids
    from (
      select id from public.words
      where band = v_tier and active
        and id != all(v_selected_word_ids)
      order by random()
      limit (10 - v_picked_count)
    ) r;
  end if;

  -- If still under 10 (very small vocabulary pool in test), allow duplicates
  if coalesce(array_length(v_selected_word_ids, 1), 0) < 10 then
    select v_selected_word_ids || coalesce(array_agg(id), '{}')
    into v_selected_word_ids
    from (
      select id from public.words
      where band = v_tier and active
      order by random()
      limit (10 - coalesce(array_length(v_selected_word_ids, 1), 0))
    ) r;
  end if;

  -- 3. Shuffle directions
  select array_agg(d order by random()) into v_dirs from unnest(v_dirs) as d;

  -- 4. Build 10 questions
  for i in 1..10 loop
    select * into v_target_word from public.words where id = v_selected_word_ids[i];
    v_dir := v_dirs[i];

    if v_dir = 'en2ja' then
      v_prompt := v_target_word.en;
      v_correct_choice := v_target_word.ja;
      -- Select 3 distinct distractors from same band with different ja
      select array_agg(distinct ja) into v_distractors
      from (
        select ja from public.words
        where band = v_tier and active
          and ja <> v_correct_choice
        order by random()
        limit 3
      ) d;
    else -- ja2en
      v_prompt := v_target_word.ja;
      v_correct_choice := v_target_word.en;
      -- Select 3 distinct distractors from same band with different en
      select array_agg(distinct en) into v_distractors
      from (
        select en from public.words
        where band = v_tier and active
          and en <> v_correct_choice
          and ja <> v_target_word.ja
        order by random()
        limit 3
      ) d;
    end if;

    -- Guarantee 3 distractors even if vocabulary pool is small
    while coalesce(array_length(v_distractors, 1), 0) < 3 loop
      v_distractors := array_append(v_distractors, 'dummy_' || array_length(v_distractors, 1));
    end loop;

    -- Randomly place correct answer among 4 choices
    v_answer_idx := floor(random() * 4)::int;
    v_choices := '{}';
    for c_pos in 0..3 loop
      if c_pos = v_answer_idx then
        v_choices := array_append(v_choices, v_correct_choice);
      else
        v_choices := array_append(v_choices, v_distractors[1]);
        v_distractors := v_distractors[2:];
      end if;
    end loop;

    -- Store with answer_index in DB
    v_db_questions := v_db_questions || jsonb_build_array(jsonb_build_object(
      'word_id', v_target_word.id,
      'dir', v_dir,
      'prompt', v_prompt,
      'choices', to_jsonb(v_choices),
      'answer_index', v_answer_idx
    ));

    -- Return to client WITHOUT answer_index
    v_client_questions := v_client_questions || jsonb_build_array(jsonb_build_object(
      'word_id', v_target_word.id,
      'dir', v_dir,
      'prompt', v_prompt,
      'choices', to_jsonb(v_choices)
    ));
  end loop;

  -- 5. Matchmaking: find opponent from past 7 days, same tier, other player, finished
  select m.id, m.correct, m.total_ms, p.nickname
  into v_opp_record
  from public.matches m
  join public.players p on p.id = m.player_id
  where m.band = v_tier
    and m.player_id <> v_uid
    and m.finished_at is not null
    and m.started_at >= (public.jst_now() - interval '7 days')
  order by random()
  limit 1;

  if found then
    v_opponent := jsonb_build_object(
      'match_id', v_opp_record.id,
      'nickname', v_opp_record.nickname,
      'correct', v_opp_record.correct,
      'total_ms', v_opp_record.total_ms,
      'is_practice', false
    );
    v_opp_summary := jsonb_build_object(
      'nickname', v_opp_record.nickname,
      'is_practice', false
    );
  else
    -- Practice bot: Binomial distribution n=10, p=0.6, total_ms: 25000..45000
    select count(*)::smallint
    into v_opp_correct
    from generate_series(1, 10)
    where random() < 0.6;

    v_opp_total_ms := 25000 + floor(random() * 20001)::int;

    v_opponent := jsonb_build_object(
      'match_id', null,
      'nickname', '練習相手',
      'correct', v_opp_correct,
      'total_ms', v_opp_total_ms,
      'is_practice', true
    );
    v_opp_summary := jsonb_build_object(
      'nickname', '練習相手',
      'is_practice', true
    );
  end if;

  v_match_id := gen_random_uuid();
  insert into public.matches (
    id, player_id, band, questions, opponent, started_at, week_start
  ) values (
    v_match_id, v_uid, v_tier, v_db_questions, v_opponent, public.jst_now(), public.jst_week_start()
  );

  return jsonb_build_object(
    'match_id', v_match_id,
    'band', v_tier,
    'opponent', v_opp_summary,
    'questions', v_client_questions
  );
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

  with band_totals as (
    select b.band, coalesce(count(w.id), 0)::int as total
    from generate_series(1, 5) as b(band)
    left join public.words w on w.band = b.band and w.active
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

revoke all on function public.run_pool(text, int, int), public.run_make_question(public.runs) from public, anon, authenticated;
revoke all on function public.start_match(), public.my_words() from public, anon, authenticated;
grant execute on function public.start_match(), public.my_words() to authenticated;

-- 自己ベスト（band を渡すとそのレベルだけ。連続チャレンジは band が null なので絞らない）
create or replace function public.run_best(p_player_id uuid, p_mode text, p_week date, p_band int)
returns jsonb as $$
  select jsonb_build_object('correct', r.correct, 'total_ms', r.total_ms, 'finished_at', r.finished_at)
  from public.runs r
  where r.player_id = p_player_id
    and r.mode = p_mode
    and r.status = 'finished'
    and (p_week is null or r.week_start = p_week)
    and (p_band is null or r.band = p_band)
    and (p_mode = 'streak' or r.end_reason = 'complete')
  order by r.correct desc, r.total_ms asc, r.finished_at asc
  limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function public.run_result(p_run_id uuid)
returns jsonb as $$
  select jsonb_build_object(
    'run_id', r.id,
    'mode', r.mode,
    'band', r.band,
    'status', r.status,
    'end_reason', r.end_reason,
    'answered', r.answered,
    'correct', r.correct,
    'total_ms', r.total_ms,
    'revive_used', r.revive_used,
    'missed', r.missed,
    'learn_points', r.learn_points,
    'nuts', r.nuts,
    'best', public.run_best(r.player_id, r.mode, null, r.band),
    'week_best', public.run_best(r.player_id, r.mode, r.week_start, r.band)
  )
  from public.runs r where r.id = p_run_id;
$$ language sql stable security definer set search_path = public;

drop function if exists public.start_run(text);
create or replace function public.start_run(p_mode text, p_band int default null)
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
  -- 100本ノックはレベルを選ぶ（A1=1 … 最難関=5）。選ばなければ自分の段
  values (v_uid, p_mode, case when p_mode = 'knock' then least(5, greatest(1, coalesce(p_band, v_player.tier))) else null end,
          public.jst_now(), public.jst_week_start())
  returning * into v_run;

  v_q := public.run_make_question(v_run);
  update public.runs set current = v_q where id = v_run.id;

  return jsonb_build_object(
    'run_id', v_run.id,
    'mode', p_mode,
    'band', v_run.band,
    'total', case when p_mode = 'knock' then 100 else null end,
    'best', public.run_best(v_uid, p_mode, null, v_run.band),
    'week_best', public.run_best(v_uid, p_mode, public.jst_week_start(), v_run.band),
    'question', public.run_client_question(v_q)
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

revoke all on function public.run_best(uuid, text, date, int), public.run_result(uuid), public.run_finish(uuid, text) from public, anon, authenticated;
revoke all on function public.start_run(text, int) from public, anon, authenticated;
grant execute on function public.start_run(text, int) to authenticated;

commit;
