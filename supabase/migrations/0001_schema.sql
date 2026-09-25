-- 0001_schema.sql: Initial schema, tables, RLS, and views
-- miacis-vocab-battle

-- 1. Tables (all in public)

-- players: Nickname, grade (1=中1..6=高3), tier (1..5), is_picker
create table public.players (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text unique not null check (
    length(nickname) between 1 and 10
    and nickname = trim(nickname)
    and nickname !~ '[\x00-\x1F\x7F]'
  ),
  grade smallint not null check (grade between 1 and 6),
  tier smallint not null default 1 check (tier between 1 and 5),
  is_picker boolean not null default false,
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

-- staff: staff accounts
create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- words: NGSL vocabulary divided into 5 bands
create table public.words (
  id serial primary key,
  rank int unique not null,
  en text not null,
  ja text not null,
  pos text,
  band smallint not null check (band between 1 and 5)
);

-- matches: Vocabulary battle match records
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  band smallint not null check (band between 1 and 5),
  questions jsonb not null,
  answers jsonb,
  correct smallint,
  total_ms int,
  opponent jsonb,
  result text check (result is null or result in ('win', 'lose')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  week_start date not null
);

-- points: Points ledger (learn & commit)
create table public.points (
  id bigserial primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('learn', 'commit')),
  reason text not null,
  amount int not null check (amount > 0),
  week_start date not null,
  day date not null,
  created_at timestamptz not null default now()
);

-- contents: Weekly English content ("今週の英語")
create table public.contents (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  title text not null,
  url text not null check (url ~ '^https://'),
  quiz jsonb not null,
  writing_prompt jsonb not null,
  picked_by uuid references public.players(id) on delete set null,
  approved_by uuid references public.staff(user_id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- content_opens: Record content opened (once per player per content)
create table public.content_opens (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  content_id uuid not null references public.contents(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (player_id, content_id)
);

-- content_quiz_answers: Record content quiz answers (once per player per content)
create table public.content_quiz_answers (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  content_id uuid not null references public.contents(id) on delete cascade,
  answers jsonb not null,
  correct_count smallint not null,
  created_at timestamptz not null default now(),
  unique (player_id, content_id)
);

-- writings: Student responses to writing prompt
create table public.writings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  content_id uuid not null references public.contents(id) on delete cascade,
  text text not null,
  stamp text null check (stamp is null or stamp in ('👍','✨','😂','🔥','👀')),
  created_at timestamptz not null default now()
);

-- weekly_results: Finalized results for each week
create table public.weekly_results (
  id bigserial primary key,
  week_start date not null,
  player_id uuid not null references public.players(id) on delete cascade,
  tier_before smallint not null check (tier_before between 1 and 5),
  tier_after smallint not null check (tier_after between 1 and 5),
  learn_points int not null default 0,
  commit_points int not null default 0,
  learn_rank_in_tier int,
  commit_rank int,
  active boolean not null default false,
  unique (week_start, player_id)
);

-- 2. Indexes for performance
create index idx_matches_player_finished on public.matches(player_id, finished_at desc);
create index idx_matches_band_finished on public.matches(band, finished_at, started_at);
create index idx_points_player_week on public.points(player_id, week_start, kind);
create index idx_points_player_day on public.points(player_id, day, kind);
create index idx_contents_week_approved on public.contents(week_start, approved_at);
create index idx_writings_player on public.writings(player_id, created_at desc);
create index idx_words_band on public.words(band, rank);

-- 3. Row Level Security (RLS)
alter table public.players enable row level security;
alter table public.staff enable row level security;
alter table public.words enable row level security;
alter table public.matches enable row level security;
alter table public.points enable row level security;
alter table public.contents enable row level security;
alter table public.content_opens enable row level security;
alter table public.content_quiz_answers enable row level security;
alter table public.writings enable row level security;
alter table public.weekly_results enable row level security;

-- words: anyone can select
create policy "words_select_all" on public.words
  for select using (true);

-- contents: approved content is public; staff can see all
create policy "contents_select_approved_or_staff" on public.contents
  for select using (
    approved_at is not null
    or exists (select 1 from public.staff where user_id = auth.uid())
  );

-- players: user can select self; staff can select all
create policy "players_select_own_or_staff" on public.players
  for select using (
    id = auth.uid()
    or exists (select 1 from public.staff where user_id = auth.uid())
  );

-- staff: staff can select staff table
create policy "staff_select_staff" on public.staff
  for select using (
    user_id = auth.uid()
  );

-- matches: user can select own matches
create policy "matches_select_own" on public.matches
  for select using (
    player_id = auth.uid()
  );

-- points: user can select own points
create policy "points_select_own" on public.points
  for select using (
    player_id = auth.uid()
  );

-- writings: user can select own; staff can select all
create policy "writings_select_own_or_staff" on public.writings
  for select using (
    player_id = auth.uid()
    or exists (select 1 from public.staff where user_id = auth.uid())
  );

-- weekly_results: user can select own results
create policy "weekly_results_select_own" on public.weekly_results
  for select using (
    player_id = auth.uid()
  );

-- content_opens: user can select own opens
create policy "content_opens_select_own" on public.content_opens
  for select using (
    player_id = auth.uid()
  );

-- content_quiz_answers: user can select own quiz answers
create policy "content_quiz_answers_select_own" on public.content_quiz_answers
  for select using (
    player_id = auth.uid()
  );

-- 4. Permissions (GRANT)
-- DO NOT grant INSERT/UPDATE/DELETE on tables to anon or authenticated.
-- All table modifications must go through security definer functions.

grant select on public.words to anon, authenticated;
grant select on public.contents to anon, authenticated;
grant select on public.players to authenticated;
grant select on public.staff to authenticated;
grant select on public.points to authenticated;
grant select on public.writings to authenticated;
grant select on public.weekly_results to authenticated;
grant select on public.content_opens to authenticated;
grant select on public.content_quiz_answers to authenticated;

-- For matches: grant select on all columns EXCEPT questions to authenticated.
-- Prevents clients from inspecting answer_index before submitting answers.
grant select (
  id, player_id, band, answers, correct, total_ms, opponent, result, started_at, finished_at, week_start
) on public.matches to authenticated;
