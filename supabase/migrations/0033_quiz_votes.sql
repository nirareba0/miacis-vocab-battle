-- 0033: 答えたあとに、選択肢ごとに押した人数を返す（2026-10-10 本人「感謝祭風に」。番組は正解発表で「何番に何人」を出す）
--   0032 では早押し（正解なし）の問題だけ返していた。ふつうの問題も、この人の画面の並び順で返す。

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

  -- 選択肢ごとに押した人数（この人の画面の並び順。番組の「何番に何人」）
  select jsonb_agg(coalesce(v.cnt, 0) order by t.pos) into votes
    from unnest(a.current_order) with ordinality as t(o, pos)
    left join (
      select qa.choice, count(*) as cnt
        from public.quiz_answers qa join public.quiz_attempts att on att.id = qa.attempt_id
       where att.set_id = a.set_id and qa.question_id = q.id and qa.choice is not null
       group by qa.choice
    ) v on v.choice = t.o;

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
