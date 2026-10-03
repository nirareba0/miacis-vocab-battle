-- 0023_motivation.sql（2026-10-03 本人「中高生の学習モチベーションを高める方向性で設計して」）
-- 仕様: AIOS core/projects/miacis/specs/motivation-design-20261003.md（調査は motivation-research-20261003.md）
-- 1. リベンジ: つまずいた単語（前の回で間違えた・時間切れ。そのあと正解していないもの）を、次の回の最初の数問に出す。
--    間をあけて思い出させる（間隔効果・テスト効果）。問題に revenge=true を付け、画面は「リベンジ」と出す
-- 2. 今日やること: 毎日3つ（サバイバル1回・正解20問・図鑑に5語）。1つ達成ごとに Miコイン（quest_coin）。自動で受け取る
-- 3. 図鑑の途中ごほうび: 各レベルで 50語ごと（zukan_mile_every）に Miコイン（zukan_mile_coin）。コンプリートの すがた（0022）はそのまま
-- 数値はすべて app_settings。スタッフ画面「設定」で変えられる（staff_settings に足した）
begin;

insert into public.app_settings (key, value) values
  ('revenge_max', '3'),          -- 1回の最初の何問までをリベンジにするか（0 で止める）
  ('revenge_days', '14'),        -- 何日前までのつまずきを拾うか
  ('quest_coin', '2'),           -- 今日やること 1つで Miコイン
  ('quest_correct_goal', '20'),  -- 今日やること「正解 ◯問」
  ('quest_words_goal', '5'),     -- 今日やること「図鑑に ◯語」
  ('zukan_mile_every', '50'),    -- 図鑑 何語ごとにごほうび
  ('zukan_mile_coin', '5')       -- 図鑑の途中ごほうびの Miコイン
on conflict (key) do nothing;

-- 1. リベンジ ------------------------------------------------------------
-- p_player のつまずいた単語のうち、p_band のもの。新しいつまずきから。そのあとの回で正解したものは除く
create or replace function public.revenge_candidates(p_player uuid, p_band int, p_exclude int[])
returns table (word_id int) as $$
  select m.word_id
  from (
    select distinct on ((x.value->>'word_id')::int)
      (x.value->>'word_id')::int as word_id, r.started_at, r.id as run_id
    from public.runs r, jsonb_array_elements(r.missed) x(value)
    where r.player_id = p_player
      and r.status = 'finished'
      and r.band = p_band
      and r.started_at >= public.jst_now() - make_interval(days => greatest(1, public.setting_num('revenge_days', 14)::int))
      and (x.value->>'word_id') is not null
    order by (x.value->>'word_id')::int, r.started_at desc
  ) m
  join public.words w on w.id = m.word_id and w.active and w.band = p_band
  where m.word_id <> all(coalesce(p_exclude, '{}'))
    and not exists (
      select 1 from public.runs r2
      where r2.player_id = p_player and r2.id <> m.run_id and r2.started_at >= m.started_at and m.word_id = any(r2.correct_word_ids)
    )
  order by m.started_at desc, m.word_id;
$$ language sql stable security definer set search_path = public;

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
  v_tier int := 0;
  v_pref text[] := '{}';
  v_revenge boolean := false;
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

  -- 0. 0023 リベンジ: 回の最初の revenge_max 問は、前の回でつまずいた単語を先に出す（新しいつまずきから）
  if p_run.answered < public.setting_num('revenge_max', 3)::int then
    select w.* into v_word
    from public.revenge_candidates(p_run.player_id, p_run.band, p_run.used_word_ids) c
    join public.words w on w.id = c.word_id
    where w.ja not in (select u.ja from public.words u where u.id = any(p_run.used_word_ids))
    limit 1;
    v_revenge := found;
  end if;

  -- 1. そのコース（連続チャレンジ・100本ノックとも band）から、まだ出ていない単語。すでに出た単語と日本語訳が同じもの（start / begin など）も出さない
  if not v_revenge then
    select w.* into v_word
    from public.words w
    join public.run_pool('knock', null, p_run.band) p on p.id = w.id
    where w.id <> all(p_run.used_word_ids)
      and w.ja not in (select u.ja from public.words u where u.id = any(p_run.used_word_ids))
    order by random()
    limit 1;
  end if;

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

  -- 0019: 連続が進むほど、選択肢を細かい違いにする（ペース = 10問ごと）
  --   1: 同じステージのランダム  2: 同じ品詞  3: つづりの似た実在の単語  4〜: 似た単語 と 1文字違いのつづりの罠 が半々
  if p_run.mode = 'streak' then
    v_tier := case
      when v_stage >= 4 then case when random() < 0.5 and coalesce(array_length(v_word.misspellings, 1), 0) >= 3 then 3 else 2 end
      when v_stage = 3 then 2
      when v_stage = 2 then 1
      else 0 end;
  end if;
  if v_tier = 3 then
    v_dir := 'ja2en';   -- つづりの罠は「日本語 → 英語」でしか成り立たない
  end if;

  if v_dir = 'en2ja' then
    v_correct := v_word.ja;
  else
    v_correct := v_word.en;
  end if;

  if v_tier = 3 then
    select array_agg(x) into v_pref from (select x from unnest(v_word.misspellings) as x order by random() limit 3) s;
  elsif v_tier = 2 then
    if v_dir = 'en2ja' then
      select array_agg(ja) into v_pref from (
        select distinct w.ja from public.words w
        where w.en = any(coalesce(v_word.lookalikes, '{}')) and w.ja <> v_word.ja
        order by w.ja limit 3
      ) s;
    else
      select array_agg(en) into v_pref from (
        select w.en from public.words w
        where w.en = any(coalesce(v_word.lookalikes, '{}')) and w.ja <> v_word.ja
        order by random() limit 3
      ) s;
    end if;
  end if;
  v_pref := coalesce(v_pref, '{}');

  -- 足りない分は同じステージから（tier 1 以上は同じ品詞を優先）。訳が同じ単語は「もう一つの正解」になるので入れない
  if v_dir = 'en2ja' then
    select array_agg(ja) into v_distractors from (
      select ja from (
        select distinct on (p.ja) p.ja, w.pos from public.run_pool('knock', null, p_run.band) p join public.words w on w.id = p.id
        where p.ja <> v_correct and p.ja <> all(v_pref)
      ) d
      order by case when v_tier >= 1 and pos = v_word.pos then 0 else 1 end, random()
      limit 3
    ) d;
  else
    select array_agg(en) into v_distractors from (
      select en from (
        select distinct on (p.en) p.en, w.pos from public.run_pool('knock', null, p_run.band) p join public.words w on w.id = p.id
        where p.en <> v_correct and p.ja <> v_word.ja and p.en <> all(v_pref)
      ) d
      order by case when v_tier >= 1 and pos = v_word.pos then 0 else 1 end, random()
      limit 3
    ) d;
  end if;

  select array_agg(x) into v_distractors from (
    select x from (
      select x, 0 as k from unnest(v_pref) as x
      union all
      select x, 1 as k from unnest(coalesce(v_distractors, '{}')) as x
    ) u order by k, random() limit 3
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
    'tier', v_tier,
    'revenge', v_revenge,
    'prompt', case when v_dir = 'en2ja' then v_word.en else v_word.ja end,
    'choices', to_jsonb(v_choices),
    'answer_index', v_answer_idx,
    'issued_at', public.jst_now()
  );
end;
$$ language plpgsql volatile security definer set search_path = public;

-- 2. 今日やること ---------------------------------------------------------
-- 今日（日本時間）に終えた回から数える。3つとも「遊べば自然に進む」ものだけ（追加の作業を作らない）
create or replace function public.daily_quest_state(p_uid uuid)
returns jsonb as $$
declare
  v_today date := public.jst_today();
  v_from timestamptz := (public.jst_today()::timestamp at time zone 'Asia/Tokyo');
  v_runs int;
  v_correct int;
  v_new int;
  v_goal_c int := greatest(1, public.setting_num('quest_correct_goal', 20)::int);
  v_goal_w int := greatest(1, public.setting_num('quest_words_goal', 5)::int);
  v_coin int := greatest(0, public.setting_num('quest_coin', 2)::int);
begin
  select count(*) filter (where r.mode = 'streak' and r.answered > 0), coalesce(sum(r.correct), 0)
    into v_runs, v_correct
  from public.runs r
  where r.player_id = p_uid and r.status = 'finished' and r.finished_at >= v_from;

  -- 図鑑に入った語: 今日の回で正解した語のうち、今日より前の回では正解していなかったもの
  select count(distinct t.word_id) into v_new
  from (
    select unnest(r.correct_word_ids) as word_id
    from public.runs r
    where r.player_id = p_uid and r.status = 'finished' and r.finished_at >= v_from
  ) t
  where not exists (
    select 1 from public.runs r0
    where r0.player_id = p_uid and r0.started_at < v_from and t.word_id = any(r0.correct_word_ids)
  );

  return jsonb_build_object(
    'day', v_today,
    'coin', v_coin,
    'quests', jsonb_build_array(
      jsonb_build_object('key', 'survival', 'label', 'サバイバル', 'unit', '回', 'goal', 1, 'progress', least(v_runs, 1),
        'claimed', exists (select 1 from public.nut_ledger where player_id = p_uid and reason = 'quest' and ref = v_today || ':survival')),
      jsonb_build_object('key', 'correct', 'label', '正解', 'unit', '問', 'goal', v_goal_c, 'progress', least(v_correct, v_goal_c),
        'claimed', exists (select 1 from public.nut_ledger where player_id = p_uid and reason = 'quest' and ref = v_today || ':correct')),
      jsonb_build_object('key', 'new_words', 'label', '図鑑に新しい単語', 'unit', '語', 'goal', v_goal_w, 'progress', least(v_new, v_goal_w),
        'claimed', exists (select 1 from public.nut_ledger where player_id = p_uid and reason = 'quest' and ref = v_today || ':new_words'))
    )
  );
end;
$$ language plpgsql stable security definer set search_path = public;

-- 達成したものの Miコインを渡す（何度呼んでもよい。1日1つにつき1回）。新しく渡したものと、いまの状態を返す。
-- 1日の上限（nuts_daily_cap）には数えない（遊んだ結果の約束なので、上限で消えないようにする）
create or replace function public.claim_daily_quests()
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_state jsonb;
  v_q jsonb;
  v_claimed jsonb := '[]'::jsonb;
  v_coin int;
  v_today date := public.jst_today();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_state := public.daily_quest_state(v_uid);
  v_coin := (v_state->>'coin')::int;
  for v_q in select value from jsonb_array_elements(v_state->'quests') loop
    if (v_q->>'progress')::int >= (v_q->>'goal')::int and not (v_q->>'claimed')::boolean and v_coin > 0 then
      insert into public.nut_ledger (player_id, amount, reason, ref, day, created_at)
      values (v_uid, v_coin, 'quest', v_today || ':' || (v_q->>'key'), v_today, public.jst_now())
      on conflict (player_id, reason, ref) do nothing;
      if found then
        v_claimed := v_claimed || jsonb_build_array(jsonb_build_object('key', v_q->>'key', 'label', v_q->>'label', 'coin', v_coin));
      end if;
    end if;
  end loop;
  return public.daily_quest_state(v_uid) || jsonb_build_object('claimed_now', v_claimed);
end;
$$ language plpgsql security definer set search_path = public;

-- 3. 図鑑の途中ごほうび -------------------------------------------------
-- レベルごとの いま・次のごほうびまで（コンプリートの すがた は 0022）
create or replace function public.zukan_progress_of(p_uid uuid)
returns jsonb as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'band', z.band, 'total', z.total, 'collected', z.collected,
    'next_at', case when z.total = 0 then null
                    when (z.collected / e.every + 1) * e.every < z.total then (z.collected / e.every + 1) * e.every
                    else z.total end,
    'next_kind', case when (z.collected / e.every + 1) * e.every < z.total then 'coin' else 'complete' end,
    'coin', e.coin
  ) order by z.band), '[]'::jsonb)
  from public.zukan_collected(p_uid) z,
    (select greatest(5, public.setting_num('zukan_mile_every', 50)::int) as every,
            greatest(0, public.setting_num('zukan_mile_coin', 5)::int) as coin) e;
$$ language sql stable security definer set search_path = public;

create or replace function public.my_zukan_progress()
returns jsonb as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return public.zukan_progress_of(auth.uid());
end;
$$ language plpgsql stable security definer set search_path = public;

-- 50語ごとの Miコインを渡す（さかのぼって全部。何度呼んでもよい）。新しく渡したものと、いまの状態を返す
create or replace function public.claim_zukan_milestones()
returns jsonb as $$
declare
  v_uid uuid := auth.uid();
  v_every int := greatest(5, public.setting_num('zukan_mile_every', 50)::int);
  v_coin int := greatest(0, public.setting_num('zukan_mile_coin', 5)::int);
  v_z record;
  v_at int;
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_coin > 0 then
    for v_z in select * from public.zukan_collected(v_uid) where total > 0 loop
      v_at := v_every;
      while v_at <= v_z.collected and v_at < v_z.total loop
        insert into public.nut_ledger (player_id, amount, reason, ref, day, created_at)
        values (v_uid, v_coin, 'zukan_mile', v_z.band || ':' || v_at, public.jst_today(), public.jst_now())
        on conflict (player_id, reason, ref) do nothing;
        if found then
          v_out := v_out || jsonb_build_array(jsonb_build_object('band', v_z.band, 'at', v_at, 'coin', v_coin));
        end if;
        v_at := v_at + v_every;
      end loop;
    end loop;
  end if;
  return jsonb_build_object('claimed_now', v_out, 'bands', public.zukan_progress_of(v_uid));
end;
$$ language plpgsql security definer set search_path = public;

-- 4. スタッフ画面の設定に新しい鍵を足す（名前は サバイバル・トレーニング に合わせた）
create or replace function public.staff_settings()
returns jsonb as $$
begin
  if auth.uid() is null or not exists (select 1 from public.staff where user_id = auth.uid()) then
    raise exception 'not_a_staff';
  end if;
  return (
    select coalesce(jsonb_object_agg(k.key, jsonb_build_object('value', coalesce(s.value, k.def), 'label', k.label, 'kind', k.kind, 'min', k.lo, 'max', k.hi)), '{}'::jsonb)
    from (values
      ('streak_base_ms',   '7000', 'サバイバル 最初の制限時間（ミリ秒）', 'int',  '2000', '15000'),
      ('streak_step_ms',   '500',  'サバイバル 正解を重ねるごとに短くする時間（ミリ秒）', 'int', '0', '2000'),
      ('streak_time_every','10',   'サバイバル 何問正解ごとに時間を短くするか', 'int', '1', '50'),
      ('stage_unlock_correct','30','サバイバル 次のステージを開くのに要る連続', 'int', '1', '500'),
      ('streak_min_ms',    '3000', 'サバイバル 制限時間の下限（ミリ秒）', 'int', '1500', '10000'),
      ('knock_limit_ms',   '6000', 'トレーニング 1問の制限時間（ミリ秒）', 'int', '2000', '15000'),
      ('nut_score_per_nut','25',   'Miコイン 素点いくつで1個（小さいほど多くもらえる）', 'int', '5', '200'),
      ('nuts_scale',       '0.3333','Miコイン 倍率（対戦・ログインにも効く）', 'num', '0.05', '3'),
      ('nuts_daily_cap',   '200',  'Miコイン 1日の上限', 'int', '10', '5000'),
      ('pull_cost',        '5',    'ガチャ 1回の値段', 'int', '1', '500'),
      ('pull10_cost',      '50',   'ガチャ まとめ引きの値段', 'int', '1', '5000'),
      ('pull10_count',     '11',   'ガチャ まとめ引きで出る数', 'int', '10', '20'),
      ('raffle_rate',      '0.10', '抽選券 ガチャ1回で出る確率（0〜1）', 'num', '0', '1'),
      ('secret_rate',      '0.003','SECRET ガチャ1回で出る確率（0〜1）', 'num', '0', '0.05'),
      ('revenge_max',      '3',    'リベンジ 回の最初の何問まで（0で止める）', 'int', '0', '10'),
      ('revenge_days',     '14',   'リベンジ 何日前までのつまずきを出すか', 'int', '1', '60'),
      ('quest_coin',       '2',    '今日やること 1つでもらえる Miコイン', 'int', '0', '50'),
      ('quest_correct_goal','20',  '今日やること「正解 ◯問」', 'int', '1', '500'),
      ('quest_words_goal', '5',    '今日やること「図鑑に新しい単語 ◯語」', 'int', '1', '100'),
      ('zukan_mile_every', '50',   '図鑑 何語ごとにごほうび', 'int', '5', '500'),
      ('zukan_mile_coin',  '5',    '図鑑 途中のごほうびの Miコイン', 'int', '0', '100'),
      ('rank_mode_enabled','false','ランクモード（段の表示）', 'bool', '', '')
    ) as k(key, def, label, kind, lo, hi)
    left join public.app_settings s on s.key = k.key
  );
end;
$$ language plpgsql stable security definer set search_path = public;

-- 5. 権限（全部取り消してから要るものだけ）
revoke all on function public.revenge_candidates(uuid, int, int[]), public.run_make_question(public.runs),
  public.daily_quest_state(uuid), public.zukan_progress_of(uuid) from public, anon, authenticated;
revoke all on function public.claim_daily_quests(), public.my_zukan_progress(), public.claim_zukan_milestones(),
  public.staff_settings() from public, anon, authenticated;
grant execute on function public.claim_daily_quests(), public.my_zukan_progress(), public.claim_zukan_milestones(),
  public.staff_settings() to authenticated;

-- 6. Miコインの素点を 25 → 10 に（2026-10-03 本人「コインは10にしよう」。10連続で 3〜5個）
update public.app_settings set value = '10' where key = 'nut_score_per_nut';

commit;
