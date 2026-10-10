-- 0032: 早押し（正解なし）の問題（2026-10-10 本人「あしたの周年祭はくる？ いく！/いきたいけど・・/いけない/まよう のボタンだけで、ただの早押し時間を競う」）
--   kind = 'speed' の問題は、時間内にどれかを押せば正解として数え、かかった時間だけが順位に効く。
--   選択肢は並べ替えない。答えたあとに「みんなの答え」（押した数）を返す。

alter table public.quiz_questions add column kind text not null default 'quiz' check (kind in ('quiz', 'speed'));

create or replace function public.quiz_record(p_attempt public.quiz_attempts, p_choice smallint, p_elapsed_ms int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  q public.quiz_questions := public.quiz_question_at(p_attempt.set_id, p_attempt.position);
  total int;
  -- 早押し（正解なし）は、時間内にどれかを押せば正解として数える
  ok boolean := p_choice is not null and (q.kind = 'speed' or p_choice = q.answer);
begin
  insert into public.quiz_answers (attempt_id, position, question_id, choice, is_correct, elapsed_ms)
  values (p_attempt.id, p_attempt.position, q.id, p_choice, ok, p_elapsed_ms);
  select count(*) into total from public.quiz_set_items where set_id = p_attempt.set_id;
  update public.quiz_attempts set
    position = position + 1,
    served_at = null,
    current_order = null,
    correct = correct + case when ok then 1 else 0 end,
    total_ms = total_ms + p_elapsed_ms,
    finished_at = case when p_attempt.position + 1 >= total then now() else null end
  where id = p_attempt.id;
  return ok;
end;
$$;

create or replace function public.quiz_next(p_token text, p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
  a public.quiz_attempts;
  z public.quiz_sets;
  q public.quiz_questions;
  total int;
  limit_ms int;
begin
  select * into a from public.quiz_attempts where id = p_attempt and player_id = p.id for update;
  if not found then raise exception 'attempt_not_found'; end if;
  select * into z from public.quiz_sets where id = a.set_id;
  limit_ms := z.time_limit_sec * 1000;
  select count(*) into total from public.quiz_set_items where set_id = a.set_id;

  if a.served_at is not null and extract(epoch from (now() - a.served_at)) * 1000 > limit_ms + 1500 then
    perform public.quiz_record(a, null, limit_ms);
    select * into a from public.quiz_attempts where id = p_attempt;
  end if;

  if a.finished_at is not null or a.position >= total then
    return jsonb_build_object('done', true, 'correct', a.correct, 'total', total, 'total_ms', a.total_ms);
  end if;
  if (z.status <> 'open' or public.quiz_is_past(z)) and a.served_at is null then raise exception 'quiz_closed'; end if;

  q := public.quiz_question_at(a.set_id, a.position);
  if a.served_at is null then
    -- 早押し（正解なし）は並べ替えない（いく！→まよう の順に意味がある）
    update public.quiz_attempts set served_at = now(),
      current_order = case when q.kind = 'speed' then '{0,1,2,3}'::smallint[] else public.quiz_shuffled_order() end
     where id = a.id returning * into a;
  end if;

  return jsonb_build_object(
    'done', false, 'position', a.position, 'total', total,
    'body', q.body, 'image_path', q.image_path, 'kind', q.kind,
    'choices', (select jsonb_agg(q.choices[o + 1] order by n) from unnest(a.current_order) with ordinality as t(o, n)),
    'time_limit_sec', z.time_limit_sec,
    'remaining_ms', greatest(0, limit_ms - floor(extract(epoch from (now() - a.served_at)) * 1000)::int)
  );
end;
$$;

create or replace function public.quiz_answer(p_token text, p_attempt uuid, p_choice int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
  a public.quiz_attempts;
  z public.quiz_sets;
  q public.quiz_questions;
  total int;
  limit_ms int;
  elapsed int;
  timed_out boolean;
  ok boolean;
  board jsonb;
  brk jsonb;
  votes jsonb;
begin
  select * into a from public.quiz_attempts where id = p_attempt and player_id = p.id for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.finished_at is not null then raise exception 'already_played'; end if;
  if a.served_at is null then raise exception 'no_question'; end if;
  if p_choice is not null and (p_choice < 0 or p_choice > 3) then raise exception 'bad_choice'; end if;

  select * into z from public.quiz_sets where id = a.set_id;
  limit_ms := z.time_limit_sec * 1000;
  elapsed := floor(extract(epoch from (now() - a.served_at)) * 1000)::int;
  timed_out := p_choice is null or elapsed > limit_ms + 1500;
  elapsed := case when timed_out then limit_ms else least(elapsed, limit_ms) end;
  q := public.quiz_question_at(a.set_id, a.position);

  ok := public.quiz_record(a, case when timed_out then null else a.current_order[p_choice + 1] end, elapsed);
  select count(*) into total from public.quiz_set_items where set_id = a.set_id;

  select jsonb_build_object(
    'answered', count(*),
    'correct_rate', round(100.0 * count(*) filter (where qa.is_correct) / greatest(count(*), 1)),
    'fastest', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', f.nickname, 'ms', f.elapsed_ms, 'is_me', f.player_id = p.id) order by f.elapsed_ms, f.answered_at)
      from (
        select pl.nickname, qa2.elapsed_ms, qa2.answered_at, att2.player_id
          from public.quiz_answers qa2
          join public.quiz_attempts att2 on att2.id = qa2.attempt_id
          join public.quiz_players pl on pl.id = att2.player_id
         where att2.set_id = a.set_id and qa2.question_id = q.id and qa2.is_correct
         order by qa2.elapsed_ms, qa2.answered_at
         limit 5
      ) f), '[]'::jsonb)
  ) into board
  from public.quiz_answers qa join public.quiz_attempts att on att.id = qa.attempt_id
  where att.set_id = a.set_id and qa.question_id = q.id;

  -- 早押し（正解なし）は、みんなが押した割合（表示の順＝元の順）
  if q.kind = 'speed' then
    select jsonb_agg(coalesce(v.n, 0) order by i) into votes
      from generate_series(0, 3) as i
      left join (
        select qa.choice, count(*) as n
          from public.quiz_answers qa join public.quiz_attempts att on att.id = qa.attempt_id
         where att.set_id = a.set_id and qa.question_id = q.id and qa.choice is not null
         group by qa.choice
      ) v on v.choice = i;
  end if;

  select jsonb_build_object('title', b.title, 'body', b.body, 'image_path', b.image_path,
    'link_url', b.link_url, 'seconds', b.seconds) into brk
    from public.quiz_breaks b where b.set_id = a.set_id and b.after_position = a.position + 1;

  return jsonb_build_object(
    'correct', ok, 'timed_out', timed_out,
    'kind', q.kind,
    'answer', case when q.kind = 'speed' then null else array_position(a.current_order, q.answer::smallint) - 1 end,
    'choice', p_choice, 'votes', votes,
    'elapsed_ms', elapsed, 'done', a.position + 1 >= total,
    'position', a.position, 'board', board, 'break', brk
  );
end;
$$;
