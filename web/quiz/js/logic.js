/**
 * logic.js - 画面に依存しない小さな関数（テストは web/tests/logic.test.mjs）
 */

export const GRACE_MS = 1500;

const ERRORS = {
  not_signed_in: 'もう一度ひらき直してね',
  line_login_failed: 'LINE のログインがうまくいかなかった。もう一度ひらいてね',
  no_nickname: '先に名前を決めよう',
  bad_nickname: '名前は1〜12文字',
  nickname_taken: 'その名前はもう使われている',
  quiz_not_found: 'このクイズは見つからない',
  quiz_closed: 'このクイズは締め切った',
  quiz_empty: '問題が1問も入っていない',
  already_played: 'このクイズは挑戦ずみ',
  attempt_not_found: 'もう一度ひらき直してね',
  no_question: 'もう一度ひらき直してね',
  bad_choice: 'もう一度選んでね',
  not_admin: '管理者のアカウントではない',
  quiz_not_draft: '公開したクイズの問題は入れ替えられない',
  quiz_not_open: '公開中のクイズではない',
  coupon_not_found: 'そのコードのクーポンは無い',
  coupon_used: 'そのクーポンは使用済み',
  'Invalid login credentials': 'メールアドレスかパスワードが違う',
  'Failed to fetch': '通信できなかった。電波のいい所でもう一度'
};

/** Supabase / デモのエラーを日本語の1行にする */
export function translateError(err) {
  const msg = String(err?.message ?? err ?? '');
  for (const [key, text] of Object.entries(ERRORS)) {
    if (msg.includes(key)) return text;
  }
  if (msg.includes('foreign key')) return '公開したクイズに入っている問題は消せない';
  return msg || 'うまくいかなかった。もう一度ためしてね';
}

export function normalizeNickname(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** 12345 → "12.3秒" */
export function formatMs(ms) {
  const s = Math.max(0, Number(ms) || 0) / 1000;
  return `${s.toFixed(1)}秒`;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 問題1つの入力を検査して、保存する形（正解を choices[0] に置く）にする */
export function buildQuestion({ body, correct, wrong = [], tag = '', image_path = null }) {
  const b = String(body ?? '').trim();
  const c = String(correct ?? '').trim();
  const w = wrong.map((x) => String(x ?? '').trim());
  if (!b) throw new Error('問題文が空');
  if (b.length > 300) throw new Error('問題文は300文字まで');
  if (!c) throw new Error('正解が空');
  if (w.length !== 3 || w.some((x) => !x)) throw new Error('まちがいの選択肢が3つ要る');
  const all = [c, ...w];
  if (new Set(all).size !== 4) throw new Error('選択肢が重なっている');
  const t = String(tag ?? '').trim();
  return { body: b, choices: all, answer: 0, tag: t || null, image_path: image_path || null };
}

/**
 * まとめて貼り付け。1行1問「問題, 正解, まちがい, まちがい, まちがい[, タグ]」。
 * 区切りはタブ（表計算ソフトからのコピー）かカンマ。空行と # で始まる行は飛ばす。
 * 返り値 { questions, errors: [{ line, message }] }
 */
export function parseBulk(text, defaultTag = '') {
  const questions = [];
  const errors = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim());
    if (cells.length < 5) {
      errors.push({ line: i + 1, message: `区切りが ${cells.length - 1} 個（4個要る）` });
      return;
    }
    try {
      questions.push(buildQuestion({
        body: cells[0], correct: cells[1], wrong: cells.slice(2, 5), tag: cells[5] || defaultTag
      }));
    } catch (e) {
      errors.push({ line: i + 1, message: e.message });
    }
  });
  return { questions, errors };
}

/** ランキングの中の自分の位置から、結果画面の一言を作る */
export function rankSummary(rows) {
  const total = rows.length;
  const me = rows.find((r) => r.is_me);
  if (!me) return null;
  const beaten = total - me.rank;
  return { rank: me.rank, total, beaten };
}

/** 残り時間（ms）→ バーの割合 0〜1 */
export function timerRatio(remainingMs, limitSec) {
  const r = remainingMs / (limitSec * 1000);
  return Math.min(1, Math.max(0, r));
}
