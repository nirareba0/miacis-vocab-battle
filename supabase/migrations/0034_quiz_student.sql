-- 0034: 最初に「中高生」か「それ以外」かを選ぶ（2026-10-10 本人「中高生以外がランキングに載ってもしょうがない」）
--   それ以外の人も遊べるが、ランキング・参加人数・早押しトップ・1位のクーポンは中高生だけで決める。
--   いまの参加者は is_student が空なので、次に開いたときに選び直す（選ぶまで挑戦できない）。

alter table public.quiz_players add column is_student boolean;

drop function public.quiz_register(text, text);
create or replace function public.quiz_register(p_token text, p_nickname text, p_is_student boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
  nick text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
begin
  if char_length(nick) < 1 or char_length(nick) > 12 then raise exception 'bad_nickname'; end if;
  if p_is_student is null then raise exception 'no_student_choice'; end if;
  if exists (select 1 from public.quiz_players where lower(nickname) = lower(nick) and id <> p.id) then
    raise exception 'nickname_taken';
  end if;
  update public.quiz_players set nickname = nick, is_student = p_is_student where id = p.id;
  return jsonb_build_object('nickname', nick, 'is_student', p_is_student);
end;
$$;
revoke execute on function public.quiz_register(text, text, boolean) from public, anon, authenticated;
grant execute on function public.quiz_register(text, text, boolean) to anon, authenticated;

create or replace function public.quiz_me(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
begin
  return jsonb_build_object('nickname', p.nickname, 'is_student', p.is_student);
end;
$$;

create or replace function public.quiz_start(p_token text, p_set uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
  z public.quiz_sets;
  a public.quiz_attempts;
  total int;
begin
  if p.nickname is null or p.is_student is null then raise exception 'no_nickname'; end if;
  select * into z from public.quiz_sets where id = p_set;
  if not found or z.status = 'draft' then raise exception 'quiz_not_found'; end if;
  select * into a from public.quiz_attempts where set_id = p_set and player_id = p.id;
  if found and a.finished_at is not null then raise exception 'already_played'; end if;
  if z.status <> 'open' or public.quiz_is_past(z) then raise exception 'quiz_closed'; end if;
  select count(*) into total from public.quiz_set_items where set_id = p_set;
  if total = 0 then raise exception 'quiz_empty'; end if;
  if a.id is null then
    insert into public.quiz_attempts (set_id, player_id) values (p_set, p.id) returning * into a;
  end if;
  return jsonb_build_object('attempt_id', a.id, 'total', total, 'position', a.position,
    'time_limit_sec', z.time_limit_sec, 'title', z.title, 'closes_at', z.closes_at);
end;
$$;

create or replace function public.quiz_list(p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pid uuid;
begin
  if coalesce(p_token, '') <> '' then
    select s.player_id into pid from public.quiz_sessions s
     where s.token_hash = public.quiz_hash(p_token) and s.expires_at > now();
  end if;
  return (
    select coalesce(jsonb_agg(r order by r->>'status' desc, (r->>'opened_at') desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', z.id, 'title', z.title, 'time_limit_sec', z.time_limit_sec, 'prize', z.prize,
        'status', z.status, 'opened_at', z.opened_at, 'closed_at', z.closed_at, 'closes_at', z.closes_at,
        'total', (select count(*) from public.quiz_set_items i where i.set_id = z.id),
        'players', (select count(*) from public.quiz_attempts a2 join public.quiz_players p2 on p2.id = a2.player_id
                     where a2.set_id = z.id and a2.finished_at is not null and p2.is_student
                       and (z.closes_at is null or a2.finished_at <= z.closes_at)),
        'my_correct', a.correct, 'my_finished', a.finished_at is not null, 'my_started', a.id is not null
      ) as r
      from public.quiz_sets z
      left join public.quiz_attempts a on a.set_id = z.id and a.player_id = pid
      where z.status in ('open', 'closed')
    ) s
  );
end;
$$;

create or replace function public.quiz_ranking(p_set uuid, p_token text default null) returns table (
  rank int, nickname text, correct int, total_ms int, is_me boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  pid uuid;
begin
  if coalesce(p_token, '') <> '' then
    select s.player_id into pid from public.quiz_sessions s
     where s.token_hash = public.quiz_hash(p_token) and s.expires_at > now();
  end if;
  return query
    select (row_number() over (order by a.correct desc, a.total_ms asc, a.finished_at asc))::int,
      pl.nickname, a.correct, a.total_ms, coalesce(a.player_id = pid, false)
    from public.quiz_attempts a
    join public.quiz_players pl on pl.id = a.player_id
    join public.quiz_sets z on z.id = a.set_id
    where a.set_id = p_set and a.finished_at is not null and z.status <> 'draft' and pl.is_student
      and (z.closes_at is null or a.finished_at <= z.closes_at)
    order by 1
    limit 100;
end;
$$;

create or replace function public.quiz_close_internal(p_set uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  z public.quiz_sets;
  winner record;
  c public.quiz_coupons;
  msg text;
  st text;
begin
  select * into z from public.quiz_sets where id = p_set for update;
  if not found then raise exception 'quiz_not_found'; end if;
  if z.status <> 'open' then raise exception 'quiz_not_open'; end if;
  update public.quiz_sets set status = 'closed', closed_at = now() where id = p_set;

  -- 並べ方は quiz_ranking と同じ。締め切りより後に終えた人は数えない
  select pl.nickname, pl.line_sub, a.player_id into winner
    from public.quiz_attempts a join public.quiz_players pl on pl.id = a.player_id
   where a.set_id = p_set and a.finished_at is not null and pl.is_student
     and (z.closes_at is null or a.finished_at <= z.closes_at)
   order by a.correct desc, a.total_ms asc, a.finished_at asc
   limit 1;
  if not found then return jsonb_build_object('winner', null); end if;

  insert into public.quiz_coupons (code, set_id, player_id, prize, coupon_url)
  values (public.quiz_new_coupon_code(), p_set, winner.player_id, z.prize, z.coupon_url)
  returning * into c;

  msg := '🏆 「' || z.title || '」で1位！' || E'\n'
    || coalesce(z.prize, 'クーポン') || E'\n'
    || coalesce(c.coupon_url || E'\n', '')
    || '購買で、このメッセージかクイズの画面を見せてね（確認コード ' || c.code || '）';
  begin
    st := public.quiz_line_push(winner.line_sub, msg);
  exception when others then
    st := 'error';
  end;
  update public.quiz_coupons set push_status = st, pushed_at = case when st = 'sent' then now() end
   where id = c.id;
  return jsonb_build_object('winner', winner.nickname, 'code', c.code, 'prize', c.prize, 'push', st);
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
         where att2.set_id = a.set_id and qa2.question_id = q.id and qa2.is_correct and pl.is_student
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
