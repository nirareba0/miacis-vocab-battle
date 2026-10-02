-- 0012_streak_fixed_time.sql: 連続チャレンジの制限時間をステージで縮めない（7秒固定）（2026-10-02 本人）
-- 理由: 難度は出題範囲だけで十分上がる。時間を縮めると「単語を知っているか」より「読む速さ」の勝負になり、
-- 中1〜高3が同じコースで競うときに下の学年が不利になる。戻すときはスタッフ画面「設定」で streak_step_ms を 400 に。
begin;
insert into public.app_settings (key, value) values ('streak_step_ms', '0')
on conflict (key) do update set value = excluded.value;
commit;
