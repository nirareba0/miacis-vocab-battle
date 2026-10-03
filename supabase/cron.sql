-- supabase/cron.sql: pg_cron scheduled jobs (Production only, not run in test suite)
create extension if not exists pg_cron;

-- Note: pg_cron runs in UTC. All schedules below are converted from JST (UTC+9).

-- 1. Weekly closing & tier promotions/demotions, then weekly #1 titles (0022: close_week_all)
-- Schedule: Every Monday at 00:05 JST
-- UTC Conversion: Sunday 15:05 UTC (5 15 * * 0)
select cron.schedule(
  'close-week-job',
  '5 15 * * 0',
  $$select public.close_week_all((public.jst_week_start() - interval '7 days')::date);$$
);

-- 2. Purge graduating Grade 6 students
-- Schedule: March 31 at 23:30 JST
-- UTC Conversion: March 31 at 14:30 UTC (30 14 31 3 *)
select cron.schedule(
  'purge-graduates-job',
  '30 14 31 3 *',
  $$select public.purge_graduates();$$
);

-- 3. Advance grades for all active students (Grade + 1, capped at 6)
-- Schedule: April 1 at 00:10 JST
-- UTC Conversion: March 31 at 15:10 UTC (10 15 31 3 *)
select cron.schedule(
  'advance-grades-job',
  '10 15 31 3 *',
  $$select public.advance_grades();$$
);

-- 4. Purge inactive users (no activity for > 180 days)
-- Schedule: Daily at 04:00 JST
-- UTC Conversion: Daily at 19:00 UTC (0 19 * * *)
select cron.schedule(
  'purge-inactive-job',
  '0 19 * * *',
  $$select public.purge_inactive();$$
);

-- 毎日 JST 0:05（UTC 15:05）に呼び、JST の 1 日だけ前月の抽選券を抽選する
select cron.schedule(
  'draw-raffle-job',
  '5 15 * * *',
  $$select public.draw_monthly_raffle_if_due();$$
);
