-- 0004_game.sql: ゲーム性・進化・カードパック・合言葉
-- miacis-vocab-battle

-- 1. 合言葉 (app_settings)
create table if not exists public.app_settings (
  key text primary key,
  value text
);
-- 端末からは一切読めない（GRANT も無い）が、RLS も掛けて二重に閉じる
alter table public.app_settings enable row level security;

create or replace function public.check_invite(p_code text)
returns boolean as $$
declare
  v_stored_code text;
begin
  if p_code is null or trim(p_code) = '' then
    return false;
  end if;

  select value into v_stored_code
  from public.app_settings
  where key = 'invite_code';

  if not found or v_stored_code is null or trim(v_stored_code) = '' then
    return false;
  end if;

  return lower(trim(p_code)) = lower(trim(v_stored_code));
end;
$$ language plpgsql security definer set search_path = public;

-- 旧 register_player(text, int) を削除
drop function if exists public.register_player(text, int);

-- 新 register_player(text, int, text)
create or replace function public.register_player(p_nickname text, p_grade int, p_invite_code text)
returns public.players as $$
declare
  v_uid uuid;
  v_clean_nick text;
  v_player public.players;
  v_stored_code text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- 既に登録済みの場合はそのまま返す
  select * into v_player from public.players where id = v_uid;
  if found then
    return v_player;
  end if;

  -- 合言葉の検査
  select value into v_stored_code
  from public.app_settings
  where key = 'invite_code';

  if not found or v_stored_code is null or trim(v_stored_code) = '' then
    raise exception 'invite_not_set';
  end if;

  if p_invite_code is null or lower(trim(p_invite_code)) <> lower(trim(v_stored_code)) then
    raise exception 'invite_invalid';
  end if;

  -- ニックネームのバリデーション: 1〜10文字、trim、制御文字不可
  v_clean_nick := trim(p_nickname);
  if length(v_clean_nick) < 1 or length(v_clean_nick) > 10 then
    raise exception 'invalid_nickname_length';
  end if;
  if v_clean_nick ~ '[\x00-\x1F\x7F]' then
    raise exception 'invalid_nickname_control_chars';
  end if;

  -- 学年のバリデーション: 1〜6
  if p_grade < 1 or p_grade > 6 then
    raise exception 'invalid_grade';
  end if;

  -- ニックネーム重複チェック
  if exists (select 1 from public.players where nickname = v_clean_nick) then
    raise exception 'nickname_taken';
  end if;

  insert into public.players (id, nickname, grade, tier, is_picker, created_at, last_active_at)
  values (v_uid, v_clean_nick, p_grade, 1, false, public.jst_now(), public.jst_now())
  returning * into v_player;

  return v_player;
end;
$$ language plpgsql security definer set search_path = public;


-- 2. 進化 (players.route, my_progress)
alter table public.players add column if not exists route text check (route in ('grass', 'tree'));

create or replace function public.my_progress()
returns jsonb as $$
declare
  v_uid uuid;
  v_player public.players;
  v_total_learn int := 0;
  v_total_commit int := 0;
  v_total_points int := 0;
  v_stage int := 1;
  v_stage_name text := '';
  v_route text;
  v_next_threshold int := 30;
  v_points_to_next int := 30;
  v_today date;
  v_check_date date;
  v_has_open boolean;
  v_streak int := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_player from public.players where id = v_uid;
  if not found then
    raise exception 'player_not_found';
  end if;

  -- 全期間のポイント集計
  select coalesce(sum(amount), 0)::int into v_total_learn
  from public.points
  where player_id = v_uid and kind = 'learn';

  select coalesce(sum(amount), 0)::int into v_total_commit
  from public.points
  where player_id = v_uid and kind = 'commit';

  v_total_points := v_total_learn + v_total_commit;
  v_route := v_player.route;

  -- 累計80点でルート確定（未確定の場合のみ。以後変えない）
  if v_route is null and v_total_points >= 80 then
    if v_total_learn >= v_total_commit then
      v_route := 'grass';
    else
      v_route := 'tree';
    end if;
    update public.players set route = v_route where id = v_uid;
  end if;

  -- 段階判定: 1:0, 2:30, 3:80, 4:160, 5:300, 6:500, 7:800
  if v_total_points >= 800 then
    v_stage := 7;
    v_next_threshold := null;
    v_points_to_next := 0;
  elsif v_total_points >= 500 then
    v_stage := 6;
    v_next_threshold := 800;
    v_points_to_next := 800 - v_total_points;
  elsif v_total_points >= 300 then
    v_stage := 5;
    v_next_threshold := 500;
    v_points_to_next := 500 - v_total_points;
  elsif v_total_points >= 160 then
    v_stage := 4;
    v_next_threshold := 300;
    v_points_to_next := 300 - v_total_points;
  elsif v_total_points >= 80 then
    v_stage := 3;
    v_next_threshold := 160;
    v_points_to_next := 160 - v_total_points;
  elsif v_total_points >= 30 then
    v_stage := 2;
    v_next_threshold := 80;
    v_points_to_next := 80 - v_total_points;
  else
    v_stage := 1;
    v_next_threshold := 30;
    v_points_to_next := 30 - v_total_points;
  end if;

  -- 段階名
  if v_stage = 1 then
    v_stage_name := 'ちびミアキス';
  elsif v_stage = 2 then
    v_stage_name := 'ミアキス';
  elsif v_stage = 3 then
    if v_route = 'grass' then
      v_stage_name := '草原をめざすミアキス';
    else
      v_stage_name := '木の上のミアキス';
    end if;
  elsif v_stage = 4 then
    if v_route = 'grass' then
      v_stage_name := 'ハイイロギツネ級';
    else
      v_stage_name := 'ヤマネコ級';
    end if;
  elsif v_stage = 5 then
    if v_route = 'grass' then
      v_stage_name := 'オオカミ級';
    else
      v_stage_name := 'ヒョウ級';
    end if;
  elsif v_stage = 6 then
    if v_route = 'grass' then
      v_stage_name := 'ダイアウルフ級';
    else
      v_stage_name := 'トラ級';
    end if;
  elsif v_stage = 7 then
    if v_route = 'grass' then
      v_stage_name := '草原の王';
    else
      v_stage_name := '森の王';
    end if;
  end if;

  -- 連続日数（今日または昨日まで途切れずに reason='open' のコミットがある日数）
  v_today := public.jst_today();
  select exists (
    select 1 from public.points
    where player_id = v_uid and kind = 'commit' and reason = 'open' and day = v_today
  ) into v_has_open;

  if v_has_open then
    v_check_date := v_today;
  else
    select exists (
      select 1 from public.points
      where player_id = v_uid and kind = 'commit' and reason = 'open' and day = (v_today - 1)
    ) into v_has_open;
    if v_has_open then
      v_check_date := v_today - 1;
    else
      v_check_date := null;
    end if;
  end if;

  if v_check_date is not null then
    loop
      select exists (
        select 1 from public.points
        where player_id = v_uid and kind = 'commit' and reason = 'open' and day = v_check_date
      ) into v_has_open;

      exit when not v_has_open;
      v_streak := v_streak + 1;
      v_check_date := v_check_date - 1;
    end loop;
  end if;

  return jsonb_build_object(
    'total_learn', v_total_learn,
    'total_commit', v_total_commit,
    'total_points', v_total_points,
    'stage', v_stage,
    'stage_name', v_stage_name,
    'route', v_route,
    'next_threshold', v_next_threshold,
    'points_to_next', v_points_to_next,
    'streak_days', v_streak
  );
end;
$$ language plpgsql security definer set search_path = public;


-- 3. カードパック (card_draws, card_collection, open_pack, pack_status, my_collection)
create table if not exists public.card_draws (
  id bigserial primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  match_id uuid not null unique references public.matches(id) on delete cascade,
  word_id int not null references public.words(id) on delete cascade,
  rarity smallint not null check (rarity between 1 and 4),
  day date not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_card_draws_player_day on public.card_draws(player_id, day);

create table if not exists public.card_collection (
  player_id uuid not null references public.players(id) on delete cascade,
  word_id int not null references public.words(id) on delete cascade,
  rarity smallint not null check (rarity between 1 and 4),
  count int not null default 1 check (count >= 1),
  first_at timestamptz not null default now(),
  primary key (player_id, word_id)
);

alter table public.card_draws enable row level security;
alter table public.card_collection enable row level security;

create policy "card_draws_select_own" on public.card_draws
  for select using (player_id = auth.uid());

create policy "card_collection_select_own" on public.card_collection
  for select using (player_id = auth.uid());

create or replace function public.open_pack(p_match_id uuid)
returns jsonb as $$
declare
  v_uid uuid;
  v_match public.matches;
  v_today date;
  v_draw_count int;
  v_rarity smallint;
  v_rnd double precision;
  v_target_band smallint;
  v_word public.words;
  v_existing_count int;
  v_existing_rarity smallint;
  v_is_new boolean;
  v_count int;
  v_remaining int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;

  if v_match.player_id <> v_uid then
    raise exception 'permission_denied';
  end if;

  if v_match.finished_at is null then
    raise exception 'match_not_finished';
  end if;

  if exists (select 1 from public.card_draws where match_id = p_match_id) then
    raise exception 'already_drawn';
  end if;

  v_today := public.jst_today();
  select count(*)::int into v_draw_count
  from public.card_draws
  where player_id = v_uid and day = v_today;

  if v_draw_count >= 3 then
    raise exception 'pack_limit';
  end if;

  -- レア度判定
  if v_match.correct = 10 then
    -- 全問正解: SR 88% / UR 12%
    if random() < 0.88 then
      v_rarity := 3;
    else
      v_rarity := 4;
    end if;
  else
    -- 通常: N 70% / R 22% / SR 7% / UR 1%
    v_rnd := random();
    if v_rnd < 0.70 then
      v_rarity := 1;
    elsif v_rnd < 0.92 then
      v_rarity := 2;
    elsif v_rnd < 0.99 then
      v_rarity := 3;
    else
      v_rarity := 4;
    end if;
  end if;

  -- 対象段（バンド）: N/R は match.band、SR は band+1、UR は band+2（最大 5）
  if v_rarity in (1, 2) then
    v_target_band := v_match.band;
  elsif v_rarity = 3 then
    v_target_band := least(5, v_match.band + 1);
  else
    v_target_band := least(5, v_match.band + 2);
  end if;

  -- 対象段からランダムに1語選出
  select * into v_word
  from public.words
  where band = v_target_band
  order by random()
  limit 1;

  if not found then
    select * into v_word from public.words order by random() limit 1;
  end if;

  -- ドロー履歴を記録
  insert into public.card_draws (player_id, match_id, word_id, rarity, day, created_at)
  values (v_uid, p_match_id, v_word.id, v_rarity, v_today, public.jst_now());

  -- コレクションに追加・更新
  select count, rarity into v_existing_count, v_existing_rarity
  from public.card_collection
  where player_id = v_uid and word_id = v_word.id;

  if not found then
    v_is_new := true;
    v_count := 1;
    insert into public.card_collection (player_id, word_id, rarity, count, first_at)
    values (v_uid, v_word.id, v_rarity, 1, public.jst_now());
  else
    v_is_new := false;
    v_count := v_existing_count + 1;
    update public.card_collection
    set count = v_count,
        rarity = greatest(v_existing_rarity, v_rarity)
    where player_id = v_uid and word_id = v_word.id;
  end if;

  v_remaining := 3 - (v_draw_count + 1);

  return jsonb_build_object(
    'en', v_word.en,
    'ja', v_word.ja,
    'band', v_word.band,
    'rarity', v_rarity,
    'is_new', v_is_new,
    'count', v_count,
    'remaining_draws', v_remaining,
    'remaining', v_remaining
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.pack_status()
returns jsonb as $$
declare
  v_uid uuid;
  v_draw_count int;
  v_remaining int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select count(*)::int into v_draw_count
  from public.card_draws
  where player_id = v_uid and day = public.jst_today();

  v_remaining := greatest(0, 3 - v_draw_count);

  return jsonb_build_object(
    'remaining_draws', v_remaining,
    'remaining', v_remaining,
    'limit', 3
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.my_collection()
returns jsonb as $$
declare
  v_uid uuid;
  v_cards jsonb;
  v_bands jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'word_id', c.word_id,
      'en', w.en,
      'ja', w.ja,
      'band', w.band,
      'rarity', c.rarity,
      'count', c.count
    ) order by w.band asc, c.rarity desc, w.rank asc
  ), '[]'::jsonb)
  into v_cards
  from public.card_collection c
  join public.words w on w.id = c.word_id
  where c.player_id = v_uid;

  with band_totals as (
    select b.band, coalesce(count(w.id), 0)::int as total
    from generate_series(1, 5) as b(band)
    left join public.words w on w.band = b.band
    group by b.band
  ),
  band_collected as (
    select b.band, coalesce(count(c.word_id), 0)::int as collected
    from generate_series(1, 5) as b(band)
    left join (
      public.card_collection c
      join public.words w on w.id = c.word_id and c.player_id = v_uid
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
    'cards', v_cards,
    'bands', v_bands
  );
end;
$$ language plpgsql security definer set search_path = public;


-- 4. 権限 (REVOKE & GRANT)
revoke all on public.app_settings from anon, authenticated;
revoke all on public.card_draws from anon, authenticated;
revoke all on public.card_collection from anon, authenticated;
revoke all on sequence public.card_draws_id_seq from anon, authenticated;

revoke execute on function public.check_invite(text) from public, anon, authenticated;
revoke execute on function public.register_player(text, int, text) from public, anon, authenticated;
revoke execute on function public.my_progress() from public, anon, authenticated;
revoke execute on function public.open_pack(uuid) from public, anon, authenticated;
revoke execute on function public.pack_status() from public, anon, authenticated;
revoke execute on function public.my_collection() from public, anon, authenticated;

grant select on public.card_draws, public.card_collection to authenticated;

grant execute on function public.check_invite(text) to anon, authenticated;
grant execute on function
  public.register_player(text, int, text),
  public.my_progress(),
  public.open_pack(uuid),
  public.pack_status(),
  public.my_collection()
  to authenticated;
