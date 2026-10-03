-- 0024_streak_weekly.sql（2026-10-03 本人「いいよ」: 連続日数を週単位の考え方にし、休館日は数えない）
-- 仕様: AIOS core/projects/miacis/specs/streak-weekly-20261003.md（根拠は motivation-research-20261003.md [30][3][2]）
--
-- 🔥 の数え方（前: 「今日か昨日まで、1日も空けずに開いた日数」→ 後: 「週でつながっている間に来た日数」）
--   - 来た日 = アプリを開いた日（open のコミット）か、学習ポイントが付いた日。前の数え方（open だけ）を含む
--   - 週は月曜はじまり。来た日が1日でもある週は「つながる」
--   - 来なかった週があっても、続けて streak_grace_weeks 週（既定1）までなら切れない（ストリークの保険）
--   - 開館日が streak_week_min_open 日（既定3）未満の週（年末年始など）は、来なくても数えない
--   - 今週はまだ途中なので、今週来ていなくても切れない
--   - 🔥 の数 = つながっている週の最初の月曜から今日までに来た日数
--   この決め方なら、切り替えた時点の 🔥 は前の数え方より小さくならない（tests/db/streak-weekly.test.mjs で検査）
-- 休館日: 毎週の曜日（closed_weekdays）・毎月 第◯ ◯曜（closed_nth_week / closed_nth_weekday）・日付の登録（calendar_days）
--   既定は館の公式「毎週火曜・毎月第3月曜」（https://kawarabe.com/miacis/）。年末年始は【仮】で登録（スタッフ画面で直せる）
-- 連続のボーナス（3日で +1・7日以上で +3）は数字をそのまま app_settings に出し、🔥 の新しい数に掛ける
begin;

insert into public.app_settings (key, value) values
  ('closed_weekdays', '2'),           -- 毎週の休館日（1=月 … 7=日。カンマ区切り）。館の公式: 火曜
  ('closed_nth_week', '3'),           -- 毎月 第◯週の休館（0 で なし）。館の公式: 第3月曜
  ('closed_nth_weekday', '1'),        -- その曜日（1=月 … 7=日）
  ('streak_week_min_open', '3'),      -- 開館日がこれ未満の週は 🔥 に数えない（来なくても切れない）
  ('streak_grace_weeks', '1'),        -- 続けて何週 来なくても 🔥 が切れないか
  ('streak_bonus_small_days', '3'),   -- 🔥 この日数で ログインボーナスに上乗せ（小）
  ('streak_bonus_small', '1'),
  ('streak_bonus_big_days', '7'),     -- 🔥 この日数以上で 上乗せ（大）
  ('streak_bonus_big', '3')
on conflict (key) do nothing;

-- 1. 日付ごとの休館・臨時開館（スタッフが登録する。曜日の決まりより優先）
create table if not exists public.calendar_days (
  day date primary key,
  closed boolean not null,            -- true = 休館（祝日・年末年始・臨時休館） / false = 臨時開館（決まった休館日に開ける）
  note text not null default '' check (char_length(note) <= 40),
  updated_at timestamptz not null default now()
);
alter table public.calendar_days enable row level security;

-- 年末年始【仮】: 2024年度の館の案内（12/28〜1/3）に合わせた。今年の日付が出たらスタッフ画面で直す
insert into public.calendar_days (day, closed, note)
select d::date, true, '年末年始【仮】'
from generate_series('2026-12-28'::date, '2027-01-03'::date, interval '1 day') d
on conflict (day) do nothing;

create or replace function public.is_closed_day(p_day date)
returns boolean as $$
declare
  v_override boolean;
  v_dow int;
  v_list text;
  v_nth int;
begin
  select closed into v_override from public.calendar_days where day = p_day;
  if found then
    return v_override;
  end if;
  v_dow := extract(isodow from p_day)::int;
  v_list := coalesce((select value from public.app_settings where key = 'closed_weekdays'), '');
  if v_dow::text = any(string_to_array(replace(v_list, ' ', ''), ',')) then
    return true;
  end if;
  v_nth := public.setting_num('closed_nth_week', 0)::int;
  if v_nth between 1 and 5
     and v_dow = public.setting_num('closed_nth_weekday', 1)::int
     and ((extract(day from p_day)::int - 1) / 7 + 1) = v_nth then
    return true;
  end if;
  return false;
end;
$$ language plpgsql stable security definer set search_path = public;

-- 2. 🔥 の状態（内部用。p_uid のぶん）
create or replace function public.streak_state(p_uid uuid)
returns jsonb as $$
declare
  v_today date := public.jst_today();
  v_monday date;
  v_days date[];
  v_first_monday date;
  v_w date;
  v_start date;
  v_misses int := 0;
  v_grace int := greatest(0, public.setting_num('streak_grace_weeks', 1)::int);
  v_min_open int := greatest(0, public.setting_num('streak_week_min_open', 3)::int);
  v_open int;
  v_played int;
  v_weeks int := 0;
  v_count int;
  v_rested boolean := false;   -- 先週は来ていないが、保険で 🔥 がつながっている
  v_week jsonb := '[]'::jsonb;
  v_week_days int := 0;
  v_week_open int := 0;
  v_closed boolean;
  d date;
begin
  v_monday := v_today - (extract(isodow from v_today)::int - 1);
  select coalesce(array_agg(x.day order by x.day), '{}'::date[]) into v_days
  from (
    select distinct day from public.points
    where player_id = p_uid and day <= v_today
      and ((kind = 'commit' and reason = 'open') or kind = 'learn')
  ) x;

  v_start := v_monday;
  if exists (select 1 from unnest(v_days) x where x >= v_monday) then
    v_weeks := 1;
  end if;

  if array_length(v_days, 1) is not null then
    v_first_monday := v_days[1] - (extract(isodow from v_days[1])::int - 1);
    v_w := v_monday - 7;
    while v_w >= v_first_monday loop
      select count(*) into v_played from unnest(v_days) x where x >= v_w and x < v_w + 7;
      if v_played > 0 then
        v_start := v_w;
        v_misses := 0;
        v_weeks := v_weeks + 1;
      else
        select count(*) into v_open
        from generate_series(v_w, v_w + 6, interval '1 day') g
        where not public.is_closed_day(g::date);
        if v_open >= v_min_open then
          v_misses := v_misses + 1;
          exit when v_misses > v_grace;
          if v_w = v_monday - 7 then
            v_rested := true;
          end if;
        end if;
      end if;
      v_w := v_w - 7;
    end loop;
  end if;
  -- 先週の休みを保険で越えたのは、その前の週につながったときだけ
  v_rested := v_rested and v_start < v_monday - 7;

  select count(*) into v_count from unnest(v_days) x where x >= v_start;

  for i in 0..6 loop
    d := v_monday + i;
    v_closed := public.is_closed_day(d);
    if not v_closed then
      v_week_open := v_week_open + 1;
    end if;
    if d = any(v_days) then
      v_week_days := v_week_days + 1;
    end if;
    v_week := v_week || jsonb_build_object('day', d, 'dow', i + 1, 'closed', v_closed, 'played', d = any(v_days), 'today', d = v_today, 'future', d > v_today);
  end loop;

  return jsonb_build_object(
    'days', v_count,
    'weeks', v_weeks,
    'week_days', v_week_days,
    'week_open', v_week_open,
    'rested_last_week', v_rested,
    'today_closed', public.is_closed_day(v_today),
    'week', v_week
  );
end;
$$ language plpgsql stable security definer set search_path = public;

-- 自分の 🔥 と今週（ホーム・結果で使う）
create or replace function public.my_streak()
returns jsonb as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  return public.streak_state(auth.uid());
end;
$$ language plpgsql stable security definer set search_path = public;

-- 3. my_progress の streak_days を新しい数え方に（本体は 0004 のまま。名前を変えて包む）
alter function public.my_progress() rename to my_progress_core;

create or replace function public.my_progress()
returns jsonb as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  return public.my_progress_core() || jsonb_build_object('streak_days', (public.streak_state(auth.uid())->>'days')::int);
end;
$$ language plpgsql security definer set search_path = public;

-- 4. ログインボーナスの上乗せ（数え方は 🔥 と同じ。数字は app_settings）
create or replace function public.claim_daily_nuts()
returns jsonb as $$
declare
  v_uid uuid;
  v_today date;
  v_actual int := 0;
  v_balance int;
  v_already boolean := false;
  v_streak int := 0;
  v_bonus int := 0;
  v_next int := 0;
  v_small_days int := greatest(1, public.setting_num('streak_bonus_small_days', 3)::int);
  v_big_days int := greatest(1, public.setting_num('streak_bonus_big_days', 7)::int);
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_today := public.jst_today();
  v_streak := coalesce((public.streak_state(v_uid)->>'days')::int, 0);
  v_next := case when v_streak < v_small_days then v_small_days - v_streak
                 when v_streak < v_big_days then v_big_days - v_streak
                 else 0 end;
  if exists (select 1 from public.nut_ledger where player_id = v_uid and reason = 'daily' and ref = v_today::text) then
    v_already := true;
  else
    -- 今日の touch_today が済んでいる前提で呼ばれる。倍率は掛けない
    v_bonus := case when v_streak >= v_big_days then greatest(0, public.setting_num('streak_bonus_big', 3)::int)
                    when v_streak >= v_small_days then greatest(0, public.setting_num('streak_bonus_small', 1)::int)
                    else 0 end;
    v_actual := public.add_nuts(v_uid, public.scale_nuts(5) + v_bonus, 'daily', v_today::text);
  end if;

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  return jsonb_build_object(
    'earned', v_actual,
    'already_claimed', v_already,
    'balance', v_balance,
    'streak_days', v_streak,
    'streak_bonus', v_bonus,
    'streak_bonus_next', v_next
  );
end;
$$ language plpgsql security definer set search_path = public;

-- 5. スタッフ: 休館日の登録と、これからの2週間の見通し
create or replace function public.staff_calendar()
returns jsonb as $$
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  return jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', c.day, 'closed', c.closed, 'note', c.note) order by c.day)
      from public.calendar_days c
      where c.day >= public.jst_today() - 7
    ), '[]'::jsonb),
    'upcoming', (
      select jsonb_agg(jsonb_build_object('day', g::date, 'dow', extract(isodow from g)::int, 'closed', public.is_closed_day(g::date)) order by g)
      from generate_series(public.jst_today(), public.jst_today() + 13, interval '1 day') g
    )
  );
end;
$$ language plpgsql stable security definer set search_path = public;

-- p_closed: true = 休館 / false = 臨時開館 / null = 登録を消す（曜日の決まりに戻る）
create or replace function public.staff_set_calendar_day(p_day date, p_closed boolean, p_note text default '')
returns jsonb as $$
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  if p_day is null then
    raise exception 'invalid_setting_value';
  end if;
  if p_closed is null then
    delete from public.calendar_days where day = p_day;
  else
    insert into public.calendar_days (day, closed, note, updated_at)
    values (p_day, p_closed, left(trim(coalesce(p_note, '')), 40), now())
    on conflict (day) do update set closed = excluded.closed, note = excluded.note, updated_at = excluded.updated_at;
  end if;
  return public.staff_calendar();
end;
$$ language plpgsql security definer set search_path = public;

-- 6. スタッフ画面「設定」に休館日と 🔥 の数値を足す（0023 の一覧に追記）
create or replace function public.staff_settings()
returns jsonb as $$
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  return (
    select coalesce(jsonb_object_agg(k.key, jsonb_build_object('value', coalesce(s.value, k.def), 'label', k.label, 'kind', k.kind, 'min', k.lo, 'max', k.hi)), '{}'::jsonb)
    from (values
      ('streak_base_ms',   '7000', 'サバイバル 最初の制限時間（ミリ秒）', 'int',  '2000', '15000'),
      ('streak_step_ms',   '500',  'サバイバル 正解を重ねるごとに短くする時間（ミリ秒）', 'int', '0', '2000'),
      ('streak_time_every','10',   'サバイバル 何問正解ごとに時間を短くするか', 'int', '1', '50'),
      ('stage_unlock_correct','30','サバイバル 次のステージを開くのに要る連続', 'int', '1', '500'),
      ('streak_min_ms',    '3000', 'サバイバル 制限時間の下限（ミリ秒）', 'int', '1500', '10000'),
      ('knock_limit_ms',   '6000', 'トレーニング 1問の制限時間（ミリ秒）', 'int', '2000', '15000'),
      ('nut_score_per_nut','25',   'Miコイン 素点いくつで1個（小さいほど多くもらえる）', 'int', '5', '200'),
      ('nuts_scale',       '0.3333','Miコイン 倍率（対戦・ログインにも効く）', 'num', '0.05', '3'),
      ('nuts_daily_cap',   '200',  'Miコイン 1日の上限', 'int', '10', '5000'),
      ('pull_cost',        '5',    'ガチャ 1回の値段', 'int', '1', '500'),
      ('pull10_cost',      '50',   'ガチャ まとめ引きの値段', 'int', '1', '5000'),
      ('pull10_count',     '11',   'ガチャ まとめ引きで出る数', 'int', '10', '20'),
      ('raffle_rate',      '0.10', '抽選券 ガチャ1回で出る確率（0〜1）', 'num', '0', '1'),
      ('secret_rate',      '0.003','SECRET ガチャ1回で出る確率（0〜1）', 'num', '0', '0.05'),
      ('revenge_max',      '3',    'リベンジ 回の最初の何問まで（0で止める）', 'int', '0', '10'),
      ('revenge_days',     '14',   'リベンジ 何日前までのつまずきを出すか', 'int', '1', '60'),
      ('quest_coin',       '2',    '今日やること 1つでもらえる Miコイン', 'int', '0', '50'),
      ('quest_correct_goal','20',  '今日やること「正解 ◯問」', 'int', '1', '500'),
      ('quest_words_goal', '5',    '今日やること「図鑑に新しい単語 ◯語」', 'int', '1', '100'),
      ('zukan_mile_every', '50',   '図鑑 何語ごとにごほうび', 'int', '5', '500'),
      ('zukan_mile_coin',  '5',    '図鑑 途中のごほうびの Miコイン', 'int', '0', '100'),
      ('closed_weekdays',  '2',    '休館日 毎週の曜日', 'weekdays', '', ''),
      ('closed_nth_week',  '3',    '休館日 毎月 第◯週（0で なし）', 'int', '0', '5'),
      ('closed_nth_weekday','1',   '休館日 毎月 第◯週の曜日（1=月〜7=日）', 'int', '1', '7'),
      ('streak_week_min_open','3', '🔥 開館日がこれ未満の週は数えない', 'int', '0', '7'),
      ('streak_grace_weeks','1',   '🔥 続けて何週 来なくても切れないか', 'int', '0', '4'),
      ('streak_bonus_small_days','3','🔥 ログインボーナス 上乗せ（小）の日数', 'int', '1', '100'),
      ('streak_bonus_small','1',   '🔥 ログインボーナス 上乗せ（小）の Miコイン', 'int', '0', '50'),
      ('streak_bonus_big_days','7','🔥 ログインボーナス 上乗せ（大）の日数', 'int', '1', '365'),
      ('streak_bonus_big', '3',    '🔥 ログインボーナス 上乗せ（大）の Miコイン', 'int', '0', '50'),
      ('rank_mode_enabled','false','ランクモード（段の表示）', 'bool', '', '')
    ) as k(key, def, label, kind, lo, hi)
    left join public.app_settings s on s.key = k.key
  );
end;
$$ language plpgsql stable security definer set search_path = public;

-- 曜日の並び（'2' や '1,2'）を受け付けるように（0011 の本体に weekdays を足した）
create or replace function public.staff_set_setting(p_key text, p_value text)
returns jsonb as $$
declare
  v_kind text;
  v_lo numeric;
  v_hi numeric;
  v_num numeric;
  v_val text := trim(coalesce(p_value, ''));
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  select (public.staff_settings()->p_key->>'kind'), nullif(public.staff_settings()->p_key->>'min', '')::numeric, nullif(public.staff_settings()->p_key->>'max', '')::numeric
    into v_kind, v_lo, v_hi;
  if v_kind is null then
    raise exception 'setting_not_allowed';
  end if;
  if v_kind = 'bool' then
    if v_val not in ('true', 'false') then raise exception 'invalid_setting_value'; end if;
  elsif v_kind = 'weekdays' then
    v_val := replace(v_val, ' ', '');
    if v_val !~ '^([1-7](,[1-7])*)?$' then raise exception 'invalid_setting_value'; end if;
    select coalesce(string_agg(x, ',' order by x), '') into v_val
    from (select distinct x from unnest(string_to_array(nullif(v_val, ''), ',')) x) t;
  else
    begin
      v_num := v_val::numeric;
    exception when others then
      raise exception 'invalid_setting_value';
    end;
    if v_kind = 'int' and v_num <> floor(v_num) then raise exception 'invalid_setting_value'; end if;
    if v_num < v_lo or v_num > v_hi then raise exception 'setting_out_of_range'; end if;
    v_val := v_num::text;
  end if;
  insert into public.app_settings (key, value) values (p_key, v_val)
  on conflict (key) do update set value = excluded.value;
  return public.staff_settings();
end;
$$ language plpgsql security definer set search_path = public;

-- 7. 権限（全部取り消してから要るものだけ）
revoke all on public.calendar_days from public, anon, authenticated;
revoke all on function public.is_closed_day(date), public.streak_state(uuid), public.my_progress_core()
  from public, anon, authenticated;
revoke all on function public.my_streak(), public.my_progress(), public.claim_daily_nuts(),
  public.staff_calendar(), public.staff_set_calendar_day(date, boolean, text),
  public.staff_settings(), public.staff_set_setting(text, text)
  from public, anon, authenticated;
grant execute on function public.my_streak(), public.my_progress(), public.claim_daily_nuts(),
  public.staff_calendar(), public.staff_set_calendar_day(date, boolean, text),
  public.staff_settings(), public.staff_set_setting(text, text)
  to authenticated;

commit;
