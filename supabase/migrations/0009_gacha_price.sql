-- 0009_gacha_price.sql: ガチャを安くし、まとめ引きにおまけを付ける（2026-10-01 本人）
-- 1回 15個 → 5個。まとめ引き 150個で10回 → 50個で11回（10回ぶんの値段で1回おまけ・SR以上1つ確定は今まで通り）。
-- 「10連のうまみがあまりない」への対応。数は app_settings で変えられる。
-- 値段を1/3にしたので、もらえる木の実も1/3にする（本人「1/3にしてみようか」）。
-- 目安は「1日1時間遊べば11連1回（50個）」。対戦・ログイン・連続チャレンジ・100本ノックの全部に nuts_scale を掛ける。
begin;

insert into public.app_settings (key, value) values ('nuts_scale', '0.3333')
on conflict (key) do update set value = excluded.value;
update public.app_settings set value = '200' where key = 'nuts_daily_cap';

insert into public.app_settings (key, value) values ('pull10_count', '11') on conflict (key) do nothing;
update public.app_settings set value = '5' where key = 'pull_cost';
update public.app_settings set value = '50' where key = 'pull10_cost';

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

  v_prize_rate := greatest(0,least(1,public.setting_num('prize_rate', 0.01)));
  if exists(select 1 from public.players where id=v_uid and account_type='staff') then v_prize_rate:=0; end if;

  for i in 1..v_total loop
    -- 1. 景品判定
    v_prize := null;
    if random() < v_prize_rate then
      -- 在庫が1以上で有効な景品を重みづけで選択（行ロック）
      select p.*
      into v_prize
      from public.prizes p
      where p.reward_channel='gacha' and public.available_prize_stock(p,public.jst_week_start())>0
      order by -ln(greatest(1e-10, random())) / greatest(public.available_prize_stock(p,public.jst_week_start()), 1)
      limit 1
      for update;

      if found and v_prize.id is not null then
        if not v_prize.weekly_refill then
          update public.prizes set stock = stock - 1 where id = v_prize.id;
        end if;

        insert into public.prize_tickets (player_id, prize_id, won_at)
        values (v_uid, v_prize.id, public.jst_now())
        returning id into v_ticket_id;

        insert into public.weekly_prize_awards(week_start,channel,ticket_id,player_id) values(public.jst_week_start(),'gacha',v_ticket_id,v_uid);
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
      -- まとめ引きのSR以上保証: 最後の1回でまだSR以上も景品も出ていなければSR以上から選出
      if p_count = 10 and i = v_total and not v_has_sr_or_above then
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
    'count', v_total,
    'balance', v_balance,
    'shards_balance', v_shards_balance
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.gacha_rates() returns jsonb as $$
declare v_prizes jsonb; v_rate numeric; v_staff boolean;
begin
 v_staff:=exists(select 1 from public.players where id=auth.uid() and account_type='staff');
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'stock',public.available_prize_stock(p,public.jst_week_start())) order by p.created_at),'[]'::jsonb)
 into v_prizes from public.prizes p where p.reward_channel='gacha' and public.available_prize_stock(p,public.jst_week_start())>0;
 v_rate:=greatest(0,least(1,public.setting_num('prize_rate',0.01)));
 return jsonb_build_object('prize_rate',case when v_staff or jsonb_array_length(v_prizes)=0 then 0 else v_rate end,'configured_prize_rate',v_rate,
 'prizes',case when v_staff then '[]'::jsonb else v_prizes end,'staff_mode',v_staff,'weekly_limit',1,
 'weekly_remaining',case when exists(select 1 from public.weekly_prize_awards where week_start=public.jst_week_start() and channel='gacha') then 0 else 1 end,
 'item_rates',jsonb_build_object('N',0.70,'R',0.22,'SR',0.07,'UR',0.01),
 'pull_cost',public.setting_num('pull_cost',5)::int,'pull10_cost',public.setting_num('pull10_cost',50)::int,
 'pull10_count',greatest(10,public.setting_num('pull10_count',11)::int));
end; $$ language plpgsql stable security definer set search_path=public;

create or replace function public.staff_reward_overview() returns jsonb as $$
declare v_stats jsonb; v_rewards jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.staff where user_id=auth.uid()) then raise exception 'not_a_staff'; end if;
 select jsonb_build_object('students',count(*) filter(where account_type='student'),'staff',count(*) filter(where account_type='staff'),
 'weekly_active',count(*) filter(where account_type='student' and last_active_at >= (public.jst_week_start()::timestamp at time zone 'Asia/Tokyo'))) into v_stats from public.players;
 v_stats:=v_stats||jsonb_build_object('weekly_pulls',(select coalesce(sum(case when n.ref like '10_%' then greatest(10,public.setting_num('pull10_count',11)::int) else 1 end),0) from public.nut_ledger n join public.players p on p.id=n.player_id where p.account_type='student' and n.reason='gacha' and n.day>=public.jst_week_start()),
 'gacha_issued',(select count(*) from public.weekly_prize_awards where week_start=public.jst_week_start() and channel='gacha'),
 'ranking_issued_last_week',(select count(*) from public.weekly_prize_awards where week_start=public.jst_week_start()-7 and channel='ranking'));
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'channel',p.reward_channel,'active',p.active,'remaining',public.available_prize_stock(p,public.jst_week_start())) order by p.reward_channel),'[]'::jsonb) into v_rewards from public.prizes p where p.weekly_refill;
 return jsonb_build_object('stats',v_stats,'rewards',v_rewards,'prize_rate',greatest(0,least(1,public.setting_num('prize_rate',0.01))),'week_start',public.jst_week_start());
end; $$ language plpgsql stable security definer set search_path=public;

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
  -- そのあと nuts_scale（既定 1/3）を掛けて四捨五入
  v_raw_amount := public.scale_nuts(coalesce(v_match.correct, 0)
    + (case when v_match.result = 'win' then 3 else 0 end)
    + (case when v_match.correct = 10 then 5 else 0 end));

  v_actual := public.add_nuts(v_uid, v_raw_amount, 'match', p_match_id::text);
  v_capped := (v_actual < v_raw_amount);

  select coalesce(sum(amount), 0)::int into v_balance
  from public.nut_ledger
  where player_id = v_uid;

  v_today_cap := public.setting_num('nuts_daily_cap', 200)::int;
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
  v_streak int := 0;
  v_bonus int := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_today := public.jst_today();
  if exists (select 1 from public.nut_ledger where player_id = v_uid and reason = 'daily' and ref = v_today::text) then
    v_already := true;
  else
    -- 連続ログインの上乗せ（3日で +1、7日以上で +3。倍率は掛けない）。
    -- 連続日数は my_progress と同じ数え方。今日の touch_today が済んでいる前提で呼ばれる
    v_streak := coalesce((public.my_progress()->>'streak_days')::int, 0);
    v_bonus := case when v_streak >= 7 then 3 when v_streak >= 3 then 1 else 0 end;
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
    'streak_bonus', v_bonus
  );
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.claim_match_nuts(uuid), public.claim_daily_nuts() from public, anon, authenticated;
grant execute on function public.claim_match_nuts(uuid), public.claim_daily_nuts() to authenticated;
revoke all on function public.pull_gacha(int), public.gacha_rates(), public.staff_reward_overview() from public, anon, authenticated;
grant execute on function public.pull_gacha(int) to authenticated;
grant execute on function public.gacha_rates() to anon, authenticated;
grant execute on function public.staff_reward_overview() to authenticated;
commit;
