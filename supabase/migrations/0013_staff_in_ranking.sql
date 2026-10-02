-- 0013_staff_in_ranking.sql: スタッフもランキングに出す（「（スタッフ）」と表示）（2026-10-02 本人）
-- 景品・週間1位の券・月末抽選は今までどおり生徒だけ（award_weekly_ranking / close_week / draw_monthly_raffle は
-- weekly_results・players.account_type で生徒に絞っていて、この表示用のビューは使っていない）。
-- 各ビューの末尾に is_staff を足す（既存の列の順は変えない）。
begin;

create or replace view public.ranking_learn_week as
with weekly_lp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    p.account_type,
    coalesce(sum(pt.amount), 0)::int as learn_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'learn'
    and pt.week_start = public.jst_week_start()
  group by p.id, p.tier, p.nickname, p.account_type
)
select
  tier,
  nickname,
  learn_points,
  rank() over (partition by tier order by learn_points desc, nickname asc)::int as rank,
  (account_type = 'staff') as is_staff
from weekly_lp
order by tier asc, rank asc, nickname asc;

create or replace view public.ranking_commit_week as
with weekly_cp as (
  select
    p.id as player_id,
    p.tier,
    p.nickname,
    p.account_type,
    coalesce(sum(pt.amount), 0)::int as commit_points
  from public.players p
  left join public.points pt
    on pt.player_id = p.id
    and pt.kind = 'commit'
    and pt.week_start = public.jst_week_start()
  group by p.id, p.tier, p.nickname, p.account_type
)
select
  nickname,
  tier,
  commit_points,
  rank() over (order by commit_points desc, nickname asc)::int as rank,
  (account_type = 'staff') as is_staff
from weekly_cp
order by rank asc, nickname asc;

create or replace view public.ranking_streak_week as
with best as (
  select distinct on (r.player_id)
    r.player_id, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.week_start = public.jst_week_start()
    and r.correct > 0
  order by r.player_id, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.correct as best_streak,
  b.total_ms,
  rank() over (order by b.correct desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff
from best b
join public.players p on p.id = b.player_id
order by rank asc, nickname asc;

create or replace view public.ranking_streak_all as
with best as (
  select distinct on (r.player_id)
    r.player_id, r.correct, r.total_ms, r.finished_at
  from public.runs r
  where r.mode = 'streak'
    and r.status = 'finished'
    and r.correct > 0
  order by r.player_id, r.correct desc, r.total_ms asc, r.finished_at asc
)
select
  p.nickname,
  p.tier,
  b.correct as best_streak,
  b.total_ms,
  rank() over (order by b.correct desc, b.total_ms asc)::int as rank,
  (p.account_type = 'staff') as is_staff
from best b
join public.players p on p.id = b.player_id
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
  (p.account_type = 'staff') as is_staff
from best b
join public.players p on p.id = b.player_id
order by band asc, rank asc, nickname asc;

create or replace function public.run_finish(p_run_id uuid, p_reason text)
returns jsonb as $$
declare
  v_run public.runs;
  v_learn int := 0;
  v_nuts_raw int := 0;
  v_nuts int := 0;
  v_commit int := 0;
  v_prev_best jsonb;
  v_prev_week_best jsonb;
  v_rank int;
  v_rival jsonb;
  v_me jsonb;
  v_is_student boolean;
  v_new_titles jsonb := '[]'::jsonb;
  v_t record;
begin
  select * into v_run from public.runs where id = p_run_id;

  if v_run.status = 'finished' then
    return public.run_result(v_run.id);
  end if;

  v_prev_best := public.run_best(v_run.player_id, v_run.mode, null);
  v_prev_week_best := public.run_best(v_run.player_id, v_run.mode, v_run.week_start);

  -- 学習ポイントは対戦と同じく「正解1問 = 1点」
  v_learn := v_run.correct;

  -- 木の実: 素点（nut_score。後半の正解・ギリギリの正解ほど高い）÷ 25。100本ノックは完走 +5、90問以上 +3
  v_nuts_raw := v_run.nut_score / public.setting_num('nut_score_per_nut', 25)::int;
  if v_run.mode = 'knock' then
    v_nuts_raw := v_nuts_raw
      + (case when p_reason = 'complete' then public.setting_num('knock_nuts_complete', 5)::int else 0 end)
      + (case when p_reason = 'complete' and v_run.correct >= 90 then public.setting_num('knock_nuts_90', 3)::int else 0 end);
  end if;

  if v_learn > 0 then
    insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
    values (v_run.player_id, 'learn', v_run.mode, v_learn, v_run.week_start, public.jst_today(), public.jst_now());
  end if;

  if v_run.answered > 0 then
    v_commit := public.add_commit(v_run.player_id, v_run.mode, 1);
  end if;

  v_nuts_raw := public.scale_nuts(v_nuts_raw);

  if v_nuts_raw > 0 then
    v_nuts := public.add_nuts(v_run.player_id, v_nuts_raw, v_run.mode, v_run.id::text);
  end if;

  update public.runs
  set status = 'finished',
      end_reason = p_reason,
      current = null,
      learn_points = v_learn,
      nuts = v_nuts,
      finished_at = public.jst_now()
  where id = v_run.id;

  -- 称号（条件達成で入手。ガチャには出ない）。1位以外にも光を当てる（桜井「ゲームに与える賞」）
  for v_t in
    select it.id, it.name from public.items it
    where it.source = 'achievement'
      and (
        (it.id = 'title_streak10' and v_run.mode = 'streak' and v_run.correct >= 10)
        or (it.id = 'title_streak20' and v_run.mode = 'streak' and v_run.correct >= 20)
        or (it.id = 'title_stage5' and v_run.mode = 'streak' and v_run.correct >= 20)
        or (it.id = 'title_comeback' and v_run.mode = 'streak' and v_run.revive_used and v_run.correct >= 10)
        or (it.id = 'title_knock_done' and v_run.mode = 'knock' and p_reason = 'complete')
        or (it.id = 'title_knock_oni' and v_run.mode = 'knock' and p_reason = 'complete' and v_run.correct >= 90)
      )
      and not exists (select 1 from public.player_items pi where pi.player_id = v_run.player_id and pi.item_id = it.id)
  loop
    insert into public.player_items (player_id, item_id, count, first_at)
    values (v_run.player_id, v_t.id, 1, public.jst_now())
    on conflict do nothing;
    v_new_titles := v_new_titles || jsonb_build_array(jsonb_build_object('id', v_t.id, 'name', v_t.name));
  end loop;

  -- 今週の順位と、すぐ上の相手（「あと何問で抜ける」を画面に出す）。記録になる回だけ
  -- スタッフもランキングに出る（2026-10-02）。順位と相手はスタッフにも返す
  if v_run.mode = 'streak' or p_reason = 'complete' then
    v_me := public.run_best(v_run.player_id, v_run.mode, v_run.week_start);
    if v_run.mode = 'streak' then
      select r.rank into v_rank from public.ranking_streak_week r
        join public.players p on p.nickname = r.nickname where p.id = v_run.player_id;
      select jsonb_build_object('nickname', r.nickname, 'correct', r.best_streak, 'rank', r.rank, 'is_staff', r.is_staff) into v_rival
        from public.ranking_streak_week r
        where r.rank < coalesce(v_rank, 999999)
        order by r.rank desc limit 1;
    else
      select r.rank into v_rank from public.ranking_knock_week r
        join public.players p on p.nickname = r.nickname where p.id = v_run.player_id and r.band = v_run.band;
      select jsonb_build_object('nickname', r.nickname, 'correct', r.best_correct, 'rank', r.rank, 'is_staff', r.is_staff) into v_rival
        from public.ranking_knock_week r
        where r.band = v_run.band and r.rank < coalesce(v_rank, 999999)
        order by r.rank desc limit 1;
    end if;
  end if;

  return public.run_result(v_run.id)
    || jsonb_build_object(
      'commit_points', v_commit,
      'nuts_raw', v_nuts_raw,
      'week_rank', v_rank,
      'rival', v_rival,
      'new_titles', v_new_titles,
      'new_best', (v_run.mode = 'streak' or p_reason = 'complete')
        and v_run.correct > 0
        and (v_prev_best is null or v_run.correct > (v_prev_best->>'correct')::int
             or (v_run.correct = (v_prev_best->>'correct')::int and v_run.total_ms < (v_prev_best->>'total_ms')::int)),
      'new_week_best', (v_run.mode = 'streak' or p_reason = 'complete')
        and v_run.correct > 0
        and (v_prev_week_best is null or v_run.correct > (v_prev_week_best->>'correct')::int
             or (v_run.correct = (v_prev_week_best->>'correct')::int and v_run.total_ms < (v_prev_week_best->>'total_ms')::int))
    );
end;
$$ language plpgsql security definer set search_path = public;

grant select on public.ranking_learn_week, public.ranking_commit_week,
  public.ranking_streak_week, public.ranking_streak_all, public.ranking_knock_week to anon, authenticated;
revoke all on function public.run_finish(uuid, text) from public, anon, authenticated;

commit;
