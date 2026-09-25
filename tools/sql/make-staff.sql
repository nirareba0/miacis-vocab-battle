-- スタッフと「今週の英語」係を決める。Supabase ダッシュボード → SQL Editor に貼って Run。
-- 先にアプリでふつうに登録しておき、そのニックネームを下の 'ここにニックネーム' に入れる。

-- スタッフにする（未承認の今週の英語の確認・一言へのスタンプができる）
insert into public.staff (user_id)
select id from public.players where nickname = 'ここにニックネーム'
on conflict do nothing;

-- 「今週の英語」係にする（受験生の試用メンバー）。外すときは true を false に
update public.players set is_picker = true where nickname = 'ここにニックネーム';
