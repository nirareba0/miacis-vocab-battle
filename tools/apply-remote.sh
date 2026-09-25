#!/usr/bin/env bash
# 本番の Supabase（miacis-vocab-battle）に DB と設定を反映し、公開用の anon key を web/js/config.js に入れる。
# 本人が自分の Mac で実行する（DB パスワードはキーチェーン、Supabase CLI はログイン済みが前提）。
# 何度実行してもよい（済んだ migration と seed は飛ばされる）。
set -euo pipefail
cd "$(dirname "$0")/.."
REF=aljlbxvucscmpbcuccin
CLI=(npx --yes supabase@2.117.0)

export SUPABASE_DB_PASSWORD="$(security find-generic-password -a miacis-vocab-battle -s supabase-db-password -w)"

echo "1/4 プロジェクトにつなぐ"
"${CLI[@]}" link --project-ref "$REF" >/dev/null
echo "2/4 ログインの設定（確認メールを送らない・公開 URL）"
"${CLI[@]}" config push --project-ref "$REF" --yes >/dev/null
echo "3/4 DB（テーブル・権限・関数）と単語 2,642 語・定期の仕事"
"${CLI[@]}" db push --include-seed --yes
echo "4/4 公開用の anon key を web/js/config.js に入れる（鍵は画面に出さない）"
KEY="$("${CLI[@]}" projects api-keys --project-ref "$REF" -o json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=JSON.parse(s).find(k=>k.name==="anon");if(!k)process.exit(1);process.stdout.write(k.api_key)})')"
node -e 'const fs=require("fs");const p="web/js/config.js";const s=fs.readFileSync(p,"utf8");fs.writeFileSync(p,s.replace("__ANON_KEY__",process.argv[1]))' "$KEY"
unset SUPABASE_DB_PASSWORD KEY
echo "完了"
