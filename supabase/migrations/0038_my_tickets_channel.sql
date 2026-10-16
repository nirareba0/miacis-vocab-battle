-- 0038: 自分の引換券に「どの賞か」（reward_channel: gacha / ranking / raffle）を足す。
-- ホームで「先週 毎日ポイント 1位！」の知らせを出すため（web/js/logic.js weeklyCouponToShow）。
-- 中身は 0006 の my_tickets に1列足しただけ。create or replace なので権限（authenticated の execute）はそのまま
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
      'reward_channel', pr.reward_channel,
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
