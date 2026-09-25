-- 0003: 権限を「全部取り消してから、要るものだけ許す」形に固める。
--
-- Supabase は public に作ったテーブル・シーケンス・関数を、既定で anon / authenticated に
-- 全部許可する（関数は PUBLIC にも実行権がある）。0001・0002 の GRANT は「足す」だけだったので、
-- 本番ではこのままだと次が起きる:
--   - add_commit / close_week / purge_graduates などの内部関数を、ログインしていない人でも RPC で呼べる
--   - matches.questions（正解つき）を本人が回答前に読める
-- RLS は行を絞るだけで、関数の実行権と列の権限は守らない。

-- 1. いったん全部取り消す
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- 2. 読むだけ（行は RLS で絞る）
grant select on public.words, public.contents to anon, authenticated;
grant select on public.players, public.staff, public.points, public.writings,
  public.weekly_results, public.content_opens, public.content_quiz_answers to authenticated;
grant select (
  id, player_id, band, answers, correct, total_ms, opponent, result, started_at, finished_at, week_start
) on public.matches to authenticated;
grant select on public.ranking_learn_week, public.ranking_commit_week to anon, authenticated;

-- 3. 端末から呼んでよい関数だけ
grant execute on function public.jst_now(), public.jst_today(), public.jst_week_start(timestamptz)
  to anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
grant execute on function
  public.register_player(text, int),
  public.touch_today(),
  public.start_match(),
  public.submit_match(uuid, jsonb),
  public.open_content(uuid),
  public.answer_content_quiz(uuid, jsonb),
  public.submit_writing(uuid, text),
  public.propose_content(text, text, jsonb, jsonb),
  public.approve_content(uuid),
  public.stamp_writing(uuid, text),
  public.my_summary()
  to authenticated;
-- add_commit / close_week / advance_grades / purge_graduates / purge_inactive は
-- どのロールにも許さない（pg_cron とサーバー側の関数の中からだけ呼ばれる）。

-- 4. これから作るものにも既定で許可しない（次の migration で GRANT を忘れたら「使えない」側に倒れる）
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
