#!/usr/bin/env bash
# 本番の Supabase（miacis-vocab-battle）に DB と設定を反映し、公開用の anon key を web/js/config.js に入れる。
# Mac・Windows（Git Bash）のどちらでも動く。前提は Supabase CLI にログイン済みであること
#   npx --yes supabase@2.117.0 login   （ブラウザが開く。鍵は OS の資格情報ストアに入る）
# DB パスワードは、Mac ならキーチェーン（-a miacis-vocab-battle -s supabase-db-password）から読む。
# 無ければ渡さない（CLI がログインの権限で一時的な DB ロールを作って反映する）。
# 何度実行してもよい（済んだ migration と seed は飛ばされる）。
#   tools/apply-remote.sh --dry-run   … 反映される migration を表示するだけ
set -euo pipefail
cd "$(dirname "$0")/.."
REF=aljlbxvucscmpbcuccin
CLI=(npx --yes supabase@2.117.0)

DRY=""
if [ "${1:-}" = "--dry-run" ]; then DRY="--dry-run"; fi

if [ -z "${SUPABASE_DB_PASSWORD:-}" ] && command -v security >/dev/null 2>&1; then
  SUPABASE_DB_PASSWORD="$(security find-generic-password -a miacis-vocab-battle -s supabase-db-password -w 2>/dev/null || true)"
fi
if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then export SUPABASE_DB_PASSWORD; else unset SUPABASE_DB_PASSWORD; fi

echo "1/4 プロジェクトにつなぐ"
"${CLI[@]}" link --project-ref "$REF" >/dev/null
if [ -n "$DRY" ]; then
  echo "（dry-run）反映される migration:"
  "${CLI[@]}" db push --include-seed --dry-run
  exit 0
fi
echo "2/4 ログインの設定（確認メールを送らない・公開 URL）"
"${CLI[@]}" config push --project-ref "$REF" --yes >/dev/null
echo "3/4 DB（テーブル・権限・関数）と単語 2,642 語・定期の仕事"
"${CLI[@]}" db push --include-seed --yes
echo "4/4 公開用の anon key を web/js/config.js に入れる（鍵は画面に出さない）"
KEY="$("${CLI[@]}" projects api-keys --project-ref "$REF" -o json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=JSON.parse(s).find(k=>k.name==="anon");if(!k)process.exit(1);process.stdout.write(k.api_key)})')"
# 鍵の行（export const SUPABASE_ANON_KEY = '...'）だけを書き換える。isConfigured() の中の '__ANON_KEY__' には触らない。
# すでに鍵が入っていれば何もしない（何度実行してもよい）
node -e 'const fs=require("fs");const p="web/js/config.js";const s=fs.readFileSync(p,"utf8");const re=/^(export const SUPABASE_ANON_KEY = )\x27__ANON_KEY__\x27;$/m;if(re.test(s)){fs.writeFileSync(p,s.replace(re,(_,a)=>a+"\x27"+process.argv[1]+"\x27;"));console.log("  鍵を入れました")}else{console.log("  鍵はもう入っています")}' "$KEY"
unset SUPABASE_DB_PASSWORD KEY
echo "完了"
