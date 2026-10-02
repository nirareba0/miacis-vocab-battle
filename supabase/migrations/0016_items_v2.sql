-- 0016_items_v2.sql: ガチャの品を 48 → 106 種に（2026-10-02 本人「ネコになるやつ、イヌになるやつ」「もっと多種類に。何かを参考に」）
-- 参考: ミアキスの子孫（食肉目）＝新しいスロット「すがた（form）」、韮崎と山梨の名所（背景）、中高生の日常（帽子・首・称号）。
-- レア度 5 = SECRET（ネコ・イヌのすがた）。ガチャ1回 0.3%（secret_rate）。かけら交換は不可
begin;

alter table public.items drop constraint if exists items_slot_check;
alter table public.items add constraint items_slot_check check (slot in ('hat','face','neck','background','aura','title','form'));
alter table public.items drop constraint if exists items_rarity_check;
alter table public.items add constraint items_rarity_check check (rarity between 1 and 5);
alter table public.player_looks add column if not exists form text references public.items(id);

insert into public.app_settings (key, value) values ('secret_rate', '0.003') on conflict (key) do nothing;

insert into public.items (id, name, slot, rarity, display, active, source) values
  ('form_fox', 'キツネのすがた', 'form', 3, '{}'::jsonb, true, 'gacha'),
  ('form_raccoon', 'アライグマのすがた', 'form', 3, '{}'::jsonb, true, 'gacha'),
  ('form_redpanda', 'レッサーパンダのすがた', 'form', 3, '{}'::jsonb, true, 'gacha'),
  ('form_weasel', 'イタチのすがた', 'form', 3, '{}'::jsonb, true, 'gacha'),
  ('form_tiger', 'トラのすがた', 'form', 4, '{}'::jsonb, true, 'gacha'),
  ('form_wolf', 'オオカミのすがた', 'form', 4, '{}'::jsonb, true, 'gacha'),
  ('form_lion', 'ライオンのすがた', 'form', 4, '{}'::jsonb, true, 'gacha'),
  ('form_bear', 'クマのすがた', 'form', 4, '{}'::jsonb, true, 'gacha'),
  ('form_cat', 'ネコのすがた', 'form', 5, '{}'::jsonb, true, 'gacha'),
  ('form_dog', 'イヌのすがた', 'form', 5, '{}'::jsonb, true, 'gacha'),
  ('hat_beanie', 'ニット帽', 'hat', 1, '{}'::jsonb, true, 'gacha'),
  ('hat_bucket', 'バケットハット', 'hat', 1, '{}'::jsonb, true, 'gacha'),
  ('hat_hachimaki', '部活のはちまき', 'hat', 1, '{}'::jsonb, true, 'gacha'),
  ('hat_chef', 'コック帽', 'hat', 1, '{}'::jsonb, true, 'gacha'),
  ('hat_headphones', 'ヘッドホン', 'hat', 2, '{}'::jsonb, true, 'gacha'),
  ('hat_flower', '花かんむり', 'hat', 2, '{}'::jsonb, true, 'gacha'),
  ('hat_witch', '魔女の帽子', 'hat', 2, '{}'::jsonb, true, 'gacha'),
  ('hat_santa', 'サンタ帽', 'hat', 2, '{}'::jsonb, true, 'gacha'),
  ('hat_halo', '天使の輪', 'hat', 3, '{}'::jsonb, true, 'gacha'),
  ('hat_kabuto', '武田の兜', 'hat', 4, '{}'::jsonb, true, 'gacha'),
  ('face_heart', 'ハートのメガネ', 'face', 1, '{}'::jsonb, true, 'gacha'),
  ('face_bandage', 'ほっぺの絆創膏', 'face', 1, '{}'::jsonb, true, 'gacha'),
  ('face_star', 'スターのサングラス', 'face', 2, '{}'::jsonb, true, 'gacha'),
  ('face_eyepatch', '海賊の眼帯', 'face', 2, '{}'::jsonb, true, 'gacha'),
  ('face_vr', 'VRゴーグル', 'face', 3, '{}'::jsonb, true, 'gacha'),
  ('face_tengu', '天狗の面', 'face', 3, '{}'::jsonb, true, 'gacha'),
  ('neck_bandana', 'バンダナ', 'neck', 1, '{}'::jsonb, true, 'gacha'),
  ('neck_whistle', '部活のホイッスル', 'neck', 1, '{}'::jsonb, true, 'gacha'),
  ('neck_school', '制服のネクタイ', 'neck', 1, '{}'::jsonb, true, 'gacha'),
  ('neck_lei', '花のレイ', 'neck', 2, '{}'::jsonb, true, 'gacha'),
  ('neck_cape', '勇者のマント', 'neck', 3, '{}'::jsonb, true, 'gacha'),
  ('neck_furin', '風林火山のマント', 'neck', 4, '{}'::jsonb, true, 'gacha'),
  ('bg_kamanashi', '釜無川の土手', 'background', 1, '{}'::jsonb, true, 'gacha'),
  ('bg_classroom', '放課後の教室', 'background', 1, '{}'::jsonb, true, 'gacha'),
  ('bg_yatsu', '八ヶ岳の朝', 'background', 2, '{}'::jsonb, true, 'gacha'),
  ('bg_fuji', '富士山の見える丘', 'background', 2, '{}'::jsonb, true, 'gacha'),
  ('bg_amari', '甘利山のレンゲツツジ', 'background', 2, '{}'::jsonb, true, 'gacha'),
  ('bg_shichiri', '七里岩の夕暮れ', 'background', 2, '{}'::jsonb, true, 'gacha'),
  ('bg_wanizuka', 'わに塚の桜', 'background', 3, '{}'::jsonb, true, 'gacha'),
  ('bg_festival', '夏祭りの夜', 'background', 3, '{}'::jsonb, true, 'gacha'),
  ('bg_space', '宇宙の果て', 'background', 4, '{}'::jsonb, true, 'gacha'),
  ('aura_bubble', 'シャボン玉', 'aura', 1, '{}'::jsonb, true, 'gacha'),
  ('aura_note', '音符のリズム', 'aura', 2, '{}'::jsonb, true, 'gacha'),
  ('aura_leaf', '舞う木の葉', 'aura', 2, '{}'::jsonb, true, 'gacha'),
  ('aura_fire', '燃える闘志', 'aura', 3, '{}'::jsonb, true, 'gacha'),
  ('aura_ice', '氷の結晶', 'aura', 3, '{}'::jsonb, true, 'gacha'),
  ('title_ippon', '一問入魂', 'title', 1, '{}'::jsonb, true, 'gacha'),
  ('title_asaren', '朝練の鬼', 'title', 1, '{}'::jsonb, true, 'gacha'),
  ('title_yontaku', '4択の勝負師', 'title', 1, '{}'::jsonb, true, 'gacha'),
  ('title_tsukai', 'ミアキス使い', 'title', 1, '{}'::jsonb, true, 'gacha'),
  ('title_library', '図書室の主', 'title', 2, '{}'::jsonb, true, 'gacha'),
  ('title_spell', 'スペルの達人', 'title', 2, '{}'::jsonb, true, 'gacha'),
  ('title_nirasaki', '韮崎の星', 'title', 2, '{}'::jsonb, true, 'gacha'),
  ('title_bannin', 'ことばの番人', 'title', 2, '{}'::jsonb, true, 'gacha'),
  ('title_nana', '七秒の魔術師', 'title', 3, '{}'::jsonb, true, 'gacha'),
  ('title_jisho', '辞書いらず', 'title', 3, '{}'::jsonb, true, 'gacha'),
  ('title_hasha', '放課後の覇者', 'title', 3, '{}'::jsonb, true, 'gacha'),
  ('title_legend', '伝説の語り部', 'title', 4, '{}'::jsonb, true, 'gacha')
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

  if p_slot not in ('hat','face','neck','background','aura','title','form') then
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

  insert into public.player_looks (player_id, hat, face, neck, background, aura, title, form)
  values (
    v_uid,
    case when p_slot = 'hat' then p_item_id else null end,
    case when p_slot = 'face' then p_item_id else null end,
    case when p_slot = 'neck' then p_item_id else null end,
    case when p_slot = 'background' then p_item_id else null end,
    case when p_slot = 'aura' then p_item_id else null end,
    case when p_slot = 'title' then p_item_id else null end,
    case when p_slot = 'form' then p_item_id else null end
  )
  on conflict (player_id) do update set
    hat = case when p_slot = 'hat' then p_item_id else public.player_looks.hat end,
    face = case when p_slot = 'face' then p_item_id else public.player_looks.face end,
    neck = case when p_slot = 'neck' then p_item_id else public.player_looks.neck end,
    background = case when p_slot = 'background' then p_item_id else public.player_looks.background end,
    aura = case when p_slot = 'aura' then p_item_id else public.player_looks.aura end,
    title = case when p_slot = 'title' then p_item_id else public.player_looks.title end,
    form = case when p_slot = 'form' then p_item_id else public.player_looks.form end;

  return jsonb_build_object('success', true, 'slot', p_slot, 'item_id', p_item_id);
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

  -- かけらで交換できるのはガチャの品の UR まで（SECRET と条件達成の称号は交換できない）
  select * into v_item
  from public.items
  where id = p_item_id and active = true and source = 'gacha' and rarity <= 4;

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
    'title', case when t.id is not null then jsonb_build_object('id', t.id, 'name', t.name, 'slot', t.slot, 'rarity', t.rarity, 'display', t.display) else null end,
    'form', case when fm.id is not null then jsonb_build_object('id', fm.id, 'name', fm.name, 'slot', fm.slot, 'rarity', fm.rarity, 'display', fm.display) else null end
  ) as looks
from public.players p
left join public.player_looks pl on pl.player_id = p.id
left join public.items h on h.id = pl.hat
left join public.items f on f.id = pl.face
left join public.items n on n.id = pl.neck
left join public.items b on b.id = pl.background
left join public.items a on a.id = pl.aura
left join public.items t on t.id = pl.title
left join public.items fm on fm.id = pl.form;

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
  v_total int;
  v_raffle_rate numeric;
  v_has_raffle boolean := false;
  v_month date;
  i int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_count not in (1, 10) then
    raise exception 'invalid_pull_count';
  end if;

  -- p_count = 10 は「まとめ引き」の合図（端末との約束を変えないため数字はそのまま）。
  -- 出てくる数は pull10_count（既定 11 = 10回ぶんの値段で1回おまけ）
  if p_count = 1 then
    v_cost := public.setting_num('pull_cost', 5)::int;
    v_total := 1;
  else
    v_cost := public.setting_num('pull10_cost', 50)::int;
    v_total := greatest(10, public.setting_num('pull10_count', 11)::int);
  end if;

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  if v_balance < v_cost then
    raise exception 'not_enough_nuts';
  end if;

  -- Serialize this player's balance and the shared weekly prize quota.
  perform 1 from public.players where id=v_uid for update;
  perform pg_advisory_xact_lock(73421,public.jst_week_start()-date '2000-01-01');
  -- 木の実を消費
  perform public.add_nuts(v_uid, -v_cost, 'gacha', p_count::text || '_' || gen_random_uuid()::text);

  -- 実物景品は直接当たらない。代わりに「抽選券」が出て、月末の抽選で当たる（券が多いほど当たりやすい）
  v_raffle_rate := greatest(0, least(1, public.setting_num('raffle_rate', 0.10)));
  if exists(select 1 from public.players where id=v_uid and account_type='staff') then v_raffle_rate := 0; end if;
  v_month := date_trunc('month', public.jst_today())::date;

  for i in 1..v_total loop
    -- 1. 抽選券（まとめ引きは 10 回目で未入手なら確定。最後の 1 回は SR 以上確定のために空けておく）
    v_prize := null;
    if v_raffle_rate > 0 and (
         (random() < v_raffle_rate and (p_count = 1 or i < v_total))
         or (p_count = 10 and i = v_total - 1 and not v_has_raffle)
       ) then
      insert into public.raffle_entries (player_id, month, source, ref)
      values (v_uid, v_month, 'gacha', gen_random_uuid()::text);
      v_has_raffle := true;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'kind', 'raffle',
        'name', '抽選券',
        'slot', null,
        'rarity', 3,
        'display', jsonb_build_object('month', to_char(v_month, 'YYYY-MM')),
        'is_new', false,
        'shards', 0,
        'ticket_id', null
      ));
      continue;
    end if;

    -- 着せ替え・称号の抽選
    if true then
      -- SECRET（ネコ・イヌのすがた など）: 超低確率。SR以上保証の枠でも同じ確率で出る
      if random() < greatest(0, least(1, public.setting_num('secret_rate', 0.003))) then
        v_target_rarity := 5;
      -- まとめ引きのSR以上保証: 最後の1回でまだSR以上が出ていなければSR以上から選出
      elsif p_count = 10 and i = v_total and not v_has_sr_or_above then
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
      where active = true and source = 'gacha' and rarity = v_target_rarity
      order by random()
      limit 1;

      if not found then
        select * into v_item from public.items where active = true and source = 'gacha' order by random() limit 1;
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
          when 5 then 100
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
    'count', v_total,
    'raffle_entries_month', (select count(*) from public.raffle_entries where player_id = v_uid and month = v_month),
    'balance', v_balance,
    'shards_balance', v_shards_balance
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.gacha_rates() returns jsonb as $$
declare v_prizes jsonb; v_rate numeric; v_staff boolean;
begin
 v_staff:=exists(select 1 from public.players where id=auth.uid() and account_type='staff');
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'stock',p.stock) order by p.created_at),'[]'::jsonb)
 into v_prizes from public.prizes p where p.reward_channel='raffle' and p.active and p.stock>0;
 v_rate:=0;
 return jsonb_build_object('prize_rate',case when v_staff or jsonb_array_length(v_prizes)=0 then 0 else v_rate end,'configured_prize_rate',v_rate,
 'prizes',case when v_staff then '[]'::jsonb else v_prizes end,'staff_mode',v_staff,'weekly_limit',1,
 'weekly_remaining',case when exists(select 1 from public.weekly_prize_awards where week_start=public.jst_week_start() and channel='gacha') then 0 else 1 end,
 'item_rates',jsonb_build_object('N',0.70,'R',0.22,'SR',0.07,'UR',0.01,'SECRET',greatest(0,least(1,public.setting_num('secret_rate',0.003)))),
 'pull_cost',public.setting_num('pull_cost',5)::int,'pull10_cost',public.setting_num('pull10_cost',50)::int,
 'pull10_count',greatest(10,public.setting_num('pull10_count',11)::int),
 'raffle_rate',case when v_staff then 0 else greatest(0,least(1,public.setting_num('raffle_rate',0.10))) end,
 'raffle_month',to_char(date_trunc('month',public.jst_today()),'YYYY-MM'),
 'raffle_total_entries',(select count(*) from public.raffle_entries e join public.players p on p.id=e.player_id where e.month=date_trunc('month',public.jst_today())::date and p.account_type='student'),
 'raffle_my_entries',(select count(*) from public.raffle_entries where player_id=auth.uid() and month=date_trunc('month',public.jst_today())::date));
end; $$ language plpgsql stable security definer set search_path=public;

create or replace function public.staff_settings()
returns jsonb as $$
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  return (
    select coalesce(jsonb_object_agg(k.key, jsonb_build_object('value', coalesce(s.value, k.def), 'label', k.label, 'kind', k.kind, 'min', k.lo, 'max', k.hi)), '{}'::jsonb)
    from (values
      ('streak_base_ms',   '7000', '連続チャレンジ 最初の制限時間（ミリ秒）', 'int',  '2000', '15000'),
      ('streak_step_ms',   '400',  '連続チャレンジ ステージごとに短くする時間（ミリ秒）', 'int', '0', '2000'),
      ('streak_min_ms',    '3500', '連続チャレンジ 制限時間の下限（ミリ秒）', 'int', '1500', '10000'),
      ('knock_limit_ms',   '6000', '100本ノック 1問の制限時間（ミリ秒）', 'int', '2000', '15000'),
      ('nut_score_per_nut','25',   'Miコイン 素点いくつで1個', 'int', '5', '200'),
      ('nuts_scale',       '0.3333','Miコイン 倍率（対戦・ログインにも効く）', 'num', '0.05', '3'),
      ('nuts_daily_cap',   '200',  'Miコイン 1日の上限', 'int', '10', '5000'),
      ('pull_cost',        '5',    'ガチャ 1回の値段', 'int', '1', '500'),
      ('pull10_cost',      '50',   'ガチャ まとめ引きの値段', 'int', '1', '5000'),
      ('pull10_count',     '11',   'ガチャ まとめ引きで出る数', 'int', '10', '20'),
      ('raffle_rate',      '0.10', '抽選券 ガチャ1回で出る確率（0〜1）', 'num', '0', '1'),
      ('secret_rate',      '0.003','SECRET（ネコ・イヌのすがた）ガチャ1回で出る確率（0〜1）', 'num', '0', '0.05'),
      ('rank_mode_enabled','false','ランクモード（段の表示）', 'bool', '', '')
    ) as k(key, def, label, kind, lo, hi)
    left join public.app_settings s on s.key = k.key
  );
end;
$$ language plpgsql stable security definer set search_path = public;
revoke all on function public.staff_settings() from public, anon, authenticated;
grant execute on function public.staff_settings() to authenticated;

revoke all on public.public_looks from public, anon, authenticated;
grant select on public.public_looks to anon, authenticated;
revoke all on function public.equip_item(text, text), public.exchange_item(text), public.pull_gacha(int), public.gacha_rates() from public, anon, authenticated;
grant execute on function public.equip_item(text, text), public.exchange_item(text), public.pull_gacha(int) to authenticated;
grant execute on function public.gacha_rates() to anon, authenticated;

commit;
