-- 0025: サバイバルの次のステージは、ひとつ前のステージで 20 連続で開く（30 → 20）
-- 本人「次のステージ開放は20問とかクリアに設定しよう」（2026-10-03）。
-- 値はスタッフ画面「設定」の stage_unlock_correct でも変えられる。ここでは既定と本番の値を 20 にそろえる
begin;

insert into public.app_settings (key, value) values ('stage_unlock_correct', '20')
on conflict (key) do update set value = excluded.value;

-- 設定が無いときの既定も 20 に（0018 の定義と同じ。数字だけ変える）
create or replace function public.stage_unlocked(p_player_id uuid, p_band int)
returns boolean as $$
  select p_band <= 1
    or exists (select 1 from public.players where id = p_player_id and account_type = 'staff')
    or coalesce((select max(correct) from public.runs
                 where player_id = p_player_id and mode = 'streak' and status = 'finished' and band = p_band - 1), 0)
       >= public.setting_num('stage_unlock_correct', 20)::int;
$$ language sql stable security definer set search_path = public;

revoke all on function public.stage_unlocked(uuid, int) from public, anon, authenticated;

commit;
