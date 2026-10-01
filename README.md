# miacis-vocab-battle

韮崎市の中高生の居場所「青少年育成プラザ Miacis」に来る中高生向けの英単語アプリ「Miacis 英単語サバイバル」。連続正解の記録を館のみんなと競う。

スマホや館のタブレットで、1回5分程度で気軽に語彙バトルや今週の英語クイズ・一言投稿が楽しめます。

---

## 主な機能

- **対戦バトル**: 1問6秒・全10問の4択バトル。過去の対戦履歴（非同期ゴースト）または練習ボットと対戦。正解数や勝利に応じて「木の実🌰」を獲得。
- **木の実とガチャ**: 貯めた木の実で1回（15🌰）または10連（150🌰・SR以上1つ確定）ガチャ。ミアキスの着せ替え、称号、そしてMiacis館内で交換できる実物景品が当たります。
- **着せ替えと称号**: 帽子・顔・首まわり・背景・オーラ・称号を組み合わせて自分だけのミアキスにカスタマイズ。対戦やランキングでも反映されます。重複アイテムは「かけら」に変換され、好きなアイテムと交換可能。
- **館の実物景品（引換券）**: ガチャから低確率で館の景品引換券が出現。当たった引換券を館内カウンターでスタッフに見せることで実物景品と引き換えられます。
- **単語図鑑**: 対戦で正解した単語が段ごとに自動記録され、語彙のマスター進捗を振り返ることができます。
- **今週の英語**: 毎週おすすめの英語動画・記事を閲覧し、クイズに挑戦。学んだ英語を使って一言投稿（スタッフからスタンプが届きます）。
- **ランキング**: 段位ごとの「学習ポイント」ランキングと、全員参加の「コミットポイント」ランキング。着せ替えたミアキスと称号が表示されます。
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
   - `0004_game.sql`: ゲーム性（ミアキスの進化・合言葉・カードパック・図鑑）
   - `0005_fix_evolution_streak.sql`: 進化と連続日数の修正
   - `0006_gacha.sql`: 木の実（nut_ledger）、着せ替え（items, player_looks）、ガチャ（pull_gacha, player_shards, exchange_item）、館の景品（prizes, prize_tickets, staff_upsert_prize, staff_list_tickets, staff_redeem_ticket）、単語図鑑（my_words）

2. **合言葉の設定**  
   館内利用者限定とするため、`tools/sql/set-invite-code.sql` を Supabase の SQL Editor で開き、合言葉を設定して実行します（公開リポジトリには実際の合言葉をコミットしないでください）。

3. **館の景品の初期登録・在庫設定**  
   `tools/sql/prizes.sql` を参考に、実物景品の登録や在庫数、排出確率（`prize_rate`）を設定します。スタッフ画面（`#/staff`）からも追加・引換操作が可能です。

4. **定期バッチジョブ（pg_cron）の登録**  
   本番環境で `supabase/cron.sql` を実行し、週次締め処理（`close_week`）、卒業生パージ（`purge_graduates`）、休眠パージ（`purge_inactive`）を登録します。

5. **単語データの投入**  
   `tools/admin.mjs` を使用して `data/words.csv` を投入します（後述）。

6. **クライアント設定**  
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

## スタッフ区分と週次無料券（0007）

- `0007_staff_weekly_rewards.sql` を適用すると、既存スタッフは `account_type=staff`・学年なしになります。今後のスタッフ付与も既存の管理ツール `make-staff` を利用します。生徒が登録画面からスタッフを選ぶことはできません。
- スタッフはランキング・昇降段・実物景品の抽選から除外されます。木の実・着せ替えの試用は可能です。スタッフ画面の「利用状況」で生徒登録数、今週の利用者、抽選回数（10連は10回）、発券状況を確認できます。
- 無料券は「購買部の100円までの商品1点」または「チェキ1回」のどちらかを選ぶ1枚です。ガチャと週間コミット1位に各週1枚を設定しています。
- 移行直後の券は停止中です。交換条件を確認後、`tools/sql/enable-weekly-rewards.sql` を実行して有効化します。初期の景品当選確率は1回1%。週の当選後とスタッフの抽選では実物景品は出ません。
- 月曜0:00 JSTにガチャ枠が復活します（未当選分の繰り越しなし）。ガチャは週最大1枚であり、毎週必ず当選する保証はありません。
- ランキングは週間コミットポイントの生徒全体1位（1点以上）。同点時は公開ランキングと同じニックネーム昇順で1人に決めます。既存 `close-week-job` が月曜0:05 JSTに前週を確定し発券します。景品開始週より前の週には発券しません。
- `weekly_prize_awards` の週＋枠の一意制約とトランザクションロックで重複発券を防ぎます。引換券やアカウントを削除しても消費済み枠は復活しません。
- 一般景品を追加した場合も、ガチャの実物景品合計は週1枚です。景品抽選は有効な在庫を重みに選ぶため、複数景品がある場合の1%は景品全体の確率です。
- ガチャ価格（15／150個）と対戦報酬は、この更新では変更していません。
