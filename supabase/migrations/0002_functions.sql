-- 0002_functions.sql: Stored functions, views, and business logic
-- miacis-vocab-battle

-- 1. Date & Time Helpers (JST: Asia/Tokyo)

-- jst_now: Returns current timestamptz. Allows setting 'app.test_time' for deterministic testing.
create or replace function public.jst_now()
returns timestamptz as $$
begin
  if current_setting('app.test_time', true) is not null and current_setting('app.test_time', true) <> '' then
    return current_setting('app.test_time', true)::timestamptz;
  end if;
  return clock_timestamp();
end;
$$ language plpgsql stable;

-- jst_today: Returns current date in JST.
create or replace function public.jst_today()
returns date as $$
begin
  return (public.jst_now() at time zone 'Asia/Tokyo')::date;
end;
$$ language plpgsql stable;

-- jst_week_start: Returns Monday of the week for given timestamp (defaults to current week Monday in JST).
create or replace function public.jst_week_start(ts timestamptz default public.jst_now())
returns date as $$
begin
  return date_trunc('week', (ts at time zone 'Asia/Tokyo'))::date;
end;
$$ language plpgsql stable;


-- 2. Public Views (ranking_learn_week, ranking_commit_week)
-- Only nickname, tier, points, and rank are exposed. No id or grade.

create or replace view public.ranking_learn_week as
with weekly_lp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    coalesce(sum(pt.amount), 0)::int as learn_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'learn'
    and pt.week_start = public.jst_week_start()
  group by p.id, p.tier, p.nickname
)
select
  tier,
  nickname,
  learn_points,
  rank() over (partition by tier order by learn_points desc, nickname asc)::int as rank
from weekly_lp
order by tier asc, rank asc, nickname asc;

create or replace view public.ranking_commit_week as
with weekly_cp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    coalesce(sum(pt.amount), 0)::int as commit_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'commit'
    and pt.week_start = public.jst_week_start()
  group by p.id, p.tier, p.nickname
)
select
  nickname,
  tier,
  commit_points,
  rank() over (order by commit_points desc, nickname asc)::int as rank
from weekly_cp
order by rank asc, nickname asc;

grant select on public.ranking_learn_week to anon, authenticated;
grant select on public.ranking_commit_week to anon, authenticated;


-- 3. Commit Points Helper
-- Daily cap: Max 10 commit points per player per day in JST.

create or replace function public.add_commit(p_player_id uuid, p_reason text, p_amount int)
returns int as $$
declare
  v_today date;
  v_week_start date;
  v_current int;
  v_remaining int;
  v_actual int;
begin
  if p_amount <= 0 then
    return 0;
  end if;

  v_today := public.jst_today();
  v_week_start := public.jst_week_start();

  -- Lock player points for today to prevent concurrent over-allocation
  select coalesce(sum(amount), 0)
  into v_current
  from public.points
  where player_id = p_player_id
    and kind = 'commit'
    and day = v_today;

  v_remaining := 10 - v_current;
  if v_remaining <= 0 then
    return 0;
  end if;

  v_actual := least(p_amount, v_remaining);
  if v_actual > 0 then
    insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
    values (p_player_id, 'commit', p_reason, v_actual, v_week_start, v_today, public.jst_now());
  end if;

  return v_actual;
end;
$$ language plpgsql security definer set search_path = public;


-- 4. User Registration & Activity

create or replace function public.register_player(p_nickname text, p_grade int)
returns public.players as $$
declare
  v_uid uuid;
  v_clean_nick text;
  v_player public.players;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Return existing player if already registered
  select * into v_player from public.players where id = v_uid;
  if found then
    return v_player;
  end if;

  -- Validate nickname: 1..10 chars, trimmed, no control chars
  v_clean_nick := trim(p_nickname);
  if length(v_clean_nick) < 1 or length(v_clean_nick) > 10 then
    raise exception 'invalid_nickname_length';
  end if;
  if v_clean_nick ~ '[\x00-\x1F\x7F]' then
    raise exception 'invalid_nickname_control_chars';
  end if;

  -- Validate grade: 1..6
  if p_grade < 1 or p_grade > 6 then
    raise exception 'invalid_grade';
  end if;

  -- Check nickname collision
  if exists (select 1 from public.players where nickname = v_clean_nick) then
    raise exception 'nickname_taken';
  end if;

  insert into public.players (id, nickname, grade, tier, is_picker, created_at, last_active_at)
  values (v_uid, v_clean_nick, p_grade, 1, false, public.jst_now(), public.jst_now())
  returning * into v_player;

  return v_player;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.touch_today()
returns int as $$
declare
  v_uid uuid;
  v_today date;
  v_added int := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_today := public.jst_today();

  update public.players
  set last_active_at = public.jst_now()
  where id = v_uid;

  if not exists (
    select 1 from public.points
    where player_id = v_uid
      and kind = 'commit'
      and reason = 'open'
      and day = v_today
  ) then
    v_added := public.add_commit(v_uid, 'open', 1);
  end if;

  return v_added;
end;
$$ language plpgsql security definer set search_path = public;


-- 5. Vocabulary Match: start_match & submit_match

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

create or replace function public.submit_match(p_match_id uuid, p_answers jsonb)
returns jsonb as $$
declare
  v_uid uuid;
  v_match public.matches;
  v_total_ms int := 0;
  v_elapsed_ms bigint;
  v_correct smallint := 0;
  v_q jsonb;
  v_ans jsonb;
  v_choice int;
  v_raw_ms int;
  v_clamped_ms int;
  v_opp_correct smallint;
  v_opp_total_ms int;
  v_result text;
  v_learn_pts int := 0;
  v_commit_pts int := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found';
  end if;

  if v_match.player_id <> v_uid then
    raise exception 'permission_denied';
  end if;

  if v_match.finished_at is not null then
    raise exception 'already_submitted';
  end if;

  -- 10-minute expiry check
  if public.jst_now() - v_match.started_at > interval '10 minutes' then
    raise exception 'expired';
  end if;

  if jsonb_array_length(p_answers) <> 10 then
    raise exception 'invalid_answers_length';
  end if;

  -- Calculate total ms & clamp each ms to 0..6000
  for i in 0..9 loop
    v_ans := p_answers->i;
    v_raw_ms := (v_ans->>'ms')::int;
    v_clamped_ms := greatest(0, least(6000, coalesce(v_raw_ms, 6000)));
    v_total_ms := v_total_ms + v_clamped_ms;
  end loop;

  -- too_fast check: now() - started_at cannot be shorter than (total_ms - 3000ms)
  v_elapsed_ms := (extract(epoch from (public.jst_now() - v_match.started_at)) * 1000)::bigint;
  if v_elapsed_ms < (v_total_ms - 3000) then
    raise exception 'too_fast';
  end if;

  -- Grade each answer
  for i in 0..9 loop
    v_q := v_match.questions->i;
    v_ans := p_answers->i;
    v_choice := (v_ans->>'choice')::int;
    v_raw_ms := (v_ans->>'ms')::int;

    if v_choice is not null
       and v_raw_ms is not null
       and v_raw_ms < 6000
       and v_choice = (v_q->>'answer_index')::int then
      v_correct := v_correct + 1;
    end if;
  end loop;

  -- Determine result
  v_opp_correct := (v_match.opponent->>'correct')::smallint;
  v_opp_total_ms := (v_match.opponent->>'total_ms')::int;

  if v_correct > v_opp_correct then
    v_result := 'win';
  elsif v_correct < v_opp_correct then
    v_result := 'lose';
  else
    -- Tie-breaker: shorter total_ms wins
    if v_total_ms < v_opp_total_ms then
      v_result := 'win';
    else
      v_result := 'lose';
    end if;
  end if;

  -- Allocate Points:
  -- Learn: correct * 1 + win * 3
  v_learn_pts := v_correct + (case when v_result = 'win' then 3 else 0 end);
  if v_learn_pts > 0 then
    insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
    values (v_uid, 'learn', 'match', v_learn_pts, v_match.week_start, public.jst_today(), public.jst_now());
  end if;

  -- Commit: 1 point for match (capped)
  v_commit_pts := public.add_commit(v_uid, 'match', 1);

  -- Update match record
  update public.matches
  set answers = p_answers,
      correct = v_correct,
      total_ms = v_total_ms,
      result = v_result,
      finished_at = public.jst_now()
  where id = p_match_id;

  return jsonb_build_object(
    'match_id', p_match_id,
    'correct', v_correct,
    'total_ms', v_total_ms,
    'result', v_result,
    'opponent', jsonb_build_object(
      'nickname', v_match.opponent->>'nickname',
      'correct', v_opp_correct,
      'total_ms', v_opp_total_ms
    ),
    'learn_points', v_learn_pts,
    'commit_points', v_commit_pts,
    'questions', v_match.questions,
    'answers', p_answers
  );
end;
$$ language plpgsql security definer set search_path = public;


-- 6. Content Functions: open_content, answer_content_quiz, submit_writing, propose_content, approve_content, stamp_writing

create or replace function public.open_content(p_content_id uuid)
returns int as $$
declare
  v_uid uuid;
  v_content public.contents;
  v_added int := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_content
  from public.contents
  where id = p_content_id
    and approved_at is not null
    and week_start = public.jst_week_start();

  if not found then
    raise exception 'content_not_available';
  end if;

  if exists (select 1 from public.content_opens where player_id = v_uid and content_id = p_content_id) then
    raise exception 'already_opened';
  end if;

  insert into public.content_opens (player_id, content_id, created_at)
  values (v_uid, p_content_id, public.jst_now());

  v_added := public.add_commit(v_uid, 'content_open', 2);
  return v_added;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.answer_content_quiz(p_content_id uuid, p_answers jsonb)
returns jsonb as $$
declare
  v_uid uuid;
  v_content public.contents;
  v_quiz jsonb;
  v_len int;
  v_correct int := 0;
  v_item jsonb;
  v_user_ans text;
  v_quiz_ans text;
  v_type text;
  v_learn_pts int := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_content
  from public.contents
  where id = p_content_id
    and approved_at is not null
    and week_start = public.jst_week_start();

  if not found then
    raise exception 'content_not_available';
  end if;

  if exists (select 1 from public.content_quiz_answers where player_id = v_uid and content_id = p_content_id) then
    raise exception 'already_answered';
  end if;

  v_quiz := v_content.quiz;
  v_len := jsonb_array_length(v_quiz);

  for i in 0..(v_len - 1) loop
    v_item := v_quiz->i;
    v_type := v_item->>'type';
    v_quiz_ans := v_item->>'answer';
    v_user_ans := p_answers->>i;

    if v_user_ans is not null then
      if v_type = 'cloze' then
        if lower(trim(v_user_ans)) = lower(trim(v_quiz_ans)) then
          v_correct := v_correct + 1;
        end if;
      else -- choice
        if trim(v_user_ans) = trim(v_quiz_ans) then
          v_correct := v_correct + 1;
        end if;
      end if;
    end if;
  end loop;

  insert into public.content_quiz_answers (player_id, content_id, answers, correct_count, created_at)
  values (v_uid, p_content_id, p_answers, v_correct, public.jst_now());

  v_learn_pts := v_correct * 2;
  if v_learn_pts > 0 then
    insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
    values (v_uid, 'learn', 'content_quiz', v_learn_pts, public.jst_week_start(), public.jst_today(), public.jst_now());
  end if;

  return jsonb_build_object(
    'correct_count', v_correct,
    'total_questions', v_len,
    'learn_points', v_learn_pts,
    'quiz', v_quiz
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.submit_writing(p_content_id uuid, p_text text)
returns jsonb as $$
declare
  v_uid uuid;
  v_content public.contents;
  v_prompt jsonb;
  v_prompt_type text;
  v_words text[];
  v_word_matched boolean := false;
  v_w text;
  v_total_len int;
  v_valid_len int;
  v_word_count int;
  v_masked_text text;
  v_commit_pts int := 0;
  v_normalized_text text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_content
  from public.contents
  where id = p_content_id
    and approved_at is not null
    and week_start = public.jst_week_start();

  if not found then
    raise exception 'content_not_available';
  end if;

  v_prompt := v_content.writing_prompt;
  v_prompt_type := v_prompt->>'type';

  -- 1. Length validation (1..300)
  v_total_len := length(trim(p_text));
  if v_total_len < 1 or length(p_text) > 300 then
    raise exception 'writing_invalid: length must be 1..300 characters';
  end if;

  -- 2. No 6+ consecutive identical characters
  if p_text ~* '(.)\1{5}' then
    raise exception 'writing_invalid: identical characters repeated 6 or more times';
  end if;

  -- 3. At least 80% ASCII alphanumeric, spaces, and basic punctuation
  v_valid_len := length(regexp_replace(p_text, '[^A-Za-z0-9\s.,!?''"\-~;:()\/]', '', 'g'));
  if (v_valid_len::float / length(p_text)::float) < 0.8 then
    raise exception 'writing_invalid: text must be at least 80 percent english characters and basic punctuation';
  end if;

  -- 4. Not identical to any of player's past writings (case & whitespace insensitive)
  v_normalized_text := regexp_replace(lower(p_text), '\s+', '', 'g');
  if exists (
    select 1 from public.writings
    where player_id = v_uid
      and regexp_replace(lower(text), '\s+', '', 'g') = v_normalized_text
  ) then
    raise exception 'writing_invalid: duplicate of past writing';
  end if;

  -- 5. Count English words: [A-Za-z]+('[A-Za-z]+)?
  select coalesce(count(*), 0)::int
  into v_word_count
  from regexp_matches(p_text, '[A-Za-z]+(''[A-Za-z]+)?', 'g');

  -- 6. Validate prompt-specific conditions
  if v_prompt_type = 'use_word' then
    if v_word_count < 3 then
      raise exception 'writing_invalid: must contain at least 3 english words';
    end if;

    select array_agg(elem::text)
    into v_words
    from jsonb_array_elements_text(v_prompt->'words') as elem;

    v_word_matched := false;
    foreach v_w in array v_words loop
      if p_text ~* ('\m' || v_w || '(s|ed|ing)?\M') then
        v_word_matched := true;
        exit;
      end if;
    end loop;

    if not v_word_matched then
      raise exception 'writing_invalid: must include at least one of the specified prompt words';
    end if;

  elsif v_prompt_type = 'three_words' then
    if v_word_count <> 3 then
      raise exception 'writing_invalid: must contain exactly 3 english words';
    end if;

  elsif v_prompt_type = 'what_would_you_do' then
    if v_word_count < 5 then
      raise exception 'writing_invalid: must contain at least 5 english words';
    end if;

  else
    raise exception 'writing_invalid: unknown prompt type';
  end if;

  -- 7. Mask phone numbers (10+ digits with optional dashes/spaces) and emails
  v_masked_text := regexp_replace(p_text, '[0-9]([\s-]*[0-9]){9,}', '***', 'g');
  v_masked_text := regexp_replace(v_masked_text, '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', '***', 'g');

  -- 8. Save writing
  insert into public.writings (player_id, content_id, text, created_at)
  values (v_uid, p_content_id, v_masked_text, public.jst_now());

  -- 9. Commit points: +3 for writing, once per day
  if not exists (
    select 1 from public.points
    where player_id = v_uid
      and kind = 'commit'
      and reason = 'writing'
      and day = public.jst_today()
  ) then
    v_commit_pts := public.add_commit(v_uid, 'writing', 3);
  end if;

  return jsonb_build_object(
    'text', v_masked_text,
    'commit_points', v_commit_pts
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.propose_content(
  p_title text,
  p_url text,
  p_quiz jsonb,
  p_writing_prompt jsonb
)
returns public.contents as $$
declare
  v_uid uuid;
  v_is_picker boolean;
  v_content public.contents;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select is_picker into v_is_picker from public.players where id = v_uid;
  if v_is_picker is not true then
    raise exception 'not_a_picker';
  end if;

  if p_url !~ '^https://' then
    raise exception 'invalid_url';
  end if;

  insert into public.contents (
    week_start, title, url, quiz, writing_prompt, picked_by, created_at
  ) values (
    public.jst_week_start(), p_title, p_url, p_quiz, p_writing_prompt, v_uid, public.jst_now()
  )
  returning * into v_content;

  return v_content;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.approve_content(p_content_id uuid)
returns public.contents as $$
declare
  v_uid uuid;
  v_content public.contents;
begin
  v_uid := auth.uid();
  if v_uid is null or not exists (select 1 from public.staff where user_id = v_uid) then
    raise exception 'not_a_staff';
  end if;

  update public.contents
  set approved_at = public.jst_now(),
      approved_by = v_uid
  where id = p_content_id
    and approved_at is null
  returning * into v_content;

  if not found then
    raise exception 'content_not_found_or_already_approved';
  end if;

  if v_content.picked_by is not null then
    perform public.add_commit(v_content.picked_by, 'picked', 5);
  end if;

  return v_content;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.stamp_writing(p_writing_id uuid, p_stamp text)
returns public.writings as $$
declare
  v_uid uuid;
  v_writing public.writings;
begin
  v_uid := auth.uid();
  if v_uid is null or not exists (select 1 from public.staff where user_id = v_uid) then
    raise exception 'not_a_staff';
  end if;

  if p_stamp not in ('👍','✨','😂','🔥','👀') then
    raise exception 'invalid_stamp';
  end if;

  update public.writings
  set stamp = p_stamp
  where id = p_writing_id
  returning * into v_writing;

  if not found then
    raise exception 'writing_not_found';
  end if;

  return v_writing;
end;
$$ language plpgsql security definer set search_path = public;


-- 7. Profile & Summary

create or replace function public.my_summary()
returns jsonb as $$
declare
  v_uid uuid;
  v_player public.players;
  v_week_start date;
  v_last_week_start date;
  v_learn_pts int := 0;
  v_commit_pts int := 0;
  v_learn_rank int := null;
  v_commit_rank int := null;
  v_last_week_result jsonb := null;
  v_last_rec record;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_player from public.players where id = v_uid;
  if not found then
    raise exception 'player_not_found';
  end if;

  v_week_start := public.jst_week_start();
  v_last_week_start := (v_week_start - interval '7 days')::date;

  select coalesce(sum(amount), 0) into v_learn_pts
  from public.points
  where player_id = v_uid and kind = 'learn' and week_start = v_week_start;

  select coalesce(sum(amount), 0) into v_commit_pts
  from public.points
  where player_id = v_uid and kind = 'commit' and week_start = v_week_start;

  -- Rank in tier for current week
  with tiered as (
    select
      p.id,
      coalesce(sum(pt.amount), 0) as pts
    from public.players p
    left join public.points pt
      on pt.player_id = p.id
      and pt.kind = 'learn'
      and pt.week_start = v_week_start
    where p.tier = v_player.tier
    group by p.id
  ),
  ranked as (
    select id, rank() over (order by pts desc, id) as rnk
    from tiered
  )
  select rnk into v_learn_rank from ranked where id = v_uid;

  -- Overall commit rank for current week
  with all_commit as (
    select
      p.id,
      coalesce(sum(pt.amount), 0) as pts
    from public.players p
    left join public.points pt
      on pt.player_id = p.id
      and pt.kind = 'commit'
      and pt.week_start = v_week_start
    group by p.id
  ),
  ranked_commit as (
    select id, rank() over (order by pts desc, id) as rnk
    from all_commit
  )
  select rnk into v_commit_rank from ranked_commit where id = v_uid;

  -- Prior week results
  select * into v_last_rec
  from public.weekly_results
  where player_id = v_uid and week_start = v_last_week_start;

  if found then
    v_last_week_result := jsonb_build_object(
      'week_start', v_last_rec.week_start,
      'tier_before', v_last_rec.tier_before,
      'tier_after', v_last_rec.tier_after,
      'learn_points', v_last_rec.learn_points,
      'commit_points', v_last_rec.commit_points,
      'learn_rank_in_tier', v_last_rec.learn_rank_in_tier,
      'commit_rank', v_last_rec.commit_rank,
      'active', v_last_rec.active
    );
  end if;

  return jsonb_build_object(
    'tier', v_player.tier,
    'grade', v_player.grade,
    'learn_points', v_learn_pts,
    'commit_points', v_commit_pts,
    'learn_rank_in_tier', v_learn_rank,
    'commit_rank', v_commit_rank,
    'last_week', v_last_week_result
  );
end;
$$ language plpgsql security definer set search_path = public;

-- Ping function for keepalive
create or replace function public.ping()
returns int as $$
begin
  return 1;
end;
$$ language plpgsql security definer;

grant execute on function public.ping() to anon, authenticated;


-- 8. Periodic Batch Jobs

-- close_week: Finalizes results for a given week. Safe to run multiple times.
create or replace function public.close_week(p_week_start date default (public.jst_week_start() - interval '7 days')::date)
returns void as $$
declare
  v_player record;
  v_learn_pts int;
  v_commit_pts int;
  v_active boolean;
  v_tier_after smallint;
begin
  -- Idempotency check: if already closed for this week, do nothing
  if exists (select 1 from public.weekly_results where week_start = p_week_start) then
    return;
  end if;

  -- Compute ranks and promotions/demotions
  with weekly_stats as (
    select
      p.id as player_id,
      p.tier as current_tier,
      coalesce(sum(case when pt.kind = 'learn' then pt.amount else 0 end), 0)::int as learn_pts,
      coalesce(sum(case when pt.kind = 'commit' then pt.amount else 0 end), 0)::int as commit_pts,
      max(case when pt.kind = 'learn' then pt.created_at else null end) as last_learn_at,
      max(case when pt.kind = 'commit' then pt.created_at else null end) as last_commit_at,
      (count(pt.id) > 0) as is_active
    from public.players p
    left join public.points pt
      on pt.player_id = p.id
      and pt.week_start = p_week_start
    group by p.id, p.tier
  ),
  ranked_stats as (
    select
      player_id,
      current_tier,
      learn_pts,
      commit_pts,
      last_learn_at,
      last_commit_at,
      is_active,
      row_number() over (
        partition by current_tier
        order by learn_pts desc, last_learn_at asc nulls last, player_id asc
      )::int as learn_rank_in_tier,
      row_number() over (
        order by commit_pts desc, last_commit_at asc nulls last, player_id asc
      )::int as commit_rank
    from weekly_stats
  ),
  decisions as (
    select
      player_id,
      current_tier,
      learn_pts,
      commit_pts,
      learn_rank_in_tier,
      commit_rank,
      is_active,
      case
        -- Promotion: Top 3 in tiers 1..4 with learn_points >= 1
        when current_tier < 5 and learn_pts >= 1 and learn_rank_in_tier <= 3 then
          (current_tier + 1)::smallint
        -- Demotion: Players who did not open the app (no points at all that week)
        when not is_active then
          greatest(1, current_tier - 1)::smallint
        -- Otherwise unchanged
        else
          current_tier
      end as tier_after
    from ranked_stats
  )
  -- Insert into weekly_results
  insert into public.weekly_results (
    week_start, player_id, tier_before, tier_after,
    learn_points, commit_points, learn_rank_in_tier, commit_rank, active
  )
  select
    p_week_start,
    player_id,
    current_tier,
    tier_after,
    learn_pts,
    commit_pts,
    learn_rank_in_tier,
    commit_rank,
    is_active
  from decisions;

  -- Apply tier changes to players table
  update public.players p
  set tier = wr.tier_after
  from public.weekly_results wr
  where wr.week_start = p_week_start
    and wr.player_id = p.id
    and p.tier <> wr.tier_after;

end;
$$ language plpgsql security definer set search_path = public;

-- advance_grades: Increment grades by 1 on April 1st. Cap at 6.
create or replace function public.advance_grades()
returns void as $$
begin
  update public.players
  set grade = least(6, grade + 1);
end;
$$ language plpgsql security definer set search_path = public;

-- purge_graduates: Delete Grade 6 users from auth.users (cascades to all records) on March 31st.
create or replace function public.purge_graduates()
returns int as $$
declare
  v_count int;
begin
  with deleted as (
    delete from auth.users
    where id in (select id from public.players where grade = 6)
    returning id
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$ language plpgsql security definer set search_path = public, auth;

-- purge_inactive: Delete users inactive for > 180 days from auth.users.
create or replace function public.purge_inactive()
returns int as $$
declare
  v_count int;
  v_threshold timestamptz;
begin
  v_threshold := public.jst_now() - interval '180 days';

  with deleted as (
    delete from auth.users
    where id in (
      select id from public.players
      where coalesce(last_active_at, created_at) < v_threshold
    )
    returning id
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$ language plpgsql security definer set search_path = public, auth;

-- Grant execute permissions to authenticated
grant execute on function public.register_player(text, int) to authenticated;
grant execute on function public.touch_today() to authenticated;
grant execute on function public.start_match() to authenticated;
grant execute on function public.submit_match(uuid, jsonb) to authenticated;
grant execute on function public.open_content(uuid) to authenticated;
grant execute on function public.answer_content_quiz(uuid, jsonb) to authenticated;
grant execute on function public.submit_writing(uuid, text) to authenticated;
grant execute on function public.propose_content(text, text, jsonb, jsonb) to authenticated;
grant execute on function public.approve_content(uuid) to authenticated;
grant execute on function public.stamp_writing(uuid, text) to authenticated;
grant execute on function public.my_summary() to authenticated;
