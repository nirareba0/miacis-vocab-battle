-- 0005: 合言葉を「設定したときだけ要る」形にする（2026-09-25 本人判断「一旦なしでいい。山梨近隣に広まってもいい」）
-- app_settings.invite_code が空なら誰でも登録できる。あとで絞りたくなったら tools/sql/set-invite-code.sql で入れるだけで戻る。

create or replace function public.invite_required()
returns boolean as $$
  select coalesce((select trim(value) <> '' from public.app_settings where key = 'invite_code'), false);
$$ language sql stable security definer set search_path = public;

create or replace function public.check_invite(p_code text)
returns boolean as $$
declare
  v_stored_code text;
begin
  select value into v_stored_code from public.app_settings where key = 'invite_code';
  if not found or v_stored_code is null or trim(v_stored_code) = '' then
    return true;   -- 合言葉なし
  end if;
  if p_code is null or trim(p_code) = '' then
    return false;
  end if;
  return lower(trim(p_code)) = lower(trim(v_stored_code));
end;
$$ language plpgsql security definer set search_path = public;

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

  -- 合言葉が設定されているときだけ検査する（未設定なら誰でも登録できる）
  if found and v_stored_code is not null and trim(v_stored_code) <> '' then
    if p_invite_code is null or lower(trim(p_invite_code)) <> lower(trim(v_stored_code)) then
      raise exception 'invite_invalid';
    end if;
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

-- 権限（0003 の既定で新しい関数は誰にも許されていない。create or replace した既存の関数は権限を保つ）
revoke execute on function public.invite_required() from public, anon, authenticated;
grant execute on function public.invite_required() to anon, authenticated;
