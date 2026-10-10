/**
 * logic.js - 画面に依存しない小さな関数（テストは web/tests/logic.test.mjs）
 */

export const GRACE_MS = 1500;

const ERRORS = {
  not_signed_in: 'もう一度ひらき直してね',
  line_login_failed: 'LINE のログインがうまくいかなかった。もう一度ひらいてね',
  no_nickname: '先に名前を決めよう',
  no_student_choice: '中高生か、それ以外かを選んでね',
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
  break_taken: 'その問題のあとには、もうお知らせが入っている',
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
export function buildQuestion({ body, correct, wrong = [], tag = '', image_path = null, kind = 'quiz' }) {
  const b = String(body ?? '').trim();
  const c = String(correct ?? '').trim();
  const w = wrong.map((x) => String(x ?? '').trim());
  if (!b) throw new Error('問題文が空');
  if (b.length > 300) throw new Error('問題文は300文字まで');
  if (!c) throw new Error(kind === 'speed' ? '選択肢1が空' : '正解が空');
  if (w.length !== 3 || w.some((x) => !x)) throw new Error(kind === 'speed' ? '選択肢が4つ要る' : 'まちがいの選択肢が3つ要る');
  const all = [c, ...w];
  if (new Set(all).size !== 4) throw new Error('選択肢が重なっている');
  const t = String(tag ?? '').trim();
  return { body: b, choices: all, answer: 0, tag: t || null, image_path: image_path || null, kind: kind === 'speed' ? 'speed' : 'quiz' };
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

/** 1234 → "1.23秒"（1問ごとの早押しの表示） */
export function formatMs2(ms) {
  const s = Math.max(0, Number(ms) || 0) / 1000;
  return `${s.toFixed(2)}秒`;
}

const two = (n) => String(n).padStart(2, '0');

/** 締め切りの時刻。同じ日なら "15:00"、別の日なら "10/12 15:00"（日本時間） */
export function formatDeadline(iso, now = new Date()) {
  if (!iso) return '';
  const jst = (d) => new Date(new Date(d).getTime() + 9 * 3600 * 1000);
  const d = jst(iso);
  const n = jst(now);
  const hm = `${d.getUTCHours()}:${two(d.getUTCMinutes())}`;
  const sameDay = d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate();
  return sameDay ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`;
}

/** 締め切りまでの残り。"あと1時間5分" / "あと12分" / "あと1分" / 過ぎたら null */
export function remainingLabel(iso, now = new Date()) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - new Date(now).getTime();
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `あと${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `あと${h}時間${m}分` : `あと${h}時間`;
}

/** 締め切りの入力（datetime-local）の初期値: きょうの 15:00。15:00 を過ぎていたらあしたの 15:00（日本時間） */
export function defaultDeadlineInput(now = new Date(), hour = 15) {
  const jst = new Date(new Date(now).getTime() + 9 * 3600 * 1000);
  let y = jst.getUTCFullYear(), mo = jst.getUTCMonth(), d = jst.getUTCDate();
  if (jst.getUTCHours() >= hour) {
    const t = new Date(Date.UTC(y, mo, d + 1));
    y = t.getUTCFullYear(); mo = t.getUTCMonth(); d = t.getUTCDate();
  }
  return `${y}-${two(mo + 1)}-${two(d)}T${two(hour)}:00`;
}

/** datetime-local の値（日本時間とみなす）→ ISO */
export function deadlineInputToIso(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error('締め切りの日時がおかしい');
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5])).toISOString();
}

/** ISO → datetime-local の値（日本時間） */
export function isoToDeadlineInput(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
