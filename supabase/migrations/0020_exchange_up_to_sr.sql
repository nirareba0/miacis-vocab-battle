-- 0020_exchange_up_to_sr.sql（2026-10-03 本人「かけらで交換できるものはスーパーレアまでにする」）
-- UR は「ガチャでしか出ない」ものにして、引く理由を残す。すがた（特殊スキン）も交換の対象から外す
begin;

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

  -- 0020: かけらで交換できるのはガチャの品の SR まで（UR・SECRET・すがた・条件達成の称号は交換できない）
  select * into v_item
  from public.items
  where id = p_item_id and active = true and source = 'gacha' and rarity <= 3 and slot <> 'form';

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

revoke all on function public.exchange_item(text) from public, anon, authenticated;
grant execute on function public.exchange_item(text) to authenticated;

commit;
