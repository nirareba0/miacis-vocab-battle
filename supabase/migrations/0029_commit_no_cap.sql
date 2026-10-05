-- 0029: コミットポイントの1日の上限（10）をなくす（2026-10-05 本人「コミットの上限を撤廃しよう」）
-- 0002 の add_commit から上限の切り詰めだけを外す。開く（touch_today）が1日1回なのは別の決まりで、そのまま
create or replace function public.add_commit(p_player_id uuid, p_reason text, p_amount int)
returns int as $$
begin
  if p_amount <= 0 then
    return 0;
  end if;

  insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
  values (p_player_id, 'commit', p_reason, p_amount, public.jst_week_start(), public.jst_today(), public.jst_now());

  return p_amount;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.add_commit(uuid, text, int) from public, anon, authenticated;
