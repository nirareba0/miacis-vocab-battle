-- 0019_traps_and_staff.sql（2026-10-03 本人）
-- 1.「連続正解を進めていくと、単語を細かい違いにしていく。似た単語、一文字が a と e が違う、で難度を上げる」
--    words に lookalikes（つづりの似た実在の単語）と misspellings（1文字違いの実在しないつづり）を持たせ、
--    10問ごとのペースで選択肢を細かくする。データは seed/words_v2.sql（data/words_v2.csv から tools/build-words-v2.mjs）
-- 2.「イタチとかはやめにして、イヌとネコの他に、スタッフモチーフのミアキス」
--    子孫の動物 8 種はガチャから外す（持っている人の絵は残す）。SECRET にスタッフモチーフ 7 種を足す
begin;

alter table public.words add column if not exists lookalikes text[] not null default '{}';
alter table public.words add column if not exists misspellings text[] not null default '{}';

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
    'prompt', case when v_dir = 'en2ja' then v_word.en else v_word.ja end,
    'choices', to_jsonb(v_choices),
    'answer_index', v_answer_idx,
    'issued_at', public.jst_now()
  );
end;
$$ language plpgsql volatile security definer set search_path = public;

update public.items set active = false where id in ('form_fox','form_raccoon','form_redpanda','form_weasel','form_tiger','form_wolf','form_lion','form_bear');

insert into public.items (id, name, slot, rarity, display, active, source) values
  ('staff_designer', 'デザイナーのミアキスちゃん', 'form', 5, '{}'::jsonb, true, 'gacha'),
  ('staff_aussie', 'オーストラリア国旗を背負ったミアキスくん', 'form', 5, '{}'::jsonb, true, 'gacha'),
  ('staff_backpacker', 'バックパッカーのミアキスくん', 'form', 5, '{}'::jsonb, true, 'gacha'),
  ('staff_stylist', 'スタイリストのミアキスちゃん', 'form', 5, '{}'::jsonb, true, 'gacha'),
  ('staff_engineer', 'エンジニアのミアキスくん', 'form', 5, '{}'::jsonb, true, 'gacha'),
  ('staff_shisa', 'シーサーをかぶったミアキスくん', 'form', 5, '{}'::jsonb, true, 'gacha'),
  ('staff_family', '赤ちゃんとシュナウザーを連れたミアキスくん', 'form', 5, '{}'::jsonb, true, 'gacha')
on conflict (id) do nothing;

revoke all on function public.run_make_question(public.runs) from public, anon, authenticated;

commit;
