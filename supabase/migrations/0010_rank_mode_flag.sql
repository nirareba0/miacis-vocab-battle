-- 0010_rank_mode_flag.sql: ランクモード（段の仕組み）の表示を切り替える旗（2026-10-01 本人）
-- 利用者が集まるまで、段の表示・段内順位・段ごとのランキングは画面に出さない。
-- 集計（tier・close_week・weekly_results）は止めない。解禁するときは
--   update public.app_settings set value = 'true' where key = 'rank_mode_enabled';
begin;

insert into public.app_settings (key, value) values ('rank_mode_enabled', 'false') on conflict (key) do nothing;

-- 端末が読んでよい旗だけを返す（設定表そのものは見せない）
create or replace function public.app_flags()
returns jsonb as $$
  select jsonb_build_object(
    'rank_mode_enabled', coalesce((select lower(trim(value)) in ('true', '1', 'on') from public.app_settings where key = 'rank_mode_enabled'), false)
  );
$$ language sql stable security definer set search_path = public;

revoke all on function public.app_flags() from public, anon, authenticated;
grant execute on function public.app_flags() to anon, authenticated;

commit;
