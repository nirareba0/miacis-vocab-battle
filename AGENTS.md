# AGENTS.md — miacis-vocab-battle の実装規約

韮崎市の中高生の居場所「青少年育成プラザ Miacis」に来る中高生向けの、対戦型英単語アプリ。
仕様の正本は AIOS 側 `~/AIOS/core/projects/miacis/specs/vocab-battle-build-spec-20260925.md`（要件は同 `vocab-battle-requirements-20260925.md`）。
このファイルは実装の規約だけを持つ。

## 構成

| 場所 | 中身 |
|---|---|
| `supabase/migrations/` | DB のスキーマ・RLS・サーバー側の関数（番号順に適用する素の SQL） |
| `supabase/cron.sql` | pg_cron の登録だけ（本番にだけ適用。テストでは読まない） |
| `supabase/seed/` | 単語などの投入 SQL（`tools/` のスクリプトが生成する） |
| `web/` | GitHub Pages にそのまま出す画面。ビルドなし・素の ES Modules |
| `tests/db/` | PGlite で migrations を流して関数と権限を検査する（`npm test`） |
| `web/tests/` | 画面側の純粋なロジックの検査（`npm test`） |
| `tools/` | 単語の取り込み・管理用スクリプト（Node） |
| `data/` | 単語データ（NGSL 由来。CC BY-SA 4.0） |

## 守ること

- **個人情報を持たない。** 本名・メールアドレス・学校名・写真を保存する列を作らない。登録はニックネーム・あいことば・学年だけ
- **権限は「全部取り消してから要るものだけ許す」。** Supabase は public のテーブル・関数を既定で anon/authenticated に全部許可するので、新しいテーブル・関数を足したら `0003_harden_privileges.sql` と同じ形で REVOKE と GRANT を書く。テスト（`tests/db/helper.mjs`）はこの既定を再現している
- **ポイントは端末から書けない。** `points` への INSERT/UPDATE/DELETE は anon・authenticated に GRANT しない。書くのは `security definer` の関数だけ
- 問題の正解は、答えを送る前に端末へ渡さない
- 画面の文字は日本語。英語は問題と「今週の英語」の中だけ
- ランキングに出すのはニックネームと段だけ（学年は出さない）
- 秘密情報（service_role key、DB パスワード）をリポジトリに書かない。anon key と URL は `web/js/config.js` に書いてよい（公開鍵。アクセス制御は RLS と GRANT）
- 時刻の区切りは日本時間（`Asia/Tokyo`）。週は月曜 0:00 始まり
- `supabase-js` は `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm` から読む
- テストは `npm test`（= `node --test 'tests/**/*.test.mjs' 'web/tests/**/*.test.mjs'`）で全部通ること。テストファイルは必ず `*.test.mjs` にする（中継の index.js は作らない）。DB のテストは `@electric-sql/pglite`（devDependency）を使う
- **git commit / git push をしない。** 指示にないファイルを編集しない
