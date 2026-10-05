-- 0028: 登録の前に中1レベルのサバイバルを1回まるごと遊べる・その記録で登録する・いま何人挑戦中・抜かれたら知らせる
-- （2026-10-05 本人「登録の前に中1レベルを一回挑戦してみて、その記録を登録しよ？という方式で」
--   「何度も挑戦していいことや、現在何人挑戦中とか、順位を抜かれたら通知がいくように」）
--
-- ゲストの回は runs に入れない（runs.player_id は players を指す。ランキング・図鑑・称号はすべて runs を見る）。
-- 別の表 guest_runs でサーバーが出題・採点し、登録した人が claim_guest_run を呼んだときに runs へ移して
-- run_finish を通す（学習ポイント・Miコイン・称号・順位は登録した人のふつうの1回と同じになる）。
-- 端末に渡すのは token だけ（推測できない uuid）。正解は答えを送るまで端末に渡さない（run_client_question）。

create table public.guest_runs (
  token uuid primary key default gen_random_uuid(),
  band smallint not null default 1 check (band = 1),          -- 登録前に遊べるのは中1レベルだけ
  status text not null default 'active' check (status in ('active', 'revive_offer', 'finished')),
  answered int not null default 0,
  correct int not null default 0,
  total_ms int not null default 0,
  nut_score int not null default 0,
  revive_used boolean not null default false,
  current jsonb,                                              -- 出題中の問題（answer_index つき。端末には出さない）
  used_word_ids int[] not null default '{}',
  correct_word_ids int[] not null default '{}',
  missed jsonb not null default '[]'::jsonb,
  end_reason text check (end_reason is null or end_reason in ('wrong', 'timeout', 'complete', 'quit')),
  started_at timestamptz not null,
  finished_at timestamptz,
  claimed_by uuid references public.players(id) on delete set null,
  claimed_at timestamptz,
  claimed_run_id uuid
);

create index idx_guest_runs_started on public.guest_runs(started_at);

alter table public.guest_runs enable row level security;
-- 行は関数経由だけ（current に正解が入っているため、GRANT しない）

-- ゲストの回を、出題の関数（run_make_question）が読める runs の形にする（表には入れない。player_id は null）
create or replace function public.guest_as_run(p_g public.guest_runs)
returns public.runs as $$
declare
  v_run public.runs;
begin
  v_run.id := p_g.token;
  v_run.player_id := null;
  v_run.mode := 'streak';
  v_run.band := p_g.band;
  v_run.status := 'active';
  v_run.answered := p_g.answered;
  v_run.correct := p_g.correct;
  v_run.total_ms := p_g.total_ms;
  v_run.revive_used := p_g.revive_used;
  v_run.used_word_ids := p_g.used_word_ids;
  v_run.correct_word_ids := p_g.correct_word_ids;
  v_run.missed := p_g.missed;
  v_run.nut_score := p_g.nut_score;
  v_run.start_stage := 1;
  v_run.shields := 0;
  v_run.fifties := 0;
  v_run.skips := 0;
  v_run.time_bonus_ms := 0;
  v_run.coin_mult := 1;
  v_run.cards := '[]'::jsonb;
  v_run.started_at := p_g.started_at;
  v_run.week_start := public.jst_week_start();
  return v_run;
end;
$$ language plpgsql stable security definer set search_path = public;

-- この記録で登録したら、今週の中1レベルで何位か と すぐ上の人（「あと◯問で抜ける」）
create or replace function public.guest_rank_of(p_band int, p_correct int, p_total_ms int)
returns jsonb as $$
declare
  v_rank int;
  v_rival jsonb;
begin
  if coalesce(p_correct, 0) <= 0 then
    return jsonb_build_object('would_rank', null, 'rival', null);
  end if;
  select count(*)::int + 1 into v_rank
  from public.ranking_streak_week r
  where r.band = p_band
    and (r.best_streak > p_correct or (r.best_streak = p_correct and r.total_ms < p_total_ms));
  select jsonb_build_object('nickname', r.nickname, 'correct', r.best_streak, 'rank', r.rank, 'is_staff', r.is_staff, 'staff_label', r.staff_label)
    into v_rival
  from public.ranking_streak_week r
  where r.band = p_band
    and (r.best_streak > p_correct or (r.best_streak = p_correct and r.total_ms < p_total_ms))
  order by r.best_streak asc, r.total_ms desc
  limit 1;
  return jsonb_build_object('would_rank', v_rank, 'rival', v_rival);
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function public.guest_run_result(p_token uuid)
returns jsonb as $$
  select jsonb_build_object(
    'guest', true,
    'mode', 'streak',
    'band', g.band,
    'status', g.status,
    'end_reason', g.end_reason,
    'answered', g.answered,
    'correct', g.correct,
    'total_ms', g.total_ms,
    'revive_used', g.revive_used,
    'missed', g.missed,
    'learn_points', 0,
    'nuts', 0
  ) || public.guest_rank_of(g.band, g.correct, g.total_ms)
  from public.guest_runs g where g.token = p_token;
$$ language sql stable security definer set search_path = public;

create or replace function public.guest_run_finish(p_token uuid, p_reason text)
returns jsonb as $$
begin
  update public.guest_runs
  set status = 'finished',
      end_reason = p_reason,
      current = null,
      finished_at = public.jst_now()
  where token = p_token and status <> 'finished';
  return public.guest_run_result(p_token);
end;
$$ language plpgsql security definer set search_path = public;

-- いま何人挑戦中か（登録前の画面に出す。人数だけ。だれかは出さない）
--   playing_now: この10分に始めて、まだ終わっていない回の数（登録前の挑戦も入れる）
--   week_players: 今週、中1レベルのサバイバルを遊んだ人（登録している人）の数
create or replace function public.challenge_now()
returns jsonb as $$
  select jsonb_build_object(
    'playing_now',
      (select count(distinct r.player_id) from public.runs r
        where r.status <> 'finished' and r.started_at > public.jst_now() - interval '10 minutes')
      + (select count(*) from public.guest_runs g
        where g.status <> 'finished' and g.started_at > public.jst_now() - interval '10 minutes'),
    'week_players',
      (select count(distinct r.player_id) from public.runs r
        where r.mode = 'streak' and r.band = 1 and r.answered > 0 and r.week_start = public.jst_week_start())
  );
$$ language sql stable security definer set search_path = public;

create or replace function public.start_guest_run()
returns jsonb as $$
declare
  v_g public.guest_runs;
  v_q jsonb;
begin
  -- 登録されなかった回は1日で消す（長く持たない）
  delete from public.guest_runs
  where started_at < public.jst_now() - interval '1 day';

  -- 連打で表が膨らまないように（館の人数なら届かない数）
  if (select count(*) from public.guest_runs where started_at > public.jst_now() - interval '10 minutes')
       >= public.setting_num('guest_runs_per_10min', 300)::int then
    raise exception 'guest_busy';
  end if;

  insert into public.guest_runs (band, started_at)
  values (1, public.jst_now())
  returning * into v_g;

  v_q := public.run_make_question(public.guest_as_run(v_g));
  update public.guest_runs set current = v_q where token = v_g.token;

  return jsonb_build_object(
    'token', v_g.token,
    'mode', 'streak',
    'band', v_g.band,
    'depth', 0,
    'inventory', jsonb_build_object('shields', 0, 'fifties', 0, 'skips', 0, 'time_bonus_ms', 0, 'coin_mult', 1, 'cards', '[]'::jsonb),
    'question', public.run_client_question(v_q)
  );
end;
$$ language plpgsql security definer set search_path = public;

-- 採点は answer_run（0018）と同じ。カード・たて・50:50 は無い（0018 で止めたまま）。❤️ 復活は1回
create or replace function public.answer_guest_run(p_token uuid, p_choice int, p_ms int)
returns jsonb as $$
declare
  v_g public.guest_runs;
  v_q jsonb;
  v_limit int;
  v_elapsed int;
  v_ms int;
  v_timeout boolean;
  v_correct boolean;
  v_answer_idx int;
  v_next jsonb;
  v_state text;
  v_result jsonb;
begin
  select * into v_g from public.guest_runs where token = p_token for update;
  if not found then
    raise exception 'run_not_found';
  end if;
  if v_g.status <> 'active' or v_g.current is null then
    raise exception 'run_not_active';
  end if;

  v_q := v_g.current;
  v_limit := (v_q->>'limit_ms')::int;
  v_answer_idx := (v_q->>'answer_index')::int;
  v_elapsed := (extract(epoch from (public.jst_now() - (v_q->>'issued_at')::timestamptz)) * 1000)::int;

  v_ms := greatest(0, least(v_limit, coalesce(p_ms, v_limit)));
  v_ms := greatest(v_ms, least(v_limit, v_elapsed - public.setting_num('run_grace_ms', 2500)::int));

  v_timeout := p_choice is null
    or p_ms is null
    or p_ms >= v_limit
    or v_elapsed > v_limit + public.setting_num('run_grace_ms', 2500)::int;
  v_correct := not v_timeout and p_choice = v_answer_idx;

  if v_correct then
    v_g.correct := v_g.correct + 1;
    v_g.total_ms := v_g.total_ms + v_ms;
    v_g.correct_word_ids := array_append(v_g.correct_word_ids, (v_q->>'word_id')::int);
    v_g.nut_score := v_g.nut_score
      + 10
      + 3 * (coalesce((v_q->>'stage')::int, 1) - 1)
      + (case when v_ms >= v_limit * 0.7 then 5 else 0 end);
  else
    v_g.missed := v_g.missed || jsonb_build_array(jsonb_build_object(
      'word_id', v_q->'word_id',
      'prompt', v_q->'prompt',
      'correct_text', v_q->'choices'->v_answer_idx,
      'your_text', case when v_timeout then null else v_q->'choices'->p_choice end,
      'timeout', v_timeout
    ));
  end if;
  v_g.answered := v_g.answered + 1;
  v_g.used_word_ids := array_append(v_g.used_word_ids, (v_q->>'word_id')::int);

  if v_correct then
    v_state := 'next';
  elsif v_timeout and not v_g.revive_used then
    v_state := 'revive_offer';
  else
    v_state := 'finished';
  end if;

  if v_state = 'next' then
    v_next := public.run_make_question(public.guest_as_run(v_g));
    if v_next is null then
      v_state := 'finished';   -- 中1レベルの単語を出し切った → コンプリート
    end if;
  end if;

  update public.guest_runs
  set correct = v_g.correct,
      total_ms = v_g.total_ms,
      answered = v_g.answered,
      used_word_ids = v_g.used_word_ids,
      correct_word_ids = v_g.correct_word_ids,
      nut_score = v_g.nut_score,
      missed = v_g.missed,
      status = case when v_state = 'revive_offer' then 'revive_offer' else status end,
      current = case when v_state = 'next' then v_next
                     when v_state = 'revive_offer' then current || jsonb_build_object('offered_at', public.jst_now())
                     else current end
  where token = v_g.token;

  if v_state = 'finished' then
    v_result := public.guest_run_finish(v_g.token,
      case when v_correct then 'complete' when v_timeout then 'timeout' else 'wrong' end);
  end if;

  return jsonb_build_object(
    'correct', v_correct,
    'timeout', v_timeout,
    'answer_index', v_answer_idx,
    'state', v_state,
    'answered', v_g.answered,
    'score', v_g.correct,
    'revive_used', v_g.revive_used,
    'depth', v_g.correct,
    'shield_used', false,
    'inventory', jsonb_build_object('shields', 0, 'fifties', 0, 'skips', 0, 'time_bonus_ms', 0, 'coin_mult', 1, 'cards', '[]'::jsonb),
    'offer', null,
    'question', public.run_client_question(v_next),
    'result', v_result
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.revive_guest_run(p_token uuid)
returns jsonb as $$
declare
  v_g public.guest_runs;
  v_q jsonb;
begin
  select * into v_g from public.guest_runs where token = p_token for update;
  if not found then
    raise exception 'run_not_found';
  end if;
  if v_g.status <> 'revive_offer' or v_g.revive_used then
    raise exception 'revive_not_available';
  end if;

  if public.jst_now() - (v_g.current->>'offered_at')::timestamptz > interval '10 seconds' then
    return jsonb_build_object('state', 'finished', 'result', public.guest_run_finish(v_g.token, 'timeout'));
  end if;

  -- 時間切れの1問は「数えない」（revive_run と同じ）
  v_g.answered := v_g.answered - 1;
  v_g.revive_used := true;
  v_q := public.run_make_question(public.guest_as_run(v_g));

  update public.guest_runs
  set status = 'active',
      revive_used = true,
      answered = v_g.answered,
      current = v_q
  where token = v_g.token;

  return jsonb_build_object(
    'state', 'next',
    'revive_used', true,
    'score', v_g.correct,
    'question', public.run_client_question(v_q)
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.end_guest_run(p_token uuid)
returns jsonb as $$
declare
  v_g public.guest_runs;
begin
  select * into v_g from public.guest_runs where token = p_token for update;
  if not found then
    raise exception 'run_not_found';
  end if;
  if v_g.status = 'finished' then
    return public.guest_run_result(v_g.token);
  end if;
  -- 復活を選ばずに終えた → 時間切れで終わり（end_run と同じ）
  return public.guest_run_finish(v_g.token, case when v_g.status = 'revive_offer' then 'timeout' else 'quit' end);
end;
$$ language plpgsql security definer set search_path = public;

-- 登録した人が、登録前の記録を自分の1回にする。runs に入れて run_finish を通す（ポイント・Miコイン・称号・順位はふつうの1回と同じ）
-- 週はいまの週に入れる（登録した週の記録として出す）。1日たった回・終わっていない回・登録済みの回は受け付けない
create or replace function public.claim_guest_run(p_token uuid)
returns jsonb as $$
declare
  v_uid uuid;
  v_g public.guest_runs;
  v_run_id uuid;
  v_result jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.players where id = v_uid) then
    raise exception 'player_not_found';
  end if;

  select * into v_g from public.guest_runs where token = p_token for update;
  if not found then
    raise exception 'run_not_found';
  end if;
  if v_g.claimed_by is not null then
    raise exception 'already_claimed';
  end if;
  if v_g.status <> 'finished' or v_g.answered <= 0 then
    raise exception 'run_not_finished';
  end if;
  if v_g.finished_at < public.jst_now() - interval '1 day' then
    raise exception 'run_expired';
  end if;

  insert into public.runs (player_id, mode, band, start_stage, status, answered, correct, total_ms, revive_used,
                           used_word_ids, correct_word_ids, missed, nut_score, started_at, week_start)
  values (v_uid, 'streak', v_g.band, 1, 'active', v_g.answered, v_g.correct, v_g.total_ms, v_g.revive_used,
          v_g.used_word_ids, v_g.correct_word_ids, v_g.missed, v_g.nut_score, v_g.started_at, public.jst_week_start())
  returning id into v_run_id;

  v_result := public.run_finish(v_run_id, v_g.end_reason);

  update public.guest_runs
  set claimed_by = v_uid, claimed_at = public.jst_now(), claimed_run_id = v_run_id, current = null
  where token = v_g.token;

  return v_result;
end;
$$ language plpgsql security definer set search_path = public;

-- 抜かれたら知らせる（アプリの中。ホームに出す）
-- 今週、自分の記録がある中1〜最難関のそれぞれで: いまの順位 と、自分が記録を出したあとで上に来た人
--   「上に来た」= いま自分より上にいて、自分の記録が出た時点ではまだ自分より上の記録を持っていなかった人
create or replace function public.my_rank_watch()
returns jsonb as $$
declare
  v_uid uuid;
  v_week date := public.jst_week_start();
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  return coalesce((
    with mine as (
      select distinct on (r.band) r.band, r.correct, r.total_ms, r.finished_at
      from public.runs r
      where r.player_id = v_uid and r.mode = 'streak' and r.status = 'finished'
        and r.week_start = v_week and r.correct > 0 and r.band is not null
      order by r.band, r.correct desc, r.total_ms asc, r.finished_at asc
    ),
    others as (
      select distinct on (r.player_id, r.band) r.player_id, r.band, r.correct, r.total_ms, r.finished_at
      from public.runs r
      where r.player_id <> v_uid and r.mode = 'streak' and r.status = 'finished'
        and r.week_start = v_week and r.correct > 0 and r.band is not null
      order by r.player_id, r.band, r.correct desc, r.total_ms asc, r.finished_at asc
    )
    select jsonb_agg(jsonb_build_object(
      'band', m.band,
      'best_streak', m.correct,
      'my_at', m.finished_at,
      'rank', 1 + (select count(*) from others o where o.band = m.band
                    and (o.correct > m.correct or (o.correct = m.correct and o.total_ms < m.total_ms))),
      'passed_by', coalesce((
        select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'best_streak', o.correct, 'is_staff', p.account_type = 'staff',
                                            'staff_label', p.staff_label, 'at', o.finished_at) order by o.finished_at desc)
        from others o join public.players p on p.id = o.player_id
        where o.band = m.band
          and (o.correct > m.correct or (o.correct = m.correct and o.total_ms < m.total_ms))
          and o.finished_at > m.finished_at
          and not exists (
            select 1 from public.runs e
            where e.player_id = o.player_id and e.mode = 'streak' and e.status = 'finished'
              and e.week_start = v_week and e.band = m.band and e.finished_at <= m.finished_at
              and (e.correct > m.correct or (e.correct = m.correct and e.total_ms < m.total_ms))
          )
      ), '[]'::jsonb)
    ) order by m.band)
    from mine m
  ), '[]'::jsonb);
end;
$$ language plpgsql stable security definer set search_path = public;

-- 権限: 全部取り消してから要るものだけ（0003 と同じ形）
revoke all on public.guest_runs from public, anon, authenticated;
revoke all on function public.guest_as_run(public.guest_runs), public.guest_rank_of(int, int, int),
  public.guest_run_result(uuid), public.guest_run_finish(uuid, text)
  from public, anon, authenticated;
revoke all on function public.start_guest_run(), public.answer_guest_run(uuid, int, int), public.revive_guest_run(uuid),
  public.end_guest_run(uuid), public.challenge_now(), public.claim_guest_run(uuid), public.my_rank_watch()
  from public, anon, authenticated;

-- 登録前の挑戦と人数は、ログインしていなくても使う
grant execute on function public.start_guest_run(), public.answer_guest_run(uuid, int, int), public.revive_guest_run(uuid),
  public.end_guest_run(uuid), public.challenge_now()
  to anon, authenticated;
grant execute on function public.claim_guest_run(uuid), public.my_rank_watch() to authenticated;
