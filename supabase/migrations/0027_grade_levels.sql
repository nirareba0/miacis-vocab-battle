-- 0027: 登録した学年のレベルまでは最初から開く。それより上は今までどおりひとつ前で 20 連続（0025）
-- 本人「選んだ学年に応じてどのレベルも選べるようにしていいかも」→「自分の学年まで」（2026-10-03）
--   中1 → 中1レベル（band 1）／中2・中3 → 中学レベル（2）まで／高1・高2 → 高校レベル（3）まで／高3 → 受験レベル（4）まで。最難関（5）は全員 20 連続で
-- あわせて、週間1位の称号の名前から「A1」などの記号をやめて学年の言い方に（本人「A1とかわかりにくい」）
begin;

create or replace function public.grade_open_band(p_grade int)
returns int as $$
  select case
    when p_grade is null or p_grade <= 1 then 1
    when p_grade <= 3 then 2
    when p_grade <= 5 then 3
    else 4
  end;
$$ language sql immutable;

create or replace function public.stage_unlocked(p_player_id uuid, p_band int)
returns boolean as $$
  select p_band <= 1
    or exists (select 1 from public.players where id = p_player_id and account_type = 'staff')
    or p_band <= coalesce((select public.grade_open_band(grade) from public.players where id = p_player_id), 1)
    or coalesce((select max(correct) from public.runs
                 where player_id = p_player_id and mode = 'streak' and status = 'finished' and band = p_band - 1), 0)
       >= public.setting_num('stage_unlock_correct', 20)::int;
$$ language sql stable security definer set search_path = public;

revoke all on function public.stage_unlocked(uuid, int), public.grade_open_band(int) from public, anon, authenticated;

update public.items set name = regexp_replace(name, ' A1$', ' 中1レベル') where slot = 'title' and name ~ ' A1$';
update public.items set name = regexp_replace(name, ' A2$', ' 中学レベル') where slot = 'title' and name ~ ' A2$';
update public.items set name = regexp_replace(name, ' B1$', ' 高校レベル') where slot = 'title' and name ~ ' B1$';
update public.items set name = regexp_replace(name, ' B2$', ' 受験レベル') where slot = 'title' and name ~ ' B2$';

commit;
