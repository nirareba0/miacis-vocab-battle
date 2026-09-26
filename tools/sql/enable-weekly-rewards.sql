-- 0007_staff_weekly_rewards.sql 適用後に、運営が交換条件を確認して実行。
-- 枠はガチャ・ランキング各週1枚。一般の景品在庫とは独立して毎週復活。
begin;
update public.prizes set active=true
where id in ('77777777-0000-4000-8000-000000000001','77777777-0000-4000-8000-000000000002');
insert into public.app_settings(key,value) values('prize_rate','0.01')
on conflict(key) do update set value=excluded.value;
commit;
