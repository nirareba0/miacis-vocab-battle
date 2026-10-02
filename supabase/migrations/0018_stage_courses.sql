-- 0018_stage_courses.sql: 連続チャレンジをステージごとのコースにする（2026-10-02 本人）
-- 「Stage ごとに入口を変えたい、それぞれのランキング」「カードを選ぶのは微妙なのでやめる」
-- 「そのステージの単語はコンプリートするまで」「下位ステージのゲーム性のため、10問正解ごとに時間が短くなる」
--   - ステージ = band 1..5（A1・A2・B1・B2・最難関）。1回の挑戦はそのステージの単語だけ。出し切ったらコンプリート
--   - 制限時間: 7秒から、10問正解ごとに 0.5秒短く、下限 3秒（streak_base_ms / streak_step_ms / streak_time_every / streak_min_ms）
--   - 入口: A1 は最初から。次のステージは、ひとつ前のステージで 30 連続（stage_unlock_correct）。スタッフは全部開く
--   - ランキング・自己ベストはステージごと（連続の数、同じなら速い方）
--   - カード・スタート地点・系統樹（0017）は使わない。列と関数は残すが、もう候補を出さない
begin;

insert into public.app_settings (key, value) values
  ('streak_time_every', '10'),
  ('stage_unlock_correct', '30')
on conflict (key) do nothing;
update public.app_settings set value = '500' where key = 'streak_step_ms';
update public.app_settings set value = '3000' where key = 'streak_min_ms';

-- 入口が開いているか（band 1 は常に。スタッフは全部）
create or replace function public.stage_unlocked(p_player_id uuid, p_band int)
returns boolean as $$
  select p_band <= 1
    or exists (select 1 from public.players where id = p_player_id and account_type = 'staff')
    or coalesce((select max(correct) from public.runs
                 where player_id = p_player_id and mode = 'streak' and status = 'finished' and band = p_band - 1), 0)
       >= public.setting_num('stage_unlock_correct', 30)::int;
$$ language sql stable security definer set search_path = public;

-- 入口の一覧（開いているか・自己ベスト・今週ベスト・単語数・コンプリートしたか）
create or replace function public.my_stages()
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return (
    select jsonb_agg(jsonb_build_object(
      'band', b,
      'unlocked', public.stage_unlocked(v_uid, b),
      'need', public.setting_num('stage_unlock_correct', 30)::int,
      'words', (select count(*) from public.words w where w.active and w.band = b),
      'best', public.run_best(v_uid, 'streak', null, b),
      'week_best', public.run_best(v_uid, 'streak', public.jst_week_start(), b),
      'completed', exists (select 1 from public.runs r where r.player_id = v_uid and r.mode = 'streak' and r.band = b and r.end_reason = 'complete')
    ) order by b)
    from generate_series(1, 5) as b
  );
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function public.run_make_question(p_run public.runs)
returns jsonb as $$
declare
  v_stage int;
  v_range int;
  v_limit int;
  v_word public.words;
  v_dir text;
  v_correct text;
  v_distractors text[];
  v_choices text[] := '{}';
  v_answer_idx int;
begin
  if p_run.mode = 'streak' then
    -- 0018: ステージ（band 1..5 = A1..最難関）ごとのコース。そのステージの単語だけを、出し切るまで。
    -- 10問正解ごとに「ペース」が上がり、制限時間が短くなる
    v_stage := p_run.correct / greatest(1, public.setting_num('streak_time_every', 10)::int) + 1;
    v_range := null;
    v_limit := public.streak_limit_ms(v_stage);

  else
    v_stage := p_run.answered / 10 + 1;   -- 100本ノックは10問ごとの区切りを表示に使うだけ
    v_range := null;
    v_limit := public.setting_num('knock_limit_ms', 6000)::int;

  end if;

  -- 1. そのコース（連続チャレンジ・100本ノックとも band）から、まだ出ていない単語。すでに出た単語と日本語訳が同じもの（start / begin など）も出さない
  select w.* into v_word
  from public.words w
  join public.run_pool('knock', null, p_run.band) p on p.id = w.id
  where w.id <> all(p_run.used_word_ids)
    and w.ja not in (select u.ja from public.words u where u.id = any(p_run.used_word_ids))
  order by random()
  limit 1;

  -- 2. 範囲を使い切ったら、範囲の外のまだ出ていない単語。連続チャレンジは難しい（頻度の低い）方から、
  --    100本ノックは段の近い方から（2026-10-02: 361問連続で範囲10の264語を使い切り、同じ単語が出た）
  -- 連続チャレンジはステージの単語を出し切ったら終わり（コンプリート）。呼ぶ側が null を見て締める
  if not found and p_run.mode = 'streak' then
    return null;
  end if;

  if not found then
    select w.* into v_word
    from public.words w
    where w.active
      and w.id <> all(p_run.used_word_ids)
      and w.ja not in (select u.ja from public.words u where u.id = any(p_run.used_word_ids))
    order by
      case when p_run.mode = 'streak' then -(coalesce(w.sort_key, w.rank) / 50) else abs(w.band - coalesce(p_run.band, 1)) end,
      random()
    limit 1;
  end if;

  -- 3. 全部の単語を使い切ったときだけ、重複を許す
  if not found then
    select w.* into v_word
    from public.words w
    join public.run_pool('knock', null, p_run.band) p on p.id = w.id
    order by random()
    limit 1;
  end if;

  if not found then
    raise exception 'no_words';
  end if;

  v_dir := case when random() < 0.5 then 'en2ja' else 'ja2en' end;

  if v_dir = 'en2ja' then
    v_correct := v_word.ja;
    select array_agg(ja) into v_distractors from (
      select distinct ja from public.run_pool('knock', null, p_run.band) where ja <> v_correct order by ja
    ) d;
  else
    v_correct := v_word.en;
    select array_agg(en) into v_distractors from (
      -- 訳が同じ単語は「もう一つの正解」になるので選択肢に入れない
      select distinct en from public.run_pool('knock', null, p_run.band) where en <> v_correct and ja <> v_word.ja order by en
    ) d;
  end if;

  select array_agg(x) into v_distractors from (
    select x from unnest(coalesce(v_distractors, '{}')) as x order by random() limit 3
  ) s;

  while coalesce(array_length(v_distractors, 1), 0) < 3 loop
    v_distractors := array_append(v_distractors, 'dummy_' || coalesce(array_length(v_distractors, 1), 0));
  end loop;

  v_answer_idx := floor(random() * 4)::int;
  for c_pos in 0..3 loop
    if c_pos = v_answer_idx then
      v_choices := array_append(v_choices, v_correct);
    else
      v_choices := array_append(v_choices, v_distractors[1]);
      v_distractors := v_distractors[2:];
    end if;
  end loop;

  return jsonb_build_object(
    'no', p_run.answered + 1,
    'stage', v_stage,
    'range', p_run.band,
    'limit_ms', v_limit,
    'word_id', v_word.id,
    'dir', v_dir,
    'prompt', case when v_dir = 'en2ja' then v_word.en else v_word.ja end,
    'choices', to_jsonb(v_choices),
    'answer_index', v_answer_idx,
    'issued_at', public.jst_now()
  );
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function public.answer_run(p_run_id uuid, p_choice int, p_ms int)
returns jsonb as $$
declare
  v_uid uuid;
  v_run public.runs;
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
  v_shield_used boolean := false;
  v_offer jsonb;
  v_depth int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_run from public.runs where id = p_run_id for update;
  if not found then
    raise exception 'run_not_found';
  end if;
  if v_run.player_id <> v_uid then
    raise exception 'permission_denied';
  end if;
  if v_run.status <> 'active' or v_run.current is null then
    raise exception 'run_not_active';
  end if;

  v_q := v_run.current;
  v_limit := (v_q->>'limit_ms')::int;
  v_answer_idx := (v_q->>'answer_index')::int;
  v_elapsed := (extract(epoch from (public.jst_now() - (v_q->>'issued_at')::timestamptz)) * 1000)::int;

  -- 端末の時間は信用しすぎない: サーバーで測った時間より大きく短いことはありえない
  v_ms := greatest(0, least(v_limit, coalesce(p_ms, v_limit)));
  v_ms := greatest(v_ms, least(v_limit, v_elapsed - public.setting_num('run_grace_ms', 2500)::int));

  v_timeout := p_choice is null
    or p_ms is null
    or p_ms >= v_limit
    or v_elapsed > v_limit + public.setting_num('run_grace_ms', 2500)::int;
  v_correct := not v_timeout and p_choice = v_answer_idx;

  if v_correct then
    v_run.correct := v_run.correct + 1;
    v_run.total_ms := v_run.total_ms + v_ms;
    v_run.correct_word_ids := array_append(v_run.correct_word_ids, (v_q->>'word_id')::int);
    -- 木の実の素点: 基本 10、ステージが上がるほど +3、残り 30% を切ってからの正解に +5（桜井「どれぐらい良いことをした?」）
    v_run.nut_score := v_run.nut_score
      + 10
      + (case when v_run.mode = 'streak' then 3 * (coalesce((v_q->>'stage')::int, 1) - 1) else 0 end)
      + (case when v_ms >= v_limit * 0.7 then 5 else 0 end);
  else
    v_run.missed := v_run.missed || jsonb_build_array(jsonb_build_object(
      'word_id', v_q->'word_id',
      'prompt', v_q->'prompt',
      'correct_text', v_q->'choices'->v_answer_idx,
      'your_text', case when v_timeout then null else v_q->'choices'->p_choice end,
      'timeout', v_timeout
    ));
  end if;
  v_run.answered := v_run.answered + 1;
  v_run.used_word_ids := array_append(v_run.used_word_ids, (v_q->>'word_id')::int);

  v_depth := (coalesce(v_run.start_stage, 1) - 1) * 5 + v_run.correct;

  if v_run.mode = 'streak' then
    if v_correct then
      v_state := 'next';
    elsif coalesce(v_run.shields, 0) > 0 then
      -- たて: この1回の不正解を無効にする（連続は止まらない）
      v_run.shields := v_run.shields - 1;
      v_shield_used := true;
      v_state := 'next';
    elsif v_timeout and not v_run.revive_used then
      v_state := 'revive_offer';
    else
      v_state := 'finished';
    end if;
  else
    v_state := case when v_run.answered >= 100 then 'finished' else 'next' end;
  end if;

  if v_state in ('next', 'card_offer') then
    v_next := public.run_make_question(v_run);
    -- 連続チャレンジでステージの単語を出し切った → コンプリート
    if v_next is null and v_run.mode = 'streak' then
      v_state := 'finished';
    end if;
  end if;

  update public.runs
  set correct = v_run.correct,
      total_ms = v_run.total_ms,
      answered = v_run.answered,
      used_word_ids = v_run.used_word_ids,
      correct_word_ids = v_run.correct_word_ids,
      nut_score = v_run.nut_score,
      missed = v_run.missed,
      shields = v_run.shields,
      offer = case when v_state = 'card_offer' then v_offer else null end,
      status = case when v_state = 'revive_offer' then 'revive_offer' when v_state = 'card_offer' then 'card_offer' else status end,
      current = case when v_state in ('next', 'card_offer') then v_next
                     when v_state = 'revive_offer' then current || jsonb_build_object('offered_at', public.jst_now())
                     else current end
  where id = v_run.id;

  if v_state = 'finished' then
    v_result := public.run_finish(v_run.id,
      case when v_run.mode = 'knock' then 'complete'
           when v_correct then 'complete'
           when v_timeout then 'timeout'
           else 'wrong' end);
  end if;

  return jsonb_build_object(
    'correct', v_correct,
    'timeout', v_timeout,
    'answer_index', v_answer_idx,
    'state', v_state,
    'answered', v_run.answered,
    'score', v_run.correct,
    'revive_used', v_run.revive_used,
    'depth', v_depth,
    'shield_used', v_shield_used,
    'inventory', public.run_inventory(v_run),
    'offer', v_offer,
    -- カードを選ぶ間は問題を渡さない（選んでから pick_card が出す）
    'question', case when v_state = 'card_offer' then null else public.run_client_question(v_next) end,
    'result', v_result
  );
end;
$$ language plpgsql security definer set search_path = public;

drop function if exists public.start_run(text, int, int);
create or replace function public.start_run(p_mode text, p_band int default null, p_start_stage int default 1)
returns jsonb as $$
declare
  v_uid uuid;
  v_player public.players;
  v_old record;
  v_run public.runs;
  v_q jsonb;
  v_start int := coalesce(p_start_stage, 1);
  v_meta jsonb;
  v_offer jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_mode is null or p_mode not in ('streak', 'knock') then
    raise exception 'invalid_mode';
  end if;

  select * into v_player from public.players where id = v_uid;
  if not found then
    raise exception 'player_not_found';
  end if;

  -- 0018: 連続チャレンジもステージ（band 1..5）を選ぶ。入口は「ひとつ前のステージで規定の連続」で開く。スタッフは全部開いている
  v_start := 1;
  if p_mode = 'streak' and not public.stage_unlocked(v_uid, least(5, greatest(1, coalesce(p_band, 1)))) then
    raise exception 'stage_locked';
  end if;

  for v_old in
    select id from public.runs
    where player_id = v_uid and status <> 'finished'
    for update
  loop
    perform public.run_finish(v_old.id, 'abandoned');
  end loop;

  insert into public.runs (player_id, mode, band, start_stage, started_at, week_start)
  -- 100本ノックはレベルを選ぶ（A1=1 … 最難関=5）。選ばなければ自分の段
  values (v_uid, p_mode, case when p_mode = 'knock' then least(5, greatest(1, coalesce(p_band, v_player.tier))) else least(5, greatest(1, coalesce(p_band, 1))) end,
          v_start, public.jst_now(), public.jst_week_start())
  returning * into v_run;

  v_q := public.run_make_question(v_run);
  update public.runs set current = v_q where id = v_run.id;
  v_offer := null;

  return jsonb_build_object(
    'run_id', v_run.id,
    'mode', p_mode,
    'band', v_run.band,
    'total', case when p_mode = 'knock' then 100 else null end,
    'best', public.run_best(v_uid, p_mode, null, v_run.band),
    'week_best', public.run_best(v_uid, p_mode, public.jst_week_start(), v_run.band),
    'start_stage', v_start,
    'depth', (v_start - 1) * 5,
    'inventory', public.run_inventory(v_run),
    'offer', v_offer,
    'question', case when v_offer is null then public.run_client_question(v_q) else null end
  );
end;
$$ language plpgsql security definer set search_path = public;

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
  -- depth は生成列。直前の update の値で読み直すため、ここでは select の結果を使う

  if v_run.status = 'finished' then
    return public.run_result(v_run.id);
  end if;

  v_prev_best := public.run_best(v_run.player_id, v_run.mode, null, v_run.band);
  v_prev_week_best := public.run_best(v_run.player_id, v_run.mode, v_run.week_start, v_run.band);

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

  v_nuts_raw := public.scale_nuts(v_nuts_raw * greatest(1, coalesce(v_run.coin_mult, 1)));

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
        or (it.id = 'title_stage5' and v_run.mode = 'streak' and p_reason = 'complete')
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
    v_me := public.run_best(v_run.player_id, v_run.mode, v_run.week_start, v_run.band);
    if v_run.mode = 'streak' then
      select r.rank into v_rank from public.ranking_streak_week r
        join public.players p on p.nickname = r.nickname where p.id = v_run.player_id and r.band = v_run.band;
      select jsonb_build_object('nickname', r.nickname, 'correct', r.best_streak, 'rank', r.rank, 'is_staff', r.is_staff) into v_rival
        from public.ranking_streak_week r
        where r.band = v_run.band and r.rank < coalesce(v_rank, 999999)
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
      -- 記録は「到達」（スタート地点のぶん＋連続）で比べる（0017）
      'new_best', (v_run.mode = 'streak' or p_reason = 'complete')
        and v_run.correct > 0
        and (v_prev_best is null or v_run.depth > (v_prev_best->>'depth')::int
             or (v_run.depth = (v_prev_best->>'depth')::int and v_run.total_ms < (v_prev_best->>'total_ms')::int)),
      'new_week_best', (v_run.mode = 'streak' or p_reason = 'complete')
        and v_run.correct > 0
        and (v_prev_week_best is null or v_run.depth > (v_prev_week_best->>'depth')::int
             or (v_run.depth = (v_prev_week_best->>'depth')::int and v_run.total_ms < (v_prev_week_best->>'total_ms')::int)),
      'meta', public.meta_of(v_run.player_id),
      'meta_gain', v_run.correct
    );
end;
$$ language plpgsql security definer set search_path = public;

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
  b.band
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
  b.band
from best b
join public.players p on p.id = b.player_id
order by band asc, rank asc, nickname asc;

create or replace function public.staff_settings()
returns jsonb as $$
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  return (
    select coalesce(jsonb_object_agg(k.key, jsonb_build_object('value', coalesce(s.value, k.def), 'label', k.label, 'kind', k.kind, 'min', k.lo, 'max', k.hi)), '{}'::jsonb)
    from (values
      ('streak_base_ms',   '7000', '連続チャレンジ 最初の制限時間（ミリ秒）', 'int',  '2000', '15000'),
      ('streak_step_ms',   '500',  '連続チャレンジ 正解を重ねるごとに短くする時間（ミリ秒）', 'int', '0', '2000'),
      ('streak_time_every','10',   '連続チャレンジ 何問正解ごとに時間を短くするか', 'int', '1', '50'),
      ('stage_unlock_correct','30','連続チャレンジ 次のステージを開くのに要る連続', 'int', '1', '500'),
      ('streak_min_ms',    '3000', '連続チャレンジ 制限時間の下限（ミリ秒）', 'int', '1500', '10000'),
      ('knock_limit_ms',   '6000', '100本ノック 1問の制限時間（ミリ秒）', 'int', '2000', '15000'),
      ('nut_score_per_nut','25',   'Miコイン 素点いくつで1個', 'int', '5', '200'),
      ('nuts_scale',       '0.3333','Miコイン 倍率（対戦・ログインにも効く）', 'num', '0.05', '3'),
      ('nuts_daily_cap',   '200',  'Miコイン 1日の上限', 'int', '10', '5000'),
      ('pull_cost',        '5',    'ガチャ 1回の値段', 'int', '1', '500'),
      ('pull10_cost',      '50',   'ガチャ まとめ引きの値段', 'int', '1', '5000'),
      ('pull10_count',     '11',   'ガチャ まとめ引きで出る数', 'int', '10', '20'),
      ('raffle_rate',      '0.10', '抽選券 ガチャ1回で出る確率（0〜1）', 'num', '0', '1'),
      ('secret_rate',      '0.003','SECRET（ネコ・イヌのすがた）ガチャ1回で出る確率（0〜1）', 'num', '0', '0.05'),
      ('rank_mode_enabled','false','ランクモード（段の表示）', 'bool', '', '')
    ) as k(key, def, label, kind, lo, hi)
    left join public.app_settings s on s.key = k.key
  );
end;
$$ language plpgsql stable security definer set search_path = public;

update public.items set name = 'ステージ制覇' where id = 'title_stage5';

revoke all on function public.stage_unlocked(uuid, int), public.run_make_question(public.runs), public.run_finish(uuid, text) from public, anon, authenticated;
revoke all on function public.my_stages(), public.answer_run(uuid, int, int), public.start_run(text, int, int), public.staff_settings() from public, anon, authenticated;
grant execute on function public.my_stages(), public.answer_run(uuid, int, int), public.start_run(text, int, int), public.staff_settings() to authenticated;
grant select on public.ranking_streak_week, public.ranking_streak_all to anon, authenticated;

commit;
