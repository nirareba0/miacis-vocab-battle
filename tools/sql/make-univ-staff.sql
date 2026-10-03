-- 大学生スタッフにする（表示だけ。0026・2026-10-03 本人）。'ここにニックネーム' を書き換えて流す
--   ランキングの名前の後ろが「（大学生スタッフ）」になり、景品・週間1位の賞・月末抽選から外れる。ステージは全部開く
--   staff 表には入れないので、スタッフ画面には入れない（入れるなら make-staff.sql）
-- 例: npx --yes supabase@2.117.0 db query --linked -f tools/sql/make-univ-staff.sql
update public.players
   set account_type = 'staff', grade = null, staff_label = '大学生スタッフ'
 where nickname = 'ここにニックネーム';
