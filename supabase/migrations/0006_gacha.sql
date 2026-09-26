-- 0006_gacha.sql: 木の実・ガチャ・着せ替え・称号・館の景品
-- miacis-vocab-battle

-- 1. 設定 (app_settings) の初期値と内部関数 setting_num
insert into public.app_settings (key, value)
values
  ('nuts_daily_cap', '300'),
  ('pull_cost', '15'),
  ('pull10_cost', '150'),
  ('prize_rate', '0.01')
on conflict (key) do nothing;

create or replace function public.setting_num(p_key text, p_default numeric)
returns numeric as $$
declare
  v_val text;
begin
  select value into v_val from public.app_settings where key = p_key;
  if not found or v_val is null or trim(v_val) = '' then
    return p_default;
  end if;
  return v_val::numeric;
exception when others then
  return p_default;
end;
$$ language plpgsql stable security definer set search_path = public;


-- 2. 木の実 (nut_ledger, add_nuts, claim_match_nuts, claim_daily_nuts, my_nuts)
create table if not exists public.nut_ledger (
  id bigserial primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  amount int not null,
  reason text not null,
  ref text,
  day date not null,
  created_at timestamptz not null default now(),
  unique (player_id, reason, ref)
);

create index if not exists idx_nut_ledger_player_day on public.nut_ledger(player_id, day);

alter table public.nut_ledger enable row level security;
create policy "nut_ledger_select_own" on public.nut_ledger
  for select using (player_id = auth.uid());

create or replace function public.add_nuts(p_player_id uuid, p_amount int, p_reason text, p_ref text)
returns int as $$
declare
  v_today date;
  v_daily_cap int;
  v_today_earned int;
  v_remaining int;
  v_actual int;
  v_balance int;
begin
  if p_amount = 0 then
    return 0;
  end if;

  v_today := public.jst_today();

  if p_amount > 0 then
    v_daily_cap := public.setting_num('nuts_daily_cap', 300)::int;

    select coalesce(sum(amount), 0)::int
    into v_today_earned
    from public.nut_ledger
    where player_id = p_player_id
      and day = v_today
      and amount > 0;

    v_remaining := v_daily_cap - v_today_earned;
    if v_remaining <= 0 then
      return 0;
    end if;

    v_actual := least(p_amount, v_remaining);
    if v_actual > 0 then
      insert into public.nut_ledger (player_id, amount, reason, ref, day, created_at)
      values (p_player_id, v_actual, p_reason, p_ref, v_today, public.jst_now());
    end if;
    return v_actual;
  else
    -- 使う（マイナス）ときは上限に数えない
    select coalesce(sum(amount), 0)::int
    into v_balance
    from public.nut_ledger
    where player_id = p_player_id;

    if v_balance + p_amount < 0 then
      raise exception 'not_enough_nuts';
    end if;

    insert into public.nut_ledger (player_id, amount, reason, ref, day, created_at)
    values (p_player_id, p_amount, p_reason, p_ref, v_today, public.jst_now());
    return p_amount;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.claim_match_nuts(p_match_id uuid)
returns jsonb as $$
declare
  v_uid uuid;
  v_match public.matches;
  v_raw_amount int;
  v_actual int;
  v_capped boolean;
  v_balance int;
  v_today_cap int;
  v_today_earned int;
  v_remaining_cap int;
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

  if exists (select 1 from public.nut_ledger where player_id = v_uid and reason = 'match' and ref = p_match_id::text) then
    raise exception 'already_claimed';
  end if;

  -- 1問正解 1、勝ち +3、全問正解 +5
  v_raw_amount := coalesce(v_match.correct, 0)
    + (case when v_match.result = 'win' then 3 else 0 end)
    + (case when v_match.correct = 10 then 5 else 0 end);

  v_actual := public.add_nuts(v_uid, v_raw_amount, 'match', p_match_id::text);
  v_capped := (v_actual < v_raw_amount);

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  v_today_cap := public.setting_num('nuts_daily_cap', 300)::int;
  select coalesce(sum(amount), 0)::int into v_today_earned
  from public.nut_ledger
  where player_id = v_uid and day = public.jst_today() and amount > 0;

  v_remaining_cap := greatest(0, v_today_cap - v_today_earned);

  return jsonb_build_object(
    'earned', v_actual,
    'raw', v_raw_amount,
    'capped', v_capped,
    'balance', v_balance,
    'remaining_cap', v_remaining_cap
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.claim_daily_nuts()
returns jsonb as $$
declare
  v_uid uuid;
  v_today date;
  v_actual int := 0;
  v_balance int;
  v_already boolean := false;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_today := public.jst_today();
  if exists (select 1 from public.nut_ledger where player_id = v_uid and reason = 'daily' and ref = v_today::text) then
    v_already := true;
  else
    v_actual := public.add_nuts(v_uid, 5, 'daily', v_today::text);
  end if;

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  return jsonb_build_object(
    'earned', v_actual,
    'already_claimed', v_already,
    'balance', v_balance
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.my_nuts()
returns jsonb as $$
declare
  v_uid uuid;
  v_balance int;
  v_today_earned int;
  v_daily_cap int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  select coalesce(sum(amount), 0)::int into v_today_earned
  from public.nut_ledger
  where player_id = v_uid and day = public.jst_today() and amount > 0;

  v_daily_cap := public.setting_num('nuts_daily_cap', 300)::int;

  return jsonb_build_object(
    'balance', v_balance,
    'today_earned', v_today_earned,
    'daily_cap', v_daily_cap,
    'remaining_cap', greatest(0, v_daily_cap - v_today_earned)
  );
end;
$$ language plpgsql security definer set search_path = public;


-- 3. 着せ替えと称号のカタログ (items, player_items, player_looks, equip_item, public_looks)
create table if not exists public.items (
  id text primary key,
  name text not null,
  slot text not null check (slot in ('hat','face','neck','background','aura','title')),
  rarity smallint not null check (rarity between 1 and 4),
  display jsonb not null default '{}'::jsonb,
  active boolean not null default true
);

create table if not exists public.player_items (
  player_id uuid not null references public.players(id) on delete cascade,
  item_id text not null references public.items(id) on delete cascade,
  count int not null default 1 check (count >= 1),
  first_at timestamptz not null default now(),
  primary key (player_id, item_id)
);

create table if not exists public.player_looks (
  player_id uuid primary key references public.players(id) on delete cascade,
  hat text references public.items(id),
  face text references public.items(id),
  neck text references public.items(id),
  background text references public.items(id),
  aura text references public.items(id),
  title text references public.items(id)
);

alter table public.items enable row level security;
alter table public.player_items enable row level security;
alter table public.player_looks enable row level security;

create policy "items_select_all" on public.items for select using (true);
create policy "player_items_select_own" on public.player_items for select using (player_id = auth.uid());
create policy "player_looks_select_own" on public.player_looks for select using (player_id = auth.uid());

-- 初期カタログ 48アイテムの登録 (N 20, R 14, SR 10, UR 4)
insert into public.items (id, name, slot, rarity, display, active) values
  -- hat (N 3, R 2, SR 2, UR 1)
  ('hat_cap', 'キャップ', 'hat', 1, '{"emoji":"🧢"}'::jsonb, true),
  ('hat_straw', '麦わら帽子', 'hat', 1, '{"emoji":"👒"}'::jsonb, true),
  ('hat_silk', 'シルクハット', 'hat', 1, '{"emoji":"🎩"}'::jsonb, true),
  ('hat_grad', '卒業帽', 'hat', 2, '{"emoji":"🎓"}'::jsonb, true),
  ('hat_ribbon', 'ピンクリボン', 'hat', 2, '{"emoji":"🎀"}'::jsonb, true),
  ('hat_rescue', 'レスキューメット', 'hat', 3, '{"emoji":"⛑️"}'::jsonb, true),
  ('hat_safari', '探検帽', 'hat', 3, '{"emoji":"🪖"}'::jsonb, true),
  ('hat_crown', '黄金の王冠', 'hat', 4, '{"emoji":"👑"}'::jsonb, true),

  -- face (N 3, R 2, SR 2, UR 1)
  ('face_glasses', 'まるメガネ', 'face', 1, '{"emoji":"👓"}'::jsonb, true),
  ('face_sun', 'サングラス', 'face', 1, '{"emoji":"🕶️"}'::jsonb, true),
  ('face_monocle', 'モノクル', 'face', 1, '{"emoji":"🧐"}'::jsonb, true),
  ('face_disguise', '変装ヒゲメガネ', 'face', 2, '{"emoji":"🥸"}'::jsonb, true),
  ('face_mask', 'ホワイトマスク', 'face', 2, '{"emoji":"😷"}'::jsonb, true),
  ('face_goggle', 'サイバーゴーグル', 'face', 3, '{"emoji":"🥽"}'::jsonb, true),
  ('face_opera', 'オペラ座の仮面', 'face', 3, '{"emoji":"🎭"}'::jsonb, true),
  ('face_fox', '神社の狐面', 'face', 4, '{"emoji":"🦊"}'::jsonb, true),

  -- neck (N 3, R 2, SR 2, UR 1)
  ('neck_muffler', 'あったかマフラー', 'neck', 1, '{"emoji":"🧣"}'::jsonb, true),
  ('neck_tie', 'チェックのリボンタイ', 'neck', 1, '{"emoji":"🎗️"}'::jsonb, true),
  ('neck_beads', 'ウッドビーズ', 'neck', 1, '{"emoji":"📿"}'::jsonb, true),
  ('neck_bronze', '銅メダル', 'neck', 2, '{"emoji":"🥉"}'::jsonb, true),
  ('neck_bell', '銀の鈴', 'neck', 2, '{"emoji":"🔔"}'::jsonb, true),
  ('neck_gold', '金メダル', 'neck', 3, '{"emoji":"🥇"}'::jsonb, true),
  ('neck_pendant', '蒼水晶のペンダント', 'neck', 3, '{"emoji":"💎"}'::jsonb, true),
  ('neck_star', '星屑の首飾り', 'neck', 4, '{"emoji":"🌟"}'::jsonb, true),

  -- background (N 4, R 3, SR 1, UR 0)
  ('bg_green', '草原の朝', 'background', 1, '{"css":"linear-gradient(135deg, #1e6b3c, #f2c200)","label":"草原の朝"}'::jsonb, true),
  ('bg_sky', '青空の広場', 'background', 1, '{"css":"linear-gradient(135deg, #2980b9, #6dd5fa)","label":"青空の広場"}'::jsonb, true),
  ('bg_dusk', '夕焼けの帰り道', 'background', 1, '{"css":"linear-gradient(135deg, #f3904f, #3b4371)","label":"夕焼けの帰り道"}'::jsonb, true),
  ('bg_night', '星降る夜', 'background', 1, '{"css":"linear-gradient(135deg, #0f2027, #203a43)","label":"星降る夜"}'::jsonb, true),
  ('bg_forest', '木漏れ日の森', 'background', 2, '{"css":"linear-gradient(135deg, #134e5e, #71b280)","label":"木漏れ日の森"}'::jsonb, true),
  ('bg_sakura', '春の桜色', 'background', 2, '{"css":"linear-gradient(135deg, #ff9a9e, #fecfef)","label":"春の桜色"}'::jsonb, true),
  ('bg_ocean', '深海の碧', 'background', 2, '{"css":"linear-gradient(135deg, #2b5876, #4e4376)","label":"深海の碧"}'::jsonb, true),
  ('bg_aurora', '神秘のオーロラ', 'background', 3, '{"css":"linear-gradient(135deg, #00c6ff, #0072ff)","label":"神秘のオーロラ"}'::jsonb, true),

  -- aura (N 3, R 2, SR 2, UR 1)
  ('aura_white', '淡い白光', 'aura', 1, '{"color":"#e0e0e0","glow":12}'::jsonb, true),
  ('aura_green', '若葉のきらめき', 'aura', 1, '{"color":"#a8e6cf","glow":16}'::jsonb, true),
  ('aura_yellow', 'ひだまりのぬくもり', 'aura', 1, '{"color":"#ffd3b6","glow":16}'::jsonb, true),
  ('aura_blue', '蒼穹の光輪', 'aura', 2, '{"color":"#64b5f6","glow":20}'::jsonb, true),
  ('aura_pink', '桜の輝き', 'aura', 2, '{"color":"#f6c6cf","glow":24}'::jsonb, true),
  ('aura_gold', '黄金の覇気', 'aura', 3, '{"color":"#ffd700","glow":28}'::jsonb, true),
  ('aura_purple', '紫電の閃光', 'aura', 3, '{"color":"#ba68c8","glow":28}'::jsonb, true),
  ('aura_rainbow', '奇跡の虹彩', 'aura', 4, '{"color":"#ffffff","glow":32,"rainbow":true}'::jsonb, true),

  -- title (N 4, R 3, SR 1, UR 0)
  ('title_bud', 'ことばの芽', 'title', 1, '{}'::jsonb, true),
  ('title_hunter', '放課後の英単語ハンター', 'title', 1, '{}'::jsonb, true),
  ('title_runner', '単語ランナー', 'title', 1, '{}'::jsonb, true),
  ('title_challenger', 'チャレンジャー', 'title', 1, '{}'::jsonb, true),
  ('title_sage', '森の賢者', 'title', 2, '{}'::jsonb, true),
  ('title_gale', '草原の疾風', 'title', 2, '{}'::jsonb, true),
  ('title_seeker', '語彙の探求者', 'title', 2, '{}'::jsonb, true),
  ('title_oni', '連続正解の鬼', 'title', 3, '{}'::jsonb, true)
on conflict (id) do nothing;

create or replace function public.equip_item(p_slot text, p_item_id text)
returns jsonb as $$
declare
  v_uid uuid;
  v_slot text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_slot not in ('hat','face','neck','background','aura','title') then
    raise exception 'invalid_slot';
  end if;

  if p_item_id is not null then
    select slot into v_slot from public.items where id = p_item_id and active = true;
    if not found then
      raise exception 'item_not_found';
    end if;
    if v_slot <> p_slot then
      raise exception 'slot_mismatch';
    end if;
    if not exists (select 1 from public.player_items where player_id = v_uid and item_id = p_item_id) then
      raise exception 'item_not_owned';
    end if;
  end if;

  insert into public.player_looks (player_id, hat, face, neck, background, aura, title)
  values (
    v_uid,
    case when p_slot = 'hat' then p_item_id else null end,
    case when p_slot = 'face' then p_item_id else null end,
    case when p_slot = 'neck' then p_item_id else null end,
    case when p_slot = 'background' then p_item_id else null end,
    case when p_slot = 'aura' then p_item_id else null end,
    case when p_slot = 'title' then p_item_id else null end
  )
  on conflict (player_id) do update set
    hat = case when p_slot = 'hat' then p_item_id else public.player_looks.hat end,
    face = case when p_slot = 'face' then p_item_id else public.player_looks.face end,
    neck = case when p_slot = 'neck' then p_item_id else public.player_looks.neck end,
    background = case when p_slot = 'background' then p_item_id else public.player_looks.background end,
    aura = case when p_slot = 'aura' then p_item_id else public.player_looks.aura end,
    title = case when p_slot = 'title' then p_item_id else public.player_looks.title end;

  return jsonb_build_object('success', true, 'slot', p_slot, 'item_id', p_item_id);
end;
$$ language plpgsql security definer set search_path = public;

-- 公開の見た目 public_looks (id と学年は出さない)
create or replace view public.public_looks as
select
  p.nickname,
  p.tier,
  p.route,
  jsonb_build_object(
    'hat', case when h.id is not null then jsonb_build_object('id', h.id, 'name', h.name, 'slot', h.slot, 'rarity', h.rarity, 'display', h.display) else null end,
    'face', case when f.id is not null then jsonb_build_object('id', f.id, 'name', f.name, 'slot', f.slot, 'rarity', f.rarity, 'display', f.display) else null end,
    'neck', case when n.id is not null then jsonb_build_object('id', n.id, 'name', n.name, 'slot', n.slot, 'rarity', n.rarity, 'display', n.display) else null end,
    'background', case when b.id is not null then jsonb_build_object('id', b.id, 'name', b.name, 'slot', b.slot, 'rarity', b.rarity, 'display', b.display) else null end,
    'aura', case when a.id is not null then jsonb_build_object('id', a.id, 'name', a.name, 'slot', a.slot, 'rarity', a.rarity, 'display', a.display) else null end,
    'title', case when t.id is not null then jsonb_build_object('id', t.id, 'name', t.name, 'slot', t.slot, 'rarity', t.rarity, 'display', t.display) else null end
  ) as looks
from public.players p
left join public.player_looks pl on pl.player_id = p.id
left join public.items h on h.id = pl.hat
left join public.items f on f.id = pl.face
left join public.items n on n.id = pl.neck
left join public.items b on b.id = pl.background
left join public.items a on a.id = pl.aura
left join public.items t on t.id = pl.title;


-- 4. 館の景品 (prizes, prize_tickets, staff_*, my_tickets)
create table if not exists public.prizes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  stock int not null check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.prize_tickets (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  prize_id uuid not null references public.prizes(id) on delete cascade,
  won_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references public.staff(user_id)
);

alter table public.prizes enable row level security;
alter table public.prize_tickets enable row level security;

create policy "prize_tickets_select" on public.prize_tickets
  for select using (
    player_id = auth.uid()
    or exists (select 1 from public.staff where user_id = auth.uid())
  );

create or replace function public.staff_upsert_prize(
  p_id uuid,
  p_name text,
  p_description text,
  p_stock int,
  p_active boolean
) returns public.prizes as $$
declare
  v_uid uuid;
  v_prize public.prizes;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null or not exists (select 1 from public.staff where user_id = v_uid) then
    raise exception 'not_a_staff';
  end if;

  if p_stock < 0 then
    raise exception 'invalid_stock';
  end if;

  if p_name is null or trim(p_name) = '' then
    raise exception 'invalid_prize_name';
  end if;

  v_id := coalesce(p_id, gen_random_uuid());

  insert into public.prizes (id, name, description, stock, active, created_at)
  values (v_id, trim(p_name), coalesce(trim(p_description), ''), p_stock, coalesce(p_active, true), public.jst_now())
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    stock = excluded.stock,
    active = excluded.active
  returning * into v_prize;

  return v_prize;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.staff_list_tickets(p_only_open boolean default false)
returns jsonb as $$
declare
  v_uid uuid;
  v_res jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null or not exists (select 1 from public.staff where user_id = v_uid) then
    raise exception 'not_a_staff';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'player_id', t.player_id,
      'nickname', p.nickname,
      'prize_id', t.prize_id,
      'prize_name', pr.name,
      'prize_description', pr.description,
      'won_at', t.won_at,
      'redeemed_at', t.redeemed_at,
      'redeemed_by', t.redeemed_by
    ) order by t.won_at desc
  ), '[]'::jsonb)
  into v_res
  from public.prize_tickets t
  join public.players p on p.id = t.player_id
  join public.prizes pr on pr.id = t.prize_id
  where (not coalesce(p_only_open, false) or t.redeemed_at is null);

  return v_res;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.staff_redeem_ticket(p_ticket_id uuid)
returns jsonb as $$
declare
  v_uid uuid;
  v_ticket public.prize_tickets;
begin
  v_uid := auth.uid();
  if v_uid is null or not exists (select 1 from public.staff where user_id = v_uid) then
    raise exception 'not_a_staff';
  end if;

  select * into v_ticket from public.prize_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'ticket_not_found';
  end if;

  if v_ticket.redeemed_at is not null then
    raise exception 'already_redeemed';
  end if;

  update public.prize_tickets
  set redeemed_at = public.jst_now(),
      redeemed_by = v_uid
  where id = p_ticket_id
  returning * into v_ticket;

  return jsonb_build_object(
    'id', v_ticket.id,
    'redeemed_at', v_ticket.redeemed_at,
    'redeemed_by', v_ticket.redeemed_by
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.my_tickets()
returns jsonb as $$
declare
  v_uid uuid;
  v_res jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'prize_name', pr.name,
      'prize_description', pr.description,
      'won_at', t.won_at,
      'redeemed_at', t.redeemed_at
    ) order by t.won_at desc
  ), '[]'::jsonb)
  into v_res
  from public.prize_tickets t
  join public.prizes pr on pr.id = t.prize_id
  where t.player_id = v_uid;

  return v_res;
end;
$$ language plpgsql security definer set search_path = public;


-- 5. ガチャとかけら (player_shards, pull_gacha, exchange_item, gacha_rates)
create table if not exists public.player_shards (
  player_id uuid primary key references public.players(id) on delete cascade,
  amount int not null default 0 check (amount >= 0)
);

alter table public.player_shards enable row level security;
create policy "player_shards_select_own" on public.player_shards for select using (player_id = auth.uid());

create or replace function public.gacha_rates()
returns jsonb as $$
declare
  v_prize_rate numeric;
  v_prizes jsonb;
begin
  v_prize_rate := public.setting_num('prize_rate', 0.01);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', name,
      'description', description,
      'stock', stock
    ) order by created_at asc
  ), '[]'::jsonb)
  into v_prizes
  from public.prizes
  where active = true and stock > 0;

  return jsonb_build_object(
    'prize_rate', v_prize_rate,
    'prizes', v_prizes,
    'item_rates', jsonb_build_object(
      'N', 0.70,
      'R', 0.22,
      'SR', 0.07,
      'UR', 0.01
    )
  );
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function public.pull_gacha(p_count int)
returns jsonb as $$
declare
  v_uid uuid;
  v_cost int;
  v_balance int;
  v_shards_balance int;
  v_prize_rate numeric;
  v_results jsonb := '[]'::jsonb;
  v_has_sr_or_above boolean := false;
  v_has_prize boolean := false;
  v_prize public.prizes;
  v_ticket_id uuid;
  v_item public.items;
  v_rnd double precision;
  v_target_rarity smallint;
  v_existing_count int;
  v_is_new boolean;
  v_shard_gain int;
  i int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_count not in (1, 10) then
    raise exception 'invalid_pull_count';
  end if;

  if p_count = 1 then
    v_cost := public.setting_num('pull_cost', 15)::int;
  else
    v_cost := public.setting_num('pull10_cost', 150)::int;
  end if;

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  if v_balance < v_cost then
    raise exception 'not_enough_nuts';
  end if;

  -- 木の実を消費
  perform public.add_nuts(v_uid, -v_cost, 'gacha', p_count::text || '_' || gen_random_uuid()::text);

  v_prize_rate := public.setting_num('prize_rate', 0.01);

  for i in 1..p_count loop
    -- 1. 景品判定
    v_prize := null;
    if random() < v_prize_rate then
      -- 在庫が1以上で有効な景品を重みづけで選択（行ロック）
      select id, name, description, stock
      into v_prize
      from public.prizes
      where active = true and stock > 0
      order by -ln(greatest(1e-10, random())) / greatest(stock, 1)
      limit 1
      for update;

      if found and v_prize.id is not null then
        update public.prizes set stock = stock - 1 where id = v_prize.id;

        insert into public.prize_tickets (player_id, prize_id, won_at)
        values (v_uid, v_prize.id, public.jst_now())
        returning id into v_ticket_id;

        v_has_prize := true;
        v_has_sr_or_above := true;

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'kind', 'prize',
          'name', v_prize.name,
          'slot', null,
          'rarity', 4,
          'display', jsonb_build_object('ticket_id', v_ticket_id, 'description', v_prize.description),
          'is_new', true,
          'shards', 0,
          'ticket_id', v_ticket_id
        ));
      end if;
    end if;

    -- 景品に当たらなかった場合 (着せ替え・称号の抽選)
    if v_prize is null or v_prize.id is null then
      -- 10連のSR以上保証: 10回目でまだSR以上も景品も出ていなければSR以上から選出
      if p_count = 10 and i = 10 and not v_has_sr_or_above then
        if random() < 0.875 then
          v_target_rarity := 3;
        else
          v_target_rarity := 4;
        end if;
      else
        v_rnd := random();
        if v_rnd < 0.70 then
          v_target_rarity := 1;
        elsif v_rnd < 0.92 then
          v_target_rarity := 2;
        elsif v_rnd < 0.99 then
          v_target_rarity := 3;
        else
          v_target_rarity := 4;
        end if;
      end if;

      if v_target_rarity >= 3 then
        v_has_sr_or_above := true;
      end if;

      select * into v_item
      from public.items
      where active = true and rarity = v_target_rarity
      order by random()
      limit 1;

      if not found then
        select * into v_item from public.items where active = true order by random() limit 1;
      end if;

      -- 重なり判定 & かけら付与
      select count into v_existing_count
      from public.player_items
      where player_id = v_uid and item_id = v_item.id;

      if not found then
        v_is_new := true;
        v_shard_gain := 0;
        insert into public.player_items (player_id, item_id, count, first_at)
        values (v_uid, v_item.id, 1, public.jst_now());
      else
        v_is_new := false;
        v_shard_gain := case v_item.rarity
          when 1 then 1
          when 2 then 3
          when 3 then 10
          when 4 then 30
          else 0
        end;

        update public.player_items
        set count = count + 1
        where player_id = v_uid and item_id = v_item.id;

        if v_shard_gain > 0 then
          insert into public.player_shards (player_id, amount)
          values (v_uid, v_shard_gain)
          on conflict (player_id) do update set amount = public.player_shards.amount + excluded.amount;
        end if;
      end if;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'kind', 'item',
        'id', v_item.id,
        'name', v_item.name,
        'slot', v_item.slot,
        'rarity', v_item.rarity,
        'display', v_item.display,
        'is_new', v_is_new,
        'shards', v_shard_gain,
        'ticket_id', null
      ));
    end if;
  end loop;

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  select coalesce(amount, 0) into v_shards_balance
  from public.player_shards
  where player_id = v_uid;

  return jsonb_build_object(
    'results', v_results,
    'spent_nuts', v_cost,
    'balance', v_balance,
    'shards_balance', v_shards_balance
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.exchange_item(p_item_id text)
returns jsonb as $$
declare
  v_uid uuid;
  v_item public.items;
  v_cost int;
  v_shards int;
  v_count int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_item
  from public.items
  where id = p_item_id and active = true;

  if not found then
    raise exception 'item_not_found';
  end if;

  v_cost := case v_item.rarity
    when 1 then 10
    when 2 then 30
    when 3 then 100
    when 4 then 300
    else 1000
  end;

  select coalesce(amount, 0) into v_shards
  from public.player_shards
  where player_id = v_uid;

  if v_shards < v_cost then
    raise exception 'not_enough_shards';
  end if;

  update public.player_shards
  set amount = amount - v_cost
  where player_id = v_uid;

  select count into v_count
  from public.player_items
  where player_id = v_uid and item_id = p_item_id;

  if not found then
    insert into public.player_items (player_id, item_id, count, first_at)
    values (v_uid, p_item_id, 1, public.jst_now());
    v_count := 1;
  else
    update public.player_items
    set count = count + 1
    where player_id = v_uid and item_id = p_item_id;
    v_count := v_count + 1;
  end if;

  return jsonb_build_object(
    'item', row_to_json(v_item),
    'count', v_count,
    'shards_balance', v_shards - v_cost
  );
end;
$$ language plpgsql security definer set search_path = public;


-- 6. 単語の図鑑 (my_words: 本人の終わった match の中で正解した単語（重複なし）を段ごとに)
create or replace function public.my_words()
returns jsonb as $$
declare
  v_uid uuid;
  v_words jsonb;
  v_bands jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  with player_matches as (
    select questions, answers
    from public.matches
    where player_id = v_uid
      and finished_at is not null
  ),
  unwound as (
    select
      (q.value->>'word_id')::int as word_id
    from player_matches m,
    jsonb_array_elements(m.questions) with ordinality q(value, idx),
    jsonb_array_elements(m.answers) with ordinality a(value, idx)
    where q.idx = a.idx
      and (a.value->>'choice') is not null
      and (a.value->>'ms')::int < 6000
      and (a.value->>'choice')::int = (q.value->>'answer_index')::int
  ),
  distinct_words as (
    select distinct word_id from unwound
  ),
  words_with_meta as (
    select
      w.id as word_id,
      w.en,
      w.ja,
      w.band,
      w.rank
    from distinct_words dw
    join public.words w on w.id = dw.word_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'word_id', wm.word_id,
      'en', wm.en,
      'ja', wm.ja,
      'band', wm.band,
      'rank', wm.rank
    ) order by wm.band asc, wm.rank asc
  ), '[]'::jsonb)
  into v_words
  from words_with_meta wm;

  with band_totals as (
    select b.band, coalesce(count(w.id), 0)::int as total
    from generate_series(1, 5) as b(band)
    left join public.words w on w.band = b.band
    group by b.band
  ),
  player_matches as (
    select questions, answers
    from public.matches
    where player_id = v_uid
      and finished_at is not null
  ),
  unwound as (
    select
      (q.value->>'word_id')::int as word_id
    from player_matches m,
    jsonb_array_elements(m.questions) with ordinality q(value, idx),
    jsonb_array_elements(m.answers) with ordinality a(value, idx)
    where q.idx = a.idx
      and (a.value->>'choice') is not null
      and (a.value->>'ms')::int < 6000
      and (a.value->>'choice')::int = (q.value->>'answer_index')::int
  ),
  distinct_words as (
    select distinct word_id from unwound
  ),
  band_collected as (
    select b.band, coalesce(count(dw.word_id), 0)::int as collected
    from generate_series(1, 5) as b(band)
    left join (
      distinct_words dw
      join public.words w on w.id = dw.word_id
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
    'words', v_words,
    'bands', v_bands
  );
end;
$$ language plpgsql security definer set search_path = public;


-- 7. 権限 (REVOKE & GRANT: 0003 と同じく全部取り消してから必要なものだけ許す)
revoke all on public.nut_ledger from anon, authenticated;
revoke all on public.items from anon, authenticated;
revoke all on public.player_items from anon, authenticated;
revoke all on public.player_looks from anon, authenticated;
revoke all on public.player_shards from anon, authenticated;
revoke all on public.prizes from anon, authenticated;
revoke all on public.prize_tickets from anon, authenticated;
revoke all on public.public_looks from anon, authenticated;
revoke all on sequence public.nut_ledger_id_seq from anon, authenticated;

revoke execute on function public.setting_num(text, numeric) from public, anon, authenticated;
revoke execute on function public.add_nuts(uuid, int, text, text) from public, anon, authenticated;
revoke execute on function public.claim_match_nuts(uuid) from public, anon, authenticated;
revoke execute on function public.claim_daily_nuts() from public, anon, authenticated;
revoke execute on function public.my_nuts() from public, anon, authenticated;
revoke execute on function public.equip_item(text, text) from public, anon, authenticated;
revoke execute on function public.pull_gacha(int) from public, anon, authenticated;
revoke execute on function public.exchange_item(text) from public, anon, authenticated;
revoke execute on function public.gacha_rates() from public, anon, authenticated;
revoke execute on function public.my_words() from public, anon, authenticated;
revoke execute on function public.my_tickets() from public, anon, authenticated;
revoke execute on function public.staff_upsert_prize(uuid, text, text, int, boolean) from public, anon, authenticated;
revoke execute on function public.staff_list_tickets(boolean) from public, anon, authenticated;
revoke execute on function public.staff_redeem_ticket(uuid) from public, anon, authenticated;

-- anon も authenticated も読めるカタログと公開見た目、確率
grant select on public.items to anon, authenticated;
grant select on public.public_looks to anon, authenticated;
grant execute on function public.gacha_rates() to anon, authenticated;

-- authenticated は自分の行のみ読めるテーブル
grant select on public.nut_ledger, public.player_items, public.player_looks, public.player_shards, public.prize_tickets to authenticated;

-- authenticated が実行できる関数
grant execute on function
  public.claim_match_nuts(uuid),
  public.claim_daily_nuts(),
  public.my_nuts(),
  public.equip_item(text, text),
  public.pull_gacha(int),
  public.exchange_item(text),
  public.my_words(),
  public.my_tickets(),
  public.staff_upsert_prize(uuid, text, text, int, boolean),
  public.staff_list_tickets(boolean),
  public.staff_redeem_ticket(uuid)
  to authenticated;
