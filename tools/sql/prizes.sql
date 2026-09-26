-- tools/sql/prizes.sql: 館の景品の登録・在庫変更・確率変更の見本 SQL
-- Supabase ダッシュボードの「SQL Editor」で実行して使います。

-- 1. 景品を新しく追加する
insert into public.prizes (id, name, description, stock, active)
values
  (gen_random_uuid(), 'ミアキス特製ステッカー', 'ホログラム仕様の限定ステッカー。館内カウンターで交換できます', 30, true),
  (gen_random_uuid(), 'オリジナルクリアファイル', 'A4サイズ・ミアキスイラスト入りクリアファイル', 20, true),
  (gen_random_uuid(), '学習応援シャープペン', 'グリップ付きで書きやすいオリジナルシャープペン', 10, true)
on conflict (id) do nothing;

-- 2. 特定の景品の在庫数を増減・変更する
-- 例: 「ミアキス特製ステッカー」の在庫を 50 に設定
update public.prizes
set stock = 50
where name = 'ミアキス特製ステッカー';

-- 例: 在庫を 5 個補充する（足し算）
update public.prizes
set stock = stock + 5
where name = 'オリジナルクリアファイル';

-- 3. 景品を一時的に非公開（ガチャから出ないように）する / 再公開する
update public.prizes
set active = false
where name = '学習応援シャープペン';

-- 再公開
update public.prizes
set active = true
where name = '学習応援シャープペン';

-- 4. 景品の当たる確率（prize_rate）を変更する
-- 既定値は 0.01（1%）
-- 例: イベント期間中、確率を 3%（0.03）に引き上げる
insert into public.app_settings (key, value)
values ('prize_rate', '0.03')
on conflict (key) do update set value = excluded.value;

-- 例: 確率を通常（1%）に戻す
insert into public.app_settings (key, value)
values ('prize_rate', '0.01')
on conflict (key) do update set value = excluded.value;

-- 5. 木の実の1日獲得上限（nuts_daily_cap）を変更する
-- 既定値は 300
-- 例: キャンペーンで 500 に引き上げる
insert into public.app_settings (key, value)
values ('nuts_daily_cap', '500')
on conflict (key) do update set value = excluded.value;

-- 6. ガチャのコストを変更する
-- 既定値: 1回 15 / 10連 150
-- update app_settings set value = '10' where key = 'pull_cost';
-- update app_settings set value = '100' where key = 'pull10_cost';

-- 7. 現在の景品一覧と在庫状況の確認
select id, name, description, stock, active, created_at
from public.prizes
order by created_at desc;

-- 8. 当選チケット（引換券）の状況確認
select
  t.id as ticket_id,
  p.nickname,
  pr.name as prize_name,
  t.won_at,
  t.redeemed_at,
  t.redeemed_by
from public.prize_tickets t
join public.players p on p.id = t.player_id
join public.prizes pr on pr.id = t.prize_id
order by t.won_at desc;
