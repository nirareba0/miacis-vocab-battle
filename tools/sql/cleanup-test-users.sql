-- 公開前の確認で Claude が作ったテスト用アカウントを消す（2026-09-25 に作った6つ）。
-- Supabase ダッシュボード → SQL Editor に貼って Run。関連する対戦・ポイントも一緒に消える。
-- 先に下の select だけ実行して、消える相手を目で確かめてから delete を実行する。
select nickname, created_at from public.players
where nickname ~ '^テスト[0-9]{3}$' or nickname = '<b>x</b>';

-- delete from auth.users where id in (
--   select id from public.players where nickname ~ '^テスト[0-9]{3}$' or nickname = '<b>x</b>'
-- );
