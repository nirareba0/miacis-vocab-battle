-- 0014_no_repeat_words.sql: 1回の挑戦で同じ単語を出さない（2026-10-02 本人「同じ単語が出ているらしい」）
-- 原因: 範囲（連続チャレンジ STAGE 10 以降は264語）を使い切ると同じ単語を出し直していた。
-- もう一つ: 日本語訳が同じ単語の組が19組ある（start / begin が「始まる、始める」など）。日本語→英語で両方が
-- 選択肢に並ぶと、どちらも正解になる。
begin;

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
    where w.id <> all(p_run.used_word_ids)
      and w.ja not in (select u.ja from public.words u where u.id = any(p_run.used_word_ids))
    order by
      case when p_run.mode = 'streak' then -(w.rank / 50) else abs(w.band - coalesce(p_run.band, 1)) end,
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
    join public.words w on w.id = ua.word_id and w.band = v_tier
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
      where band = v_tier
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
      where band = v_tier
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
        where band = v_tier
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
        where band = v_tier
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

revoke all on function public.run_make_question(public.runs) from public, anon, authenticated;
revoke all on function public.start_match() from public, anon, authenticated;
grant execute on function public.start_match() to authenticated;

commit;
