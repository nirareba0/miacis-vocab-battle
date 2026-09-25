# miacis-vocab-battle

韮崎市の中高生の居場所「青少年育成プラザ Miacis」に来る中高生向けの、対戦型英単語アプリ。

スマホや館のタブレットで、1回5分程度で気軽に語彙バトルや今週の英語クイズ・一言投稿が楽しめます。

---

## 主な機能

- **対戦バトル**: 1問6秒・全10問の4択バトル。過去の対戦履歴（非同期ゴースト）または練習ボットと対戦。
- **今週の英語**: 毎週おすすめの英語動画・記事を閲覧し、クイズに挑戦。学んだ英語を使って一言投稿（スタッフからスタンプが届きます）。
- **ランキング**: 段位ごとの「学習ポイント」ランキングと、全員参加の「コミットポイント」ランキング。
- **プライバシー保護**: 個人情報（本名・メールアドレス・学校名など）は一切保持せず、ニックネームとあいことば・学年だけで遊べます。

---

## ローカルでの動かし方

静的ホスティング（GitHub Pages 等）にそのまま配置できる構成です。ビルド作業は不要です。

```bash
# 静的ファイルサーバーの起動（例: npx serve）
npx serve web

# または Python 組み込みサーバー
python3 -m http.server 3000 -d web
```

ブラウザで `http://localhost:3000`（または表示されたポート番号）を開きます。

※ 初期状態では `web/js/config.js` の `SUPABASE_ANON_KEY` がプレースホルダ（`__ANON_KEY__`）になっているため、画面に「準備中」と表示されます。実際の Supabase プロジェクトを作成後、公開 anon key を設定してください。

---

## テストの実行

PGlite（PostgreSQL の WASM 版）を用いた DB ロジック・RLS 権限のテストと、ブラウザロジックの単体テストを同時に実行します。

```bash
npm test
```

---

## データベースの適用手順（管理者・Claude 用）

本番 Supabase プロジェクトへの適用手順です：

1. **マイグレーションの適用**  
   `supabase/migrations/` 配下の SQL ファイルを番号順に Supabase の SQL Editor 等で実行します。
   - `0001_schema.sql`: テーブル、インデックス、RLS ポリシー
   - `0002_functions.sql`: RPC 関数、ランキングビュー、バッチ関数
   - `0003_harden_privileges.sql`: 権限のハードニング（不要権限の剥奪と必要関数の許可）

2. **定期バッチジョブ（pg_cron）の登録**  
   本番環境で `supabase/cron.sql` を実行し、週次締め処理（`close_week`）、卒業生パージ（`purge_graduates`）、休眠パージ（`purge_inactive`）を登録します。

3. **単語データの投入**  
   `tools/admin.mjs` を使用して `data/words.csv` を投入します（後述）。

4. **クライアント設定**  
   Supabase ダッシュボードから Project URL と `anon` 公開鍵を取得し、`web/js/config.js` に記載します。

---

## 管理ツールの使い方 (`tools/admin.mjs`)

管理操作（あいことば再設定、スタッフ付与、ピッカー設定、改名、単語インポート）は CLI スクリプトで行います。  
実行には Supabase の `service_role` 秘密鍵が必要です（**リポジトリにはコミットしないでください**）。

```bash
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-secret-key"

# 1. あいことば（パスワード）の再設定
node tools/admin.mjs reset-passphrase <nickname> <新しいあいことば>

# 2. スタッフ権限の付与
node tools/admin.mjs make-staff <nickname>

# 3. コンテンツ提案（ピッカー）権限の設定
node tools/admin.mjs set-picker <nickname> on|off

# 4. ニックネームの変更（認証用メールも自動で再生成）
node tools/admin.mjs rename <旧ニックネーム> <新ニックネーム>

# 5. 単語データのインポート（data/words.csv から words テーブルへ投入）
node tools/admin.mjs import-words
```

---

## デプロイと CI

- **GitHub Pages**: `.github/workflows/pages.yml` により、`main` ブランチへの push 時にテストが通過した場合のみ `web/` が自動デプロイされます。
- **Supabase Keepalive**: `.github/workflows/keepalive.yml` により、毎日 UTC 21:00（JST 6:00）に Supabase の `ping` RPC を呼び出し、無料枠のスリープを防止します。

---

## ライセンス・クレジット

- **単語データ**: [New General Service List (NGSL) 1.2](http://www.newgeneralservicelist.org/) by Browne, C., Culligan, B., and Phillips, J. — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
  - 日本語訳は本アプリで独自に付与したものであり、同様に CC BY-SA 4.0 で公開します。
- **アプリケーションコード**: MIT License
