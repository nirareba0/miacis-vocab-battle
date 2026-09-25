-- ミアキスの合言葉を設定・変更する SQL
-- Supabase ダッシュボードの SQL Editor で実行してください。
-- 'ここに合言葉' を実際の合言葉に書き換えて実行します。

insert into public.app_settings (key, value)
values ('invite_code', 'ここに合言葉')
on conflict (key) do update
set value = excluded.value;
