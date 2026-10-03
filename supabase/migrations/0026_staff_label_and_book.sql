-- 0026: スタッフの表示名（「大学生スタッフ」など）と、本のすがた
-- 本人「Maria というユーザーは大学生スタッフというロールを付与して、本のスキンを付与してあげて」（2026-10-03）
--   - 大学生スタッフ = 表示だけ（本人の選択）。account_type は 'staff'（ランキングに印・景品と週間1位の賞から外れる）、
--     staff 表には入れない（スタッフ画面には入れない）。印の言葉は players.staff_label（空なら「スタッフ」）
--   - 本のすがた = 新しく作ってガチャにも出す（本人の選択）。スタッフのミアキス7種（0019）と同じ扱い
-- ランキングのビューは末尾に staff_label を足すだけ（既存の列の順は変えない。定義は 0013・0018 と同じ）
begin;

alter table public.players add column if not exists staff_label text check (staff_label is null or char_length(staff_label) between 1 and 12);

create or replace view public.ranking_learn_week as
with weekly_lp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    p.account_type,
    p.staff_label,
    coalesce(sum(pt.amount), 0)::int as learn_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'learn'
    and pt.week_start = public.jst_week_start()
  group by p.id, p.tier, p.nickname, p.account_type, p.staff_label
)
select
  tier,
  nickname,
  learn_points,
  rank() over (partition by tier order by learn_points desc, nickname asc)::int as rank,
  (account_type = 'staff') as is_staff,
  staff_label
from weekly_lp
order by tier asc, rank asc, nickname asc;

create or replace view public.ranking_commit_week as
with weekly_cp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    p.account_type,
    p.staff_label,
    coalesce(sum(pt.amount), 0)::int as commit_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'commit'
    and pt.week_start = public.jst_week_start()
  group by p.id, p.tier, p.nickname, p.account_type, p.staff_label
)
select
  nickname,
  tier,
  commit_points,
  rank() over (order by commit_points desc, nickname asc)::int as rank,
  (account_type = 'staff') as is_staff,
  staff_label
from weekly_cp
order by rank asc, nickname asc;

create or replace view public.ranking_knock_week as
with best as (
  select distinct on (r.player_id, r.band)
    r.player_id, r.band, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'knock'
    and r.status = 'finished'
    and r.end_reason = 'complete'
    and r.week_start = public.jst_week_start()
  order by r.player_id, r.band, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  b.band,
  p.nickname,
  p.tier,
  b.correct as best_correct,
  b.total_ms,
  rank() over (partition by b.band order by b.correct desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff,
  p.staff_label
from best b
join public.players p on p.id = b.player_id
order by band asc, rank asc, nickname asc;

create or replace view public.ranking_streak_week as
with best as (
  select distinct on (r.player_id, r.band)
    r.player_id, r.band, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.week_start = public.jst_week_start()
    and r.correct > 0
    and r.band is not null
  order by r.player_id, r.band, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.correct as best_streak,
  b.total_ms,
  rank() over (partition by b.band order by b.correct desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff,
  b.band,
  p.staff_label
from best b
join public.players p on p.id = b.player_id
order by band asc, rank asc, nickname asc;

create or replace view public.ranking_streak_all as
with best as (
  select distinct on (r.player_id, r.band)
    r.player_id, r.band, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.correct > 0
    and r.band is not null
  order by r.player_id, r.band, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.correct as best_streak,
  b.total_ms,
  rank() over (partition by b.band order by b.correct desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff,
  b.band,
  p.staff_label
from best b
join public.players p on p.id = b.player_id
order by band asc, rank asc, nickname asc;

-- 本のすがた（ガチャにも出す。スタッフのミアキス7種と同じ UR 相当）
insert into public.items (id, name, slot, rarity, display, active, source) values
  ('staff_book', '本を抱えたミアキス', 'form', 5, '{}'::jsonb, true, 'gacha')
on conflict (id) do nothing;

commit;
