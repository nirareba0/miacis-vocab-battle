-- Staff accounts and one weekly reward per channel. All time boundaries use JST.
-- This migration is atomic; reward definitions start disabled until their terms are set.
begin;
alter table public.players add column account_type text not null default 'student' check (account_type in ('student','staff'));
alter table public.players alter column grade drop not null;
update public.players p set account_type='staff',grade=null where exists(select 1 from public.staff s where s.user_id=p.id);
alter table public.players add constraint players_account_grade_check check ((account_type='student' and grade is not null and grade between 1 and 6) or (account_type='staff' and grade is null));
create or replace function public.sync_staff_account() returns trigger as $$
begin
 update public.players set account_type='staff',grade=null where id=new.user_id;
 return new;
end; $$ language plpgsql security definer set search_path=public;
revoke all on function public.sync_staff_account() from public,anon,authenticated;
create trigger sync_staff_account after insert on public.staff for each row execute function public.sync_staff_account();

alter table public.prizes add column reward_channel text not null default 'gacha' check(reward_channel in ('gacha','ranking'));
alter table public.prizes add column weekly_refill boolean not null default false;
alter table public.prizes add column effective_week date not null default public.jst_week_start();
create table public.weekly_prize_awards (
 week_start date not null,
 channel text not null check(channel in ('gacha','ranking')),
 ticket_id uuid references public.prize_tickets(id) on delete set null,
 player_id uuid references public.players(id) on delete set null,
 awarded_at timestamptz not null default public.jst_now(),
 primary key(week_start,channel)
);
alter table public.weekly_prize_awards enable row level security;
revoke all on public.weekly_prize_awards from public,anon,authenticated;
-- Preserve historical issuance even if a ticket or player is later deleted.
insert into public.weekly_prize_awards(week_start,channel,ticket_id,player_id,awarded_at)
select distinct on (public.jst_week_start(won_at)) public.jst_week_start(won_at),'gacha',id,player_id,won_at
from public.prize_tickets order by public.jst_week_start(won_at),won_at,id;
insert into public.prizes(id,name,description,stock,active,reward_channel,weekly_refill)
values ('77777777-0000-4000-8000-000000000001','選べる無料券（ガチャ）','購買部の100円までの商品1点、またはチェキ1回のどちらかを選べます。館内でスタッフに引換券を見せてください。',1,false,'gacha',true),
('77777777-0000-4000-8000-000000000002','選べる無料券（週間1位）','購買部の100円までの商品1点、またはチェキ1回のどちらかを選べます。館内でスタッフに引換券を見せてください。',1,false,'ranking',true);

create or replace function public.available_prize_stock(p_prize public.prizes, p_week date)
returns int as $$
 select case when not p_prize.active or p_prize.effective_week>p_week then 0
 when exists(select 1 from public.weekly_prize_awards where week_start=p_week and channel=p_prize.reward_channel) then 0
 when p_prize.weekly_refill then 1 else p_prize.stock end;
$$ language sql stable security definer set search_path=public;
revoke all on function public.available_prize_stock(public.prizes,date) from public,anon,authenticated;

create or replace function public.award_weekly_ranking(p_week date)
returns void as $$
declare v_player uuid; v_prize public.prizes; v_ticket uuid;
begin
 if p_week>=public.jst_week_start() or extract(isodow from p_week)<>1 then raise exception 'invalid_reward_week'; end if;
 perform pg_advisory_xact_lock(73421, p_week-date '2000-01-01');
 if exists(select 1 from public.weekly_prize_awards where week_start=p_week and channel='ranking') then return; end if;
 select wr.player_id into v_player from public.weekly_results wr join public.players p on p.id=wr.player_id
 where wr.week_start=p_week and wr.commit_points>0 and p.account_type='student'
 order by wr.commit_points desc,p.nickname asc,wr.player_id asc limit 1;
 if v_player is null then return; end if;
 select p.* into v_prize from public.prizes p where p.reward_channel='ranking' and public.available_prize_stock(p,p_week)>0 order by p.created_at,p.id limit 1 for update;
 if not found then return; end if;
 if not v_prize.weekly_refill then update public.prizes set stock=stock-1 where id=v_prize.id; end if;
 insert into public.prize_tickets(player_id,prize_id,won_at) values(v_player,v_prize.id,public.jst_now()) returning id into v_ticket;
 insert into public.weekly_prize_awards(week_start,channel,ticket_id,player_id) values(p_week,'ranking',v_ticket,v_player);
end; $$ language plpgsql security definer set search_path=public;
revoke all on function public.award_weekly_ranking(date) from public,anon,authenticated;


create or replace view public.ranking_learn_week as
with weekly_lp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    coalesce(sum(pt.amount), 0)::int as learn_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'learn'
    and pt.week_start = public.jst_week_start()
  where p.account_type='student'
  group by p.id, p.tier, p.nickname
)
select
  tier,
  nickname,
  learn_points,
  rank() over (partition by tier order by learn_points desc, nickname asc)::int as rank
from weekly_lp
order by tier asc, rank asc, nickname asc;

create or replace view public.ranking_commit_week as
with weekly_cp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    coalesce(sum(pt.amount), 0)::int as commit_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'commit'
    and pt.week_start = public.jst_week_start()
  where p.account_type='student'
  group by p.id, p.tier, p.nickname
)
select
  nickname,
  tier,
  commit_points,
  rank() over (order by commit_points desc, nickname asc)::int as rank
from weekly_cp
order by rank asc, nickname asc;

grant select on public.ranking_learn_week to anon, authenticated;
grant select on public.ranking_commit_week to anon, authenticated;




create or replace function public.close_week(p_week_start date default (public.jst_week_start() - interval '7 days')::date)
returns void as $$
declare
  v_player record;
  v_learn_pts int;
  v_commit_pts int;
  v_active boolean;
  v_tier_after smallint;
begin
  if p_week_start >= public.jst_week_start() or extract(isodow from p_week_start)<>1 then raise exception 'invalid_reward_week'; end if;
  perform pg_advisory_xact_lock(73422,p_week_start-date '2000-01-01');
  -- Idempotency check: if already closed for this week, do nothing
  if exists (select 1 from public.weekly_results where week_start = p_week_start) then
    perform public.award_weekly_ranking(p_week_start);
    return;
  end if;

  -- Compute ranks and promotions/demotions
  with weekly_stats as (
    select
      p.id as player_id,
      p.tier as current_tier,
      coalesce(sum(case when pt.kind = 'learn' then pt.amount else 0 end), 0)::int as learn_pts,
      coalesce(sum(case when pt.kind = 'commit' then pt.amount else 0 end), 0)::int as commit_pts,
      max(case when pt.kind = 'learn' then pt.created_at else null end) as last_learn_at,
      max(case when pt.kind = 'commit' then pt.created_at else null end) as last_commit_at,
      (count(pt.id) > 0) as is_active
    from public.players p
    left join public.points pt
      on pt.player_id = p.id
      and pt.week_start = p_week_start
    where p.account_type='student'
    group by p.id, p.tier
  ),
  ranked_stats as (
    select
      player_id,
      current_tier,
      learn_pts,
      commit_pts,
      last_learn_at,
      last_commit_at,
      is_active,
      row_number() over (
        partition by current_tier
        order by learn_pts desc, last_learn_at asc nulls last, player_id asc
      )::int as learn_rank_in_tier,
      row_number() over (
        order by commit_pts desc, last_commit_at asc nulls last, player_id asc
      )::int as commit_rank
    from weekly_stats
  ),
  decisions as (
    select
      player_id,
      current_tier,
      learn_pts,
      commit_pts,
      learn_rank_in_tier,
      commit_rank,
      is_active,
      case
        -- Promotion: Top 3 in tiers 1..4 with learn_points >= 1
        when current_tier < 5 and learn_pts >= 1 and learn_rank_in_tier <= 3 then
          (current_tier + 1)::smallint
        -- Demotion: Players who did not open the app (no points at all that week)
        when not is_active then
          greatest(1, current_tier - 1)::smallint
        -- Otherwise unchanged
        else
          current_tier
      end as tier_after
    from ranked_stats
  )
  -- Insert into weekly_results
  insert into public.weekly_results (
    week_start, player_id, tier_before, tier_after,
    learn_points, commit_points, learn_rank_in_tier, commit_rank, active
  )
  select
    p_week_start,
    player_id,
    current_tier,
    tier_after,
    learn_pts,
    commit_pts,
    learn_rank_in_tier,
    commit_rank,
    is_active
  from decisions;

  -- Apply tier changes to players table
  update public.players p
  set tier = wr.tier_after
  from public.weekly_results wr
  where wr.week_start = p_week_start
    and wr.player_id = p.id
    and p.tier <> wr.tier_after;

  perform public.award_weekly_ranking(p_week_start);
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.advance_grades()
returns void as $$
begin
  update public.players
  set grade = least(6, grade + 1) where account_type='student';
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.purge_inactive()
returns int as $$
declare
  v_count int;
  v_threshold timestamptz;
begin
  v_threshold := public.jst_now() - interval '180 days';

  with deleted as (
    delete from auth.users
    where id in (
      select id from public.players
      where account_type='student' and coalesce(last_active_at, created_at) < v_threshold
    )
    returning id
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$ language plpgsql security definer set search_path = public, auth;

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

  -- Serialize this player's balance and the shared weekly prize quota.
  perform 1 from public.players where id=v_uid for update;
  perform pg_advisory_xact_lock(73421,public.jst_week_start()-date '2000-01-01');
  -- 木の実を消費
  perform public.add_nuts(v_uid, -v_cost, 'gacha', p_count::text || '_' || gen_random_uuid()::text);

  v_prize_rate := greatest(0,least(1,public.setting_num('prize_rate', 0.01)));
  if exists(select 1 from public.players where id=v_uid and account_type='staff') then v_prize_rate:=0; end if;

  for i in 1..p_count loop
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
 'item_rates',jsonb_build_object('N',0.70,'R',0.22,'SR',0.07,'UR',0.01));
end; $$ language plpgsql stable security definer set search_path=public;

create or replace function public.staff_reward_overview() returns jsonb as $$
declare v_stats jsonb; v_rewards jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.staff where user_id=auth.uid()) then raise exception 'not_a_staff'; end if;
 select jsonb_build_object('students',count(*) filter(where account_type='student'),'staff',count(*) filter(where account_type='staff'),
 'weekly_active',count(*) filter(where account_type='student' and last_active_at >= (public.jst_week_start()::timestamp at time zone 'Asia/Tokyo'))) into v_stats from public.players;
 v_stats:=v_stats||jsonb_build_object('weekly_pulls',(select coalesce(sum(case when n.ref like '10_%' then 10 else 1 end),0) from public.nut_ledger n join public.players p on p.id=n.player_id where p.account_type='student' and n.reason='gacha' and n.day>=public.jst_week_start()),
 'gacha_issued',(select count(*) from public.weekly_prize_awards where week_start=public.jst_week_start() and channel='gacha'),
 'ranking_issued_last_week',(select count(*) from public.weekly_prize_awards where week_start=public.jst_week_start()-7 and channel='ranking'));
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'channel',p.reward_channel,'active',p.active,'remaining',public.available_prize_stock(p,public.jst_week_start())) order by p.reward_channel),'[]'::jsonb) into v_rewards from public.prizes p where p.weekly_refill;
 return jsonb_build_object('stats',v_stats,'rewards',v_rewards,'prize_rate',greatest(0,least(1,public.setting_num('prize_rate',0.01))),'week_start',public.jst_week_start());
end; $$ language plpgsql stable security definer set search_path=public;
revoke all on function public.staff_reward_overview() from public,anon,authenticated;
grant execute on function public.staff_reward_overview() to authenticated;



create or replace function public.weekly_reward_rules() returns jsonb as $$
 select jsonb_build_object('ranking',coalesce((select jsonb_build_object('name',name,'description',description) from public.prizes where reward_channel='ranking' and active and effective_week<=public.jst_week_start() order by created_at,id limit 1),'null'::jsonb), 'weekly_limit',1);
$$ language sql stable security definer set search_path=public;
revoke all on function public.weekly_reward_rules() from public,anon,authenticated;
grant execute on function public.weekly_reward_rules() to anon,authenticated;

-- CREATE OR REPLACE preserves existing privileges; assert the intended public surface.
revoke all on function public.close_week(date),public.advance_grades(),public.purge_inactive() from public,anon,authenticated;
revoke all on function public.pull_gacha(int),public.gacha_rates() from public,anon,authenticated;
grant execute on function public.pull_gacha(int) to authenticated;
grant execute on function public.gacha_rates() to anon,authenticated;
commit;
