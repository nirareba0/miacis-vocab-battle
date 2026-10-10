-- 0030: Miacis クイズ（2026-10-10 本人）。仕様は AIOS `core/projects/miacis/specs/quiz-app-20261010.md`
--   スタッフが問題（画像つき可）をストックし、ストックから選んでクイズを公開する。
--   遊ぶ人は公式LINE から開き、LINE ログイン（LIFF）で参加する。1 LINE アカウント1クイズ1回。
--   ランキングにはクイズで決めた名前だけを出す（LINE の名前は使わない・取らない）。
--   締め切ると1位にクーポンが1枚出る（公式LINE のクーポンの URL と、確認用の6文字のコード）。
--
-- 英単語アプリとは表を分ける（名前はすべて quiz_）。英単語の players・ポイントには触らない。
-- 管理者は英単語アプリのスタッフ（public.staff）。
-- 遊ぶ人は Supabase のログインを使わない（匿名ログインを有効にしない）。LINE の ID トークンを
-- サーバーで確かめて、クイズ用のセッション（ランダムな文字列）を返す。遊ぶ人の関数はそれを受け取る。
--
-- 守ること
--   - 問題の正解は、答えを送る前に端末へ渡さない（quiz_questions はスタッフしか読めない）
--   - 時間は端末を信じない。出題した時刻をサーバーに残し、答えた時刻との差で測る（猶予 1.5 秒）
--   - 点数とクーポンは端末から書けない。書くのは security definer の関数だけ

-- ---------------------------------------------------------------- テーブル

create table public.quiz_players (
  id uuid primary key default gen_random_uuid(),
  line_sub text not null unique,      -- LINE の userId（このプロバイダーの中だけで通じる ID）
  nickname text check (nickname is null or char_length(nickname) between 1 and 12),
  created_at timestamptz not null default now()
);
create unique index quiz_players_nickname_key on public.quiz_players (lower(nickname)) where nickname is not null;

-- セッションは文字列そのものを持たず、sha256 だけを持つ
create table public.quiz_sessions (
  token_hash text primary key,
  player_id uuid not null references public.quiz_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days'
);

-- 問題ストック。choices は表示順の元（正解は answer の添字 0〜3）
create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 1 and 300),
  image_path text check (image_path is null or char_length(image_path) <= 300),
  choices text[] not null check (array_length(choices, 1) = 4 and array_position(choices, null) is null),
  answer smallint not null check (answer between 0 and 3),
  tag text check (tag is null or char_length(tag) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quiz_sets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 60),
  time_limit_sec int not null default 15 check (time_limit_sec between 5 and 120),
  prize text check (prize is null or char_length(prize) <= 80),
  coupon_url text check (coupon_url is null or (coupon_url ~ '^https://' and char_length(coupon_url) <= 500)),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.quiz_set_items (
  set_id uuid not null references public.quiz_sets(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete restrict,
  position int not null check (position >= 0),
  primary key (set_id, position),
  unique (set_id, question_id)
);

-- 1人1クイズ1回。position は次に出す問題の番号。
-- served_at / current_order は「いま出していて、まだ答えていない問題」の出題時刻と選択肢の並び
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.quiz_sets(id) on delete cascade,
  player_id uuid not null references public.quiz_players(id) on delete cascade,
  position int not null default 0,
  served_at timestamptz,
  current_order smallint[],
  correct int not null default 0,
  total_ms int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (set_id, player_id)
);

create table public.quiz_answers (
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  position int not null,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  choice smallint,           -- 元の添字。時間切れは null
  is_correct boolean not null,
  elapsed_ms int not null,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, position)
);

create table public.quiz_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  set_id uuid not null unique references public.quiz_sets(id) on delete cascade,
  player_id uuid not null references public.quiz_players(id) on delete cascade,
  prize text,
  coupon_url text,
  issued_at timestamptz not null default now(),
  used_at timestamptz
);

-- LINE ログインのチャネル ID（公開してよい値。ID トークンの宛先を確かめるのに使う）
insert into public.app_settings (key, value) values ('quiz_line_channel_id', '2011955776')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- 内部の関数

create or replace function public.quiz_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

create or replace function public.quiz_require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.quiz_is_admin() then raise exception 'not_admin'; end if;
end;
$$;

create or replace function public.quiz_hash(p_token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- セッションから遊ぶ人を引く。無い・切れていれば not_signed_in
create or replace function public.quiz_player_of(p_token text) returns public.quiz_players
language plpgsql stable security definer set search_path = public as $$
declare
  p public.quiz_players;
begin
  select pl.* into p
    from public.quiz_sessions s join public.quiz_players pl on pl.id = s.player_id
   where s.token_hash = public.quiz_hash(p_token) and s.expires_at > now();
  if not found then raise exception 'not_signed_in'; end if;
  return p;
end;
$$;

-- LINE の ID トークンを LINE のサーバーで確かめ、userId（sub）を返す。
-- 本番では http 拡張（supabase/quiz-prod.sql で有効にする）を使う。テストでは差し替える
create or replace function public.quiz_line_verify(p_id_token text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  channel text;
  res record;
  body jsonb;
begin
  select value into channel from public.app_settings where key = 'quiz_line_channel_id';
  if channel is null or coalesce(p_id_token, '') = '' or p_id_token !~ '^[A-Za-z0-9_.-]+$' then
    raise exception 'line_login_failed';
  end if;
  select status, content into res from extensions.http_post(
    'https://api.line.me/oauth2/v2.1/verify',
    'id_token=' || p_id_token || '&client_id=' || channel,
    'application/x-www-form-urlencoded'
  );
  if res.status <> 200 then raise exception 'line_login_failed'; end if;
  body := res.content::jsonb;
  if body->>'aud' is distinct from channel or coalesce(body->>'sub', '') = '' then
    raise exception 'line_login_failed';
  end if;
  return body->>'sub';
end;
$$;

create or replace function public.quiz_shuffled_order() returns smallint[]
language sql volatile as $$
  select array_agg(i::smallint order by random()) from generate_series(0, 3) as i;
$$;

-- 締め切り時のクーポンのコード。読み間違えやすい 0 O 1 I L を使わない
create or replace function public.quiz_new_coupon_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.quiz_coupons c where c.code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.quiz_question_at(p_set uuid, p_position int) returns public.quiz_questions
language sql stable security definer set search_path = public as $$
  select q.* from public.quiz_set_items i join public.quiz_questions q on q.id = i.question_id
   where i.set_id = p_set order by i.position offset p_position limit 1;
$$;

-- 答え（または時間切れ）を記録して次へ進める
create or replace function public.quiz_record(p_attempt public.quiz_attempts, p_choice smallint, p_elapsed_ms int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  q public.quiz_questions := public.quiz_question_at(p_attempt.set_id, p_attempt.position);
  total int;
  ok boolean := p_choice is not null and p_choice = q.answer;
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

-- ---------------------------------------------------------------- 遊ぶ人の関数（p_token はクイズのセッション）

-- LINE でログインして、クイズのセッションを返す。初めての人は名前がまだ無い
create or replace function public.quiz_line_login(p_id_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  sub text := public.quiz_line_verify(p_id_token);
  p public.quiz_players;
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.quiz_players (line_sub) values (sub)
  on conflict (line_sub) do update set line_sub = excluded.line_sub
  returning * into p;
  delete from public.quiz_sessions where player_id = p.id and expires_at <= now();
  insert into public.quiz_sessions (token_hash, player_id) values (public.quiz_hash(token), p.id);
  return jsonb_build_object('token', token, 'nickname', p.nickname);
end;
$$;

create or replace function public.quiz_me(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
begin
  return jsonb_build_object('nickname', p.nickname);
end;
$$;

-- ランキングに出る名前の登録・変更。ほかの人と同じ名前は使えない（大文字小文字は同じとみなす）
create or replace function public.quiz_register(p_token text, p_nickname text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
  nick text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
begin
  if char_length(nick) < 1 or char_length(nick) > 12 then raise exception 'bad_nickname'; end if;
  if exists (select 1 from public.quiz_players where lower(nickname) = lower(nick) and id <> p.id) then
    raise exception 'nickname_taken';
  end if;
  update public.quiz_players set nickname = nick where id = p.id;
  return jsonb_build_object('nickname', nick);
end;
$$;

-- 公開中と締め切ったクイズの一覧（セッションがあれば自分の成績つき）
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
        'status', z.status, 'opened_at', z.opened_at, 'closed_at', z.closed_at,
        'total', (select count(*) from public.quiz_set_items i where i.set_id = z.id),
        'players', (select count(*) from public.quiz_attempts a2 where a2.set_id = z.id and a2.finished_at is not null),
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
  if z.status <> 'open' then raise exception 'quiz_closed'; end if;
  select count(*) into total from public.quiz_set_items where set_id = p_set;
  if total = 0 then raise exception 'quiz_empty'; end if;
  if a.id is null then
    insert into public.quiz_attempts (set_id, player_id) values (p_set, p.id) returning * into a;
  end if;
  return jsonb_build_object('attempt_id', a.id, 'total', total, 'position', a.position,
    'time_limit_sec', z.time_limit_sec, 'title', z.title);
end;
$$;

-- 次の問題を出す。出したまま答えていない問題があれば、同じ問題を残り時間つきで返す
-- （読み込み直しで時間を巻き戻せない）。時間が過ぎていれば時間切れにして次へ進む
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
  if z.status <> 'open' and a.served_at is null then raise exception 'quiz_closed'; end if;

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

-- 答える。p_choice は画面の並びの番号（0〜3）、時間切れは null
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
begin
  select * into a from public.quiz_attempts where id = p_attempt and player_id = p.id for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.finished_at is not null then raise exception 'already_played'; end if;
  if a.served_at is null then raise exception 'no_question'; end if;
  if p_choice is not null and (p_choice < 0 or p_choice > 3) then raise exception 'bad_choice'; end if;

  select * into z from public.quiz_sets where id = a.set_id;
  limit_ms := z.time_limit_sec * 1000;
  elapsed := floor(extract(epoch from (now() - a.served_at)) * 1000)::int;
  -- 通信の遅れのぶん 1.5 秒までは待つ。それより遅い答えは時間切れ
  timed_out := p_choice is null or elapsed > limit_ms + 1500;
  elapsed := case when timed_out then limit_ms else least(elapsed, limit_ms) end;
  q := public.quiz_question_at(a.set_id, a.position);

  ok := public.quiz_record(a, case when timed_out then null else a.current_order[p_choice + 1] end, elapsed);
  select count(*) into total from public.quiz_set_items where set_id = a.set_id;
  return jsonb_build_object(
    'correct', ok, 'timed_out', timed_out,
    'answer', array_position(a.current_order, q.answer::smallint) - 1,
    'elapsed_ms', elapsed, 'done', a.position + 1 >= total
  );
end;
$$;

-- ランキング。正解数が多い順、同じなら合計時間が短い順、それも同じなら先に終えた順
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
    order by 1
    limit 100;
end;
$$;

-- 自分のクーポン。公式LINE のクーポンの URL は1位の人にだけ見える
create or replace function public.quiz_my_coupons(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.quiz_players := public.quiz_player_of(p_token);
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', c.code, 'prize', c.prize, 'coupon_url', c.coupon_url, 'quiz_title', z.title,
      'issued_at', c.issued_at, 'used_at', c.used_at
    ) order by c.issued_at desc), '[]'::jsonb)
    from public.quiz_coupons c join public.quiz_sets z on z.id = c.set_id
    where c.player_id = p.id
  );
end;
$$;

-- ---------------------------------------------------------------- スタッフの関数

create or replace function public.quiz_open(p_set uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.quiz_require_admin();
  if not exists (select 1 from public.quiz_set_items where set_id = p_set) then raise exception 'quiz_empty'; end if;
  update public.quiz_sets set status = 'open', opened_at = coalesce(opened_at, now())
   where id = p_set and status = 'draft';
  if not found then raise exception 'quiz_not_draft'; end if;
end;
$$;

-- 締め切って、1位にクーポンを出す。途中の挑戦は数えない
create or replace function public.quiz_close(p_set uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  z public.quiz_sets;
  winner record;
  c public.quiz_coupons;
begin
  perform public.quiz_require_admin();
  select * into z from public.quiz_sets where id = p_set for update;
  if not found then raise exception 'quiz_not_found'; end if;
  if z.status <> 'open' then raise exception 'quiz_not_open'; end if;
  update public.quiz_sets set status = 'closed', closed_at = now() where id = p_set;

  -- 並べ方は quiz_ranking と同じ
  select pl.nickname, a.player_id into winner
    from public.quiz_attempts a join public.quiz_players pl on pl.id = a.player_id
   where a.set_id = p_set and a.finished_at is not null
   order by a.correct desc, a.total_ms asc, a.finished_at asc
   limit 1;
  if not found then return jsonb_build_object('winner', null); end if;

  insert into public.quiz_coupons (code, set_id, player_id, prize, coupon_url)
  values (public.quiz_new_coupon_code(), p_set, winner.player_id, z.prize, z.coupon_url)
  returning * into c;
  return jsonb_build_object('winner', winner.nickname, 'code', c.code, 'prize', c.prize);
end;
$$;

-- 購買で使ったときに、スタッフがコードを入れて使用済みにする
create or replace function public.quiz_use_coupon(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.quiz_coupons;
  nick text;
begin
  perform public.quiz_require_admin();
  select * into c from public.quiz_coupons where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'coupon_not_found'; end if;
  if c.used_at is not null then raise exception 'coupon_used'; end if;
  update public.quiz_coupons set used_at = now() where id = c.id returning * into c;
  select nickname into nick from public.quiz_players where id = c.player_id;
  return jsonb_build_object('code', c.code, 'prize', c.prize, 'nickname', nick, 'used_at', c.used_at);
end;
$$;

-- クイズの問題を、渡した順に入れ替える（下書きのときだけ）
create or replace function public.quiz_set_questions(p_set uuid, p_questions uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.quiz_require_admin();
  if not exists (select 1 from public.quiz_sets where id = p_set and status = 'draft') then
    raise exception 'quiz_not_draft';
  end if;
  delete from public.quiz_set_items where set_id = p_set;
  insert into public.quiz_set_items (set_id, question_id, position)
  select p_set, qid, (n - 1)::int from unnest(p_questions) with ordinality as t(qid, n);
end;
$$;

create or replace function public.quiz_admin_coupons() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.quiz_require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', c.code, 'prize', c.prize, 'quiz_title', z.title, 'nickname', pl.nickname,
      'issued_at', c.issued_at, 'used_at', c.used_at
    ) order by c.issued_at desc), '[]'::jsonb)
    from public.quiz_coupons c
    join public.quiz_sets z on z.id = c.set_id
    left join public.quiz_players pl on pl.id = c.player_id
  );
end;
$$;

-- ---------------------------------------------------------------- RLS

alter table public.quiz_players enable row level security;
alter table public.quiz_sessions enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_sets enable row level security;
alter table public.quiz_set_items enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.quiz_coupons enable row level security;

create policy quiz_questions_staff on public.quiz_questions for all
  using (public.quiz_is_admin()) with check (public.quiz_is_admin());
create policy quiz_sets_staff_select on public.quiz_sets for select using (public.quiz_is_admin());
create policy quiz_sets_staff_insert on public.quiz_sets for insert with check (public.quiz_is_admin());
create policy quiz_sets_staff_update on public.quiz_sets for update
  using (public.quiz_is_admin()) with check (public.quiz_is_admin());
-- 消せるのは下書きだけ（公開したら挑戦とクーポンが消えてしまう）
create policy quiz_sets_staff_delete on public.quiz_sets for delete
  using (public.quiz_is_admin() and status = 'draft');
create policy quiz_set_items_staff on public.quiz_set_items for select using (public.quiz_is_admin());

-- ---------------------------------------------------------------- 権限（0003 と同じ形: 取り消してから要るものだけ）

revoke all on public.quiz_players, public.quiz_sessions, public.quiz_questions, public.quiz_sets,
  public.quiz_set_items, public.quiz_attempts, public.quiz_answers, public.quiz_coupons
  from public, anon, authenticated;
revoke execute on function
  public.quiz_is_admin(), public.quiz_require_admin(), public.quiz_hash(text), public.quiz_player_of(text),
  public.quiz_line_verify(text), public.quiz_shuffled_order(), public.quiz_new_coupon_code(),
  public.quiz_question_at(uuid, int), public.quiz_record(public.quiz_attempts, smallint, int),
  public.quiz_line_login(text), public.quiz_me(text), public.quiz_register(text, text), public.quiz_list(text),
  public.quiz_start(text, uuid), public.quiz_next(text, uuid), public.quiz_answer(text, uuid, int),
  public.quiz_ranking(uuid, text), public.quiz_my_coupons(text),
  public.quiz_open(uuid), public.quiz_close(uuid), public.quiz_use_coupon(text),
  public.quiz_set_questions(uuid, uuid[]), public.quiz_admin_coupons()
  from public, anon, authenticated;

grant select, insert, update, delete on public.quiz_questions to authenticated;
grant select, delete on public.quiz_sets to authenticated;
grant insert (title, time_limit_sec, prize, coupon_url), update (title, time_limit_sec, prize, coupon_url)
  on public.quiz_sets to authenticated;
grant select on public.quiz_set_items to authenticated;

grant execute on function
  public.quiz_line_login(text), public.quiz_me(text), public.quiz_register(text, text), public.quiz_list(text),
  public.quiz_start(text, uuid), public.quiz_next(text, uuid), public.quiz_answer(text, uuid, int),
  public.quiz_ranking(uuid, text), public.quiz_my_coupons(text)
  to anon, authenticated;
grant execute on function
  public.quiz_is_admin(), public.quiz_open(uuid), public.quiz_close(uuid), public.quiz_use_coupon(text),
  public.quiz_set_questions(uuid, uuid[]), public.quiz_admin_coupons()
  to authenticated;
