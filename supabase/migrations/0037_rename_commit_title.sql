-- 0037: 画面の言葉を「コミットポイント」→「毎日ポイント」にそろえたので、週間1位の称号も合わせる
-- （AIOS core/projects/miacis/DECIDE.md 2026-10-05「学習ポイント→正解ポイント／コミットポイント→毎日ポイント（称号名も）」）
-- id は変えない。持っている人の称号はそのまま名前だけ変わる
update public.items set name = '毎日王' where id = 'title_wk_commit' and name = 'コミット王';

-- 景品の説明に残る「館内で」も Miacis にそろえる（スタッフ画面で直した説明はそのまま。「館内で」を含むものだけ）
update public.prizes set description = replace(description, '館内でスタッフに', 'Miacis でスタッフに')
 where description like '%館内でスタッフに%';
