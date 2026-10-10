-- 0031: Miacis クイズを「生放送のクイズ番組」風に（2026-10-10 本人）
--   - 締め切り（例: 15:00）。締め切りまでに終えた人だけが順位に入り、締め切りで自動的に閉じて1位にクーポン
--   - 1位には公式LINE（Messaging API）で自動で知らせる。トークンが無いあいだはアプリの中だけ
--   - 1問ごとに「正解率」と「この問題の早押しトップ5（秒）」を返す
--   - お知らせ（CM）: 「◯問目のあと」に告知を挟む
--   - 自分の全問の記録（○×と秒）

alter table public.quiz_sets add column closes_at timestamptz;
alter table public.quiz_coupons add column pushed_at timestamptz;
alter table public.quiz_coupons add column push_status text;

create table public.quiz_breaks (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.quiz_sets(id) on delete cascade,
  after_position int not null check (after_position >= 1),   -- 「◯問目のあと」（1 始まり）
  title text not null check (char_length(title) between 1 and 40),
  body text check (body is null or char_length(body) <= 300),
  image_path text check (image_path is null or char_length(image_path) <= 300),
  link_url text check (link_url is null or (link_url ~ '^https://' and char_length(link_url) <= 500)),
  seconds int not null default 6 check (seconds between 3 and 30),
  created_at timestamptz not null default now(),
  unique (set_id, after_position)
);

-- ---------------------------------------------------------------- 内部の関数

-- 締め切りが過ぎたか
create or replace function public.quiz_is_past(p_set public.quiz_sets) returns boolean
language sql stable as $$
  select p_set.closes_at is not null and p_set.closes_at <= now();
$$;

-- 公式LINE（Messaging API）で1人に送る。トークンは Supabase Vault の 'line_messaging_token'。
-- 無ければ送らずに 'no_token' を返す。送れたら 'sent'、LINE がはじいたら 'http_<status>'
create or replace function public.quiz_line_push(p_to text, p_text text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  tok text;
  res record;
begin
  begin
    select decrypted_secret into tok from vault.decrypted_secrets where name = 'line_messaging_token' limit 1;
  exception when others then
    return 'no_token';
  end;
  if coalesce(tok, '') = '' then return 'no_token'; end if;
  select status into res from extensions.http((
    'POST', 'https://api.line.me/v2/bot/message/push',
    array[extensions.http_header('Authorization', 'Bearer ' || tok)],
    'application/json',
    jsonb_build_object('to', p_to, 'messages', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))::text
  )::extensions.http_request);
  return case when res.status = 200 then 'sent' else 'http_' || res.status end;
end;
$$;

-- 締め切って1位にクーポンを出し、LINE で知らせる（スタッフの「締め切る」と、締め切り時刻の自動の両方が使う）
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
   where a.set_id = p_set and a.finished_at is not null
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

-- 締め切り時刻を過ぎた公開中のクイズを閉じる（pg_cron が毎分呼ぶ。supabase/cron.sql）
create or replace function public.quiz_close_due() returns int
language plpgsql security definer set search_path = public as $$
declare
  s record;
  n int := 0;
begin
  for s in select id from public.quiz_sets where status = 'open' and closes_at is not null and closes_at <= now() loop
    perform public.quiz_close_internal(s.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------- 置き換える関数

create or replace function public.quiz_close(p_set uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.quiz_require_admin();
  return public.quiz_close_internal(p_set);
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
        'players', (select count(*) from public.quiz_attempts a2 where a2.set_id = z.id and a2.finished_at is not null
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

create or replace function public.quiz_start(p_token text, p_set uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
  z public.quiz_sets;
  a public.quiz_attempts;
  total int;
begin
  if p.nickname is null then raise exception 'no_nickname'; end if;
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

-- 0030 と同じ。締め切りを過ぎたら新しい問題を出さない
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
    update public.quiz_attempts set served_at = now(), current_order = public.quiz_shuffled_order()
     where id = a.id returning * into a;
  end if;

  return jsonb_build_object(
    'done', false, 'position', a.position, 'total', total,
    'body', q.body, 'image_path', q.image_path,
    'choices', (select jsonb_agg(q.choices[o + 1] order by n) from unnest(a.current_order) with ordinality as t(o, n)),
    'time_limit_sec', z.time_limit_sec,
    'remaining_ms', greatest(0, limit_ms - floor(extract(epoch from (now() - a.served_at)) * 1000)::int)
  );
end;
$$;

-- 0030 に「この問題の正解率・早押しトップ5」と「このあとのお知らせ」を足す
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

  select jsonb_build_object('title', b.title, 'body', b.body, 'image_path', b.image_path,
    'link_url', b.link_url, 'seconds', b.seconds) into brk
    from public.quiz_breaks b where b.set_id = a.set_id and b.after_position = a.position + 1;

  return jsonb_build_object(
    'correct', ok, 'timed_out', timed_out,
    'answer', array_position(a.current_order, q.answer::smallint) - 1,
    'elapsed_ms', elapsed, 'done', a.position + 1 >= total,
    'position', a.position, 'board', board, 'break', brk
  );
end;
$$;

-- 締め切りより後に終えた人は順位に入れない
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
    where a.set_id = p_set and a.finished_at is not null and z.status <> 'draft'
      and (z.closes_at is null or a.finished_at <= z.closes_at)
    order by 1
    limit 100;
end;
$$;

-- 自分の全問の記録（○×と秒）
create or replace function public.quiz_my_answers(p_token text, p_set uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'position', qa.position, 'correct', qa.is_correct, 'ms', qa.elapsed_ms, 'timed_out', qa.choice is null
    ) order by qa.position), '[]'::jsonb)
    from public.quiz_answers qa join public.quiz_attempts a on a.id = qa.attempt_id
    where a.set_id = p_set and a.player_id = p.id
  );
end;
$$;

create or replace function public.quiz_admin_coupons() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.quiz_require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', c.code, 'prize', c.prize, 'quiz_title', z.title, 'nickname', pl.nickname,
      'issued_at', c.issued_at, 'used_at', c.used_at, 'push_status', c.push_status
    ) order by c.issued_at desc), '[]'::jsonb)
    from public.quiz_coupons c
    join public.quiz_sets z on z.id = c.set_id
    left join public.quiz_players pl on pl.id = c.player_id
  );
end;
$$;

-- ---------------------------------------------------------------- RLS と権限

alter table public.quiz_breaks enable row level security;
create policy quiz_breaks_staff on public.quiz_breaks for all
  using (public.quiz_is_admin()) with check (public.quiz_is_admin());

revoke all on public.quiz_breaks from public, anon, authenticated;
grant select, insert, update, delete on public.quiz_breaks to authenticated;
revoke update (title, time_limit_sec, prize, coupon_url) on public.quiz_sets from authenticated;
revoke insert (title, time_limit_sec, prize, coupon_url) on public.quiz_sets from authenticated;
grant insert (title, time_limit_sec, prize, coupon_url, closes_at), update (title, time_limit_sec, prize, coupon_url, closes_at)
  on public.quiz_sets to authenticated;

revoke execute on function
  public.quiz_is_past(public.quiz_sets), public.quiz_line_push(text, text), public.quiz_close_internal(uuid),
  public.quiz_close_due(), public.quiz_my_answers(text, uuid)
  from public, anon, authenticated;
grant execute on function public.quiz_my_answers(text, uuid) to anon, authenticated;
