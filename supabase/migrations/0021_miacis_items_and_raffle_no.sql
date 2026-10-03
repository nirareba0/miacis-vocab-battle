-- 0021_miacis_items_and_raffle_no.sql（2026-10-03 本人）
-- 1.「UR にも何個か追加したい。ミアキスにある卓球・麻雀・ヘアアイロン・ダーツ・Wii・パーソナルカラー診断・インタビューから
--    各パーツを作って、目玉パーツは UR に」→ 22種（UR 7・SR 3・R 6・N 6）。Wii は商標なので名前と絵に入れない（「白いリモコン」）
-- 2.「抽選券には数字を割り振って、それがたまっていくように。月末にこの番号が当たりなので画面を見せて、という形に」
--    raffle_entries に月ごとの通し番号 no。抽選は券を1枚引き、その番号を raffle_results.winning_no に残す
-- 3. 100本ノック → 100本トレーニング に合わせて称号の名前を直す
begin;

-- 1. 新しいガチャの品
insert into public.items (id, name, slot, rarity, display, active, source) values
  ('aura_pingpong', 'ピンポン旋風', 'aura', 4, '{}'::jsonb, true, 'gacha'),
  ('hat_pingpong_band', '卓球のヘアバンド', 'hat', 1, '{}'::jsonb, true, 'gacha'),
  ('title_rally', 'ラリー職人', 'title', 1, '{}'::jsonb, true, 'gacha'),
  ('bg_mahjong', '役満の卓', 'background', 4, '{}'::jsonb, true, 'gacha'),
  ('neck_mahjong', '牌のネックレス', 'neck', 2, '{}'::jsonb, true, 'gacha'),
  ('title_tsumo', '一発ツモ', 'title', 2, '{}'::jsonb, true, 'gacha'),
  ('hat_curls', 'サロン帰りの巻き髪', 'hat', 4, '{}'::jsonb, true, 'gacha'),
  ('aura_iron_shine', 'アイロンのつや', 'aura', 2, '{}'::jsonb, true, 'gacha'),
  ('face_hairclip', '前髪クリップ', 'face', 1, '{}'::jsonb, true, 'gacha'),
  ('face_bullseye', 'ブルズアイ・ゴーグル', 'face', 4, '{}'::jsonb, true, 'gacha'),
  ('bg_dartsbar', 'ダーツバーの壁', 'background', 2, '{}'::jsonb, true, 'gacha'),
  ('neck_dart', 'ダーツのチャーム', 'neck', 1, '{}'::jsonb, true, 'gacha'),
  ('neck_remote', '白いリモコン', 'neck', 4, '{}'::jsonb, true, 'gacha'),
  ('bg_gameparty', 'みんなでゲーム大会', 'background', 3, '{}'::jsonb, true, 'gacha'),
  ('title_allsports', '全種目制覇', 'title', 2, '{}'::jsonb, true, 'gacha'),
  ('aura_4season', '4シーズンのオーラ', 'aura', 4, '{}'::jsonb, true, 'gacha'),
  ('neck_drape', '診断ドレープ', 'neck', 3, '{}'::jsonb, true, 'gacha'),
  ('title_bluebase', 'ブルベ冬', 'title', 1, '{}'::jsonb, true, 'gacha'),
  ('title_yellowbase', 'イエベ春', 'title', 1, '{}'::jsonb, true, 'gacha'),
  ('bg_interview', 'インタビューのスポットライト', 'background', 4, '{}'::jsonb, true, 'gacha'),
  ('face_mic', '取材のハンドマイク', 'face', 3, '{}'::jsonb, true, 'gacha'),
  ('hat_headset', '取材のヘッドセット', 'hat', 2, '{}'::jsonb, true, 'gacha')
on conflict (id) do nothing;

update public.items set name = 'トレーニングの鬼' where id = 'title_knock_oni';
update public.items set name = '100本トレーニング 完走' where id = 'title_knock_done';

-- 2. 抽選券の番号（その月の 1 から。スタッフにはガチャで券が出ない）
alter table public.raffle_entries add column if not exists no int;
update public.raffle_entries e set no = x.rn
from (select id, row_number() over (partition by month order by created_at, id) as rn from public.raffle_entries) x
where x.id = e.id and e.no is null;

create or replace function public.raffle_entries_set_no()
returns trigger as $$
begin
  -- 同じ月の番号を同時に配らないよう、月ごとに鍵をかけてから最大値 + 1
  perform pg_advisory_xact_lock(73423, (new.month - date '2000-01-01'));
  select coalesce(max(no), 0) + 1 into new.no from public.raffle_entries where month = new.month;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
drop trigger if exists raffle_entries_set_no on public.raffle_entries;
create trigger raffle_entries_set_no before insert on public.raffle_entries
  for each row execute function public.raffle_entries_set_no();

alter table public.raffle_entries alter column no set not null;
create unique index if not exists raffle_entries_month_no on public.raffle_entries(month, no);

alter table public.raffle_results add column if not exists winning_no int;

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
  v_raffle_no int;
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
      values (v_uid, v_month, 'gacha', gen_random_uuid()::text)
      returning no into v_raffle_no;
      v_has_raffle := true;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'kind', 'raffle',
        'name', '抽選券',
        'slot', null,
        'rarity', 3,
        'display', jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'no', v_raffle_no),
        'no', v_raffle_no,
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

create or replace function public.draw_monthly_raffle(p_month date)
returns jsonb as $$
declare
  v_prize public.prizes;
  v_total int;
  v_winner uuid;
  v_winner_entries int;
  v_ticket uuid;
  v_no int;
  v_out jsonb := '[]'::jsonb;
begin
  if p_month <> date_trunc('month', p_month)::date then
    raise exception 'invalid_month';
  end if;
  if p_month >= date_trunc('month', public.jst_today())::date then
    raise exception 'month_not_closed';
  end if;

  perform pg_advisory_xact_lock(73422, (p_month - date '2000-01-01'));

  for v_prize in
    select * from public.prizes
    where reward_channel = 'raffle' and active and stock > 0
    order by created_at, id
    for update
  loop
    if exists (select 1 from public.raffle_results where month = p_month and prize_id = v_prize.id) then
      continue;
    end if;

    select count(*) into v_total
    from public.raffle_entries e join public.players p on p.id = e.player_id
    where e.month = p_month and p.account_type = 'student'
      and e.player_id not in (select player_id from public.raffle_results where month = p_month and player_id is not null);

    if v_total = 0 then
      continue;
    end if;

    -- 0021: 券を1枚引く。引いた券の番号が「当たり番号」（券が多い人ほど当たりやすいのは同じ）
    select e.player_id, e.no into v_winner, v_no
    from public.raffle_entries e join public.players p on p.id = e.player_id
    where e.month = p_month and p.account_type = 'student'
      and e.player_id not in (select player_id from public.raffle_results where month = p_month and player_id is not null)
    order by random() limit 1;

    select count(*) into v_winner_entries from public.raffle_entries where month = p_month and player_id = v_winner;

    insert into public.prize_tickets (player_id, prize_id, won_at) values (v_winner, v_prize.id, public.jst_now()) returning id into v_ticket;
    update public.prizes set stock = stock - 1 where id = v_prize.id;
    insert into public.raffle_results (month, prize_id, player_id, ticket_id, total_entries, winner_entries, winning_no)
    values (p_month, v_prize.id, v_winner, v_ticket, v_total, v_winner_entries, v_no);

    v_out := v_out || jsonb_build_array(jsonb_build_object('prize', v_prize.name, 'no', v_no, 'player_id', v_winner, 'total_entries', v_total, 'winner_entries', v_winner_entries));
  end loop;

  return v_out;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.my_raffle()
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', public.jst_today())::date;
  v_prev date := (date_trunc('month', public.jst_today()) - interval '1 month')::date;
  v_staff boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_staff := exists (select 1 from public.staff where user_id = v_uid);
  return jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'),
    'my_entries', (select count(*) from public.raffle_entries where player_id = v_uid and month = v_month),
    -- 0021: 自分の券の番号（たまっていく）
    'my_numbers', (select coalesce(jsonb_agg(no order by no), '[]'::jsonb) from public.raffle_entries where player_id = v_uid and month = v_month),
    'total_entries', (select count(*) from public.raffle_entries e join public.players p on p.id = e.player_id where e.month = v_month and p.account_type = 'student'),
    'holders', (select count(distinct e.player_id) from public.raffle_entries e join public.players p on p.id = e.player_id where e.month = v_month and p.account_type = 'student'),
    'prizes', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'description', description, 'stock', stock) order by created_at), '[]'::jsonb) from public.prizes where reward_channel = 'raffle' and active and stock > 0),
    -- 当たりは番号で発表する。名前はスタッフと本人にだけ返す（生徒は「この番号の人は画面を見せて」で名乗り出る）
    'last_results', (select coalesce(jsonb_agg(jsonb_build_object(
                        'month', to_char(r.month, 'YYYY-MM'), 'prize', pr.name, 'no', r.winning_no,
                        'nickname', case when v_staff or r.player_id = v_uid then p.nickname end,
                        'is_me', r.player_id = v_uid, 'total_entries', r.total_entries, 'winner_entries', r.winner_entries)
                      order by r.drawn_at desc), '[]'::jsonb)
                     from public.raffle_results r join public.prizes pr on pr.id = r.prize_id left join public.players p on p.id = r.player_id where r.month = v_prev)
  );
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.raffle_entries_set_no() from public, anon, authenticated;
revoke all on function public.pull_gacha(int), public.draw_monthly_raffle(date), public.my_raffle() from public, anon, authenticated;
grant execute on function public.pull_gacha(int), public.my_raffle() to authenticated;

commit;
