/**
 * backend-demo.js - 手元の確認用（localhost で ?demo）。この端末の localStorage だけで動く。
 * 本番（supabase/migrations/0030_quiz.sql）と同じ決まりで動かす: 正解は答えるまで渡さない・1人1回・
 * 制限時間＋1.5秒の猶予・正解数→合計時間の順・締め切ると1位にクーポン。
 * 見本のクイズと、ランキングが空に見えないための見本の参加者を最初に入れる。
 */
import { GRACE_MS } from './logic.js';

export const isDemo = true;

const KEY = 'miacis-quiz-demo-v2';
const ME = 'me';
const now = () => Date.now();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

function sampleImage(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<rect width="640" height="360" fill="${color}"/><circle cx="520" cy="80" r="120" fill="#fff" opacity=".25"/>
<text x="320" y="200" font-size="96" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">${label}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function seed() {
  const t = now();
  const qs = [
    ['Miacis がある市は？', '韮崎市', '甲府市', '北杜市', '南アルプス市', '地元', sampleImage('?', '#6b5bd6')],
    ['「ありがとう」を英語で言うと？', 'Thank you', 'Sorry', 'Hello', 'Goodbye', '英語', null],
    ['1日は何時間？', '24時間', '12時間', '36時間', '48時間', 'くらし', null],
    ['富士山の高さに一番近いのは？', '3776m', '2776m', '4776m', '1776m', '地元', sampleImage('🗻', '#2f8fd8')],
    ['信号の「止まれ」は何色？', '赤', '青', '黄', '白', 'くらし', null]
  ].map(([body, c, w1, w2, w3, tag, img], i) => ({
    id: uid(), body, choices: [c, w1, w2, w3], answer: 0, tag, image_path: img,
    created_at: new Date(t - (10 - i) * 60000).toISOString()
  }));
  const quizId = uid();
  const fakes = [['はると', 4, 21500], ['みお', 3, 18200], ['スタッフK', 5, 33900]];
  const players = { [ME]: null };
  const attempts = [];
  fakes.forEach(([nick, correct, ms], i) => {
    const id = `fake${i}`;
    players[id] = nick;
    // 1問ごとの記録（早押しトップ5に出す）。正解は前から correct 問、時間は合計を5で割ってばらす
    const answers = qs.map((q, k) => ({ question_id: q.id, choice: k < correct ? 0 : 1, is_correct: k < correct,
      elapsed_ms: Math.round(ms / 5 * (0.6 + 0.2 * ((k + i) % 4))), answered_at: t - (i + 1) * 3600000 }));
    attempts.push({ id: uid(), quiz_id: quizId, user_id: id, position: 5, served_at: null, order: null,
      correct, total_ms: answers.reduce((x, y) => x + y.elapsed_ms, 0), finished_at: t - (i + 1) * 3600000, answers });
  });
  return {
    players,
    questions: qs,
    quizzes: [{ id: quizId, title: '見本: Miacis ウォームアップ', time_limit_sec: 15, prize: '購買で使えるクーポン',
      coupon_url: 'https://example.com/line-coupon', closes_at: new Date(t + 3 * 3600000).toISOString(),
      status: 'open', opened_at: new Date(t - 86400000).toISOString(), closed_at: null,
      created_at: new Date(t - 86400000).toISOString(), question_ids: qs.map((q) => q.id) }],
    attempts,
    coupons: [],
    breaks: [{ id: uid(), quiz_id: quizId, after_position: 2, title: '土曜はボードゲーム会', body: '14:00から Miacis の2階で。だれでも参加OK',
      image_path: sampleImage('🎲', '#e5753a'), link_url: null, seconds: 5 }]
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.quizzes) { s.breaks ||= []; return s; }
  } catch { /* 壊れていたら作り直す */ }
  const s = seed();
  save(s);
  return s;
}
function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 容量切れ */ throw new Error('この端末にもう保存できない（画像を減らしてね）'); }
}
const fail = (code) => { throw new Error(code); };
const shuffle = () => [0, 1, 2, 3].sort(() => Math.random() - 0.5);

function sortAttempts(list) {
  return list.filter((a) => a.finished_at)
    .sort((a, b) => b.correct - a.correct || a.total_ms - b.total_ms || a.finished_at - b.finished_at);
}

const isPast = (z) => Boolean(z.closes_at) && new Date(z.closes_at).getTime() <= now();
const inTime = (z) => (a) => a.finished_at && (!z.closes_at || a.finished_at <= new Date(z.closes_at).getTime());

// 締め切って1位にクーポン（本番の quiz_close_internal と同じ）。お試しでは LINE には送らない
function closeInternal(s, z) {
  if (z.status !== 'open') fail('quiz_not_open');
  z.status = 'closed';
  z.closed_at = new Date().toISOString();
  const [w] = sortAttempts(s.attempts.filter((a) => a.quiz_id === z.id).filter(inTime(z)));
  if (!w) return { winner: null };
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  s.coupons.push({ code, quiz_id: z.id, user_id: w.user_id, prize: z.prize, coupon_url: z.coupon_url ?? null,
    issued_at: new Date().toISOString(), used_at: null, push_status: 'demo' });
  return { winner: s.players[w.user_id], code, prize: z.prize, push: 'demo' };
}

// 締め切り時刻を過ぎたものを閉じる（本番は pg_cron が毎分）
function closeDue(s) {
  s.quizzes.filter((z) => z.status === 'open' && isPast(z)).forEach((z) => closeInternal(s, z));
}

function questionAt(s, a) {
  const z = s.quizzes.find((q) => q.id === a.quiz_id);
  return s.questions.find((q) => q.id === z.question_ids[a.position]);
}

function record(s, a, choice, elapsed) {
  const z = s.quizzes.find((q) => q.id === a.quiz_id);
  const q = questionAt(s, a);
  const ok = choice !== null && choice === q.answer;
  a.answers.push({ question_id: q.id, choice, is_correct: ok, elapsed_ms: elapsed, answered_at: now() });
  a.position += 1;
  a.served_at = null;
  a.order = null;
  if (ok) a.correct += 1;
  a.total_ms += elapsed;
  if (a.position >= z.question_ids.length) a.finished_at = now();
  return ok;
}

// ---------------------------------------------------------------- 遊ぶ人

export async function ensureSession() { load(); }

export async function me() {
  const nick = load().players[ME];
  return nick ? { nickname: nick } : null;
}

export async function register(nickname) {
  const s = load();
  const nick = String(nickname ?? '').replace(/\s+/g, ' ').trim();
  if (nick.length < 1 || nick.length > 12) fail('bad_nickname');
  if (Object.entries(s.players).some(([id, n]) => id !== ME && n && n.toLowerCase() === nick.toLowerCase())) fail('nickname_taken');
  s.players[ME] = nick;
  save(s);
  return { nickname: nick };
}

export async function listQuizzes() {
  const s = load();
  closeDue(s);
  save(s);
  return s.quizzes.filter((z) => z.status !== 'draft')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || String(b.opened_at).localeCompare(String(a.opened_at)))
    .map((z) => {
      const mine = s.attempts.find((a) => a.quiz_id === z.id && a.user_id === ME);
      return {
        id: z.id, title: z.title, time_limit_sec: z.time_limit_sec, prize: z.prize, status: z.status,
        opened_at: z.opened_at, closed_at: z.closed_at, closes_at: z.closes_at ?? null, total: z.question_ids.length,
        players: s.attempts.filter((a) => a.quiz_id === z.id).filter(inTime(z)).length,
        my_correct: mine?.correct ?? null, my_finished: Boolean(mine?.finished_at), my_started: Boolean(mine)
      };
    });
}

export async function startAttempt(quizId) {
  const s = load();
  if (!s.players[ME]) fail('no_nickname');
  const z = s.quizzes.find((q) => q.id === quizId);
  if (!z || z.status === 'draft') fail('quiz_not_found');
  let a = s.attempts.find((x) => x.quiz_id === quizId && x.user_id === ME);
  if (a?.finished_at) fail('already_played');
  if (z.status !== 'open' || isPast(z)) fail('quiz_closed');
  if (!z.question_ids.length) fail('quiz_empty');
  if (!a) {
    a = { id: uid(), quiz_id: quizId, user_id: ME, position: 0, served_at: null, order: null,
      correct: 0, total_ms: 0, finished_at: null, answers: [] };
    s.attempts.push(a);
    save(s);
  }
  return { attempt_id: a.id, total: z.question_ids.length, position: a.position, time_limit_sec: z.time_limit_sec, title: z.title };
}

export async function nextQuestion(attemptId) {
  const s = load();
  const a = s.attempts.find((x) => x.id === attemptId && x.user_id === ME) ?? fail('attempt_not_found');
  const z = s.quizzes.find((q) => q.id === a.quiz_id);
  const limit = z.time_limit_sec * 1000;
  const total = z.question_ids.length;
  if (a.served_at && now() - a.served_at > limit + GRACE_MS) record(s, a, null, limit);
  if (a.finished_at || a.position >= total) {
    save(s);
    return { done: true, correct: a.correct, total, total_ms: a.total_ms };
  }
  if ((z.status !== 'open' || isPast(z)) && !a.served_at) fail('quiz_closed');
  const q = questionAt(s, a);
  if (!a.served_at) { a.served_at = now(); a.order = shuffle(); }
  save(s);
  return {
    done: false, position: a.position, total, body: q.body, image_path: q.image_path,
    choices: a.order.map((o) => q.choices[o]), time_limit_sec: z.time_limit_sec,
    remaining_ms: Math.max(0, limit - (now() - a.served_at))
  };
}

export async function answer(attemptId, choice) {
  const s = load();
  const a = s.attempts.find((x) => x.id === attemptId && x.user_id === ME) ?? fail('attempt_not_found');
  if (a.finished_at) fail('already_played');
  if (!a.served_at) fail('no_question');
  const z = s.quizzes.find((q) => q.id === a.quiz_id);
  const limit = z.time_limit_sec * 1000;
  let elapsed = now() - a.served_at;
  const timedOut = choice === null || elapsed > limit + GRACE_MS;
  elapsed = timedOut ? limit : Math.min(elapsed, limit);
  const order = a.order;
  const q = questionAt(s, a);
  const position = a.position;
  const ok = record(s, a, timedOut ? null : order[choice], elapsed);
  save(s);
  // この問題の正解率と早押しトップ5（本番の quiz_answer と同じ）
  const all = s.attempts.filter((x) => x.quiz_id === a.quiz_id)
    .flatMap((x) => x.answers.filter((y) => y.question_id === q.id).map((y) => ({ ...y, user_id: x.user_id })));
  const fastest = all.filter((y) => y.is_correct).sort((x, y) => x.elapsed_ms - y.elapsed_ms || x.answered_at - y.answered_at)
    .slice(0, 5).map((y) => ({ nickname: s.players[y.user_id], ms: y.elapsed_ms, is_me: y.user_id === ME }));
  const board = { answered: all.length, correct_rate: Math.round(100 * all.filter((y) => y.is_correct).length / Math.max(all.length, 1)), fastest };
  const b = s.breaks.find((x) => x.quiz_id === a.quiz_id && x.after_position === position + 1);
  return {
    correct: ok, timed_out: timedOut, answer: order.indexOf(q.answer), elapsed_ms: elapsed, done: Boolean(a.finished_at),
    position, board,
    break: b ? { title: b.title, body: b.body, image_path: b.image_path, link_url: b.link_url, seconds: b.seconds } : null
  };
}

export async function ranking(quizId) {
  const s = load();
  const z = s.quizzes.find((q) => q.id === quizId);
  return sortAttempts(s.attempts.filter((a) => a.quiz_id === quizId).filter(inTime(z))).slice(0, 100).map((a, i) => ({
    rank: i + 1, nickname: s.players[a.user_id], correct: a.correct, total_ms: a.total_ms, is_me: a.user_id === ME
  }));
}

export async function myCoupons() {
  const s = load();
  return s.coupons.filter((c) => c.user_id === ME).map((c) => ({
    code: c.code, prize: c.prize, coupon_url: c.coupon_url ?? null, quiz_title: s.quizzes.find((z) => z.id === c.quiz_id)?.title,
    issued_at: c.issued_at, used_at: c.used_at
  }));
}

export async function myAnswers(quizId) {
  const s = load();
  const a = s.attempts.find((x) => x.quiz_id === quizId && x.user_id === ME);
  return (a?.answers ?? []).map((y, i) => ({ position: i, correct: y.is_correct, ms: y.elapsed_ms, timed_out: y.choice === null }));
}

export function shareUrl(quizId) {
  return new URL(`index.html?demo&quiz=${encodeURIComponent(quizId)}`, location.href).href;
}

export function imageUrl(path) { return path || null; }

// ---------------------------------------------------------------- 管理者（お試しはログインなし）

export async function adminSignIn() {}
export async function adminSession() { return true; }
export async function adminSignOut() {}

export async function listQuestions() {
  return [...load().questions].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function saveQuestion(q) {
  const s = load();
  if (q.id) {
    const cur = s.questions.find((x) => x.id === q.id);
    Object.assign(cur, { body: q.body, choices: q.choices, answer: q.answer, tag: q.tag, image_path: q.image_path });
    save(s);
    return cur;
  }
  const row = { ...q, id: uid(), created_at: new Date().toISOString() };
  s.questions.push(row);
  save(s);
  return row;
}

export async function saveQuestions(list) {
  const s = load();
  const t = Date.now();
  const rows = list.map((q, i) => ({ ...q, id: uid(), created_at: new Date(t + i).toISOString() }));
  s.questions.push(...rows);
  save(s);
  return rows;
}

export async function deleteQuestion(id) {
  const s = load();
  if (s.quizzes.some((z) => z.question_ids.includes(id))) fail('foreign key');
  s.questions = s.questions.filter((q) => q.id !== id);
  save(s);
}

export async function uploadImage(blob) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function listAdminQuizzes() {
  return [...load().quizzes].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function saveQuiz(z) {
  const s = load();
  if (z.id) {
    const cur = s.quizzes.find((x) => x.id === z.id);
    Object.assign(cur, { title: z.title, time_limit_sec: z.time_limit_sec, prize: z.prize, coupon_url: z.coupon_url ?? null, closes_at: z.closes_at ?? null });
    save(s);
    return cur;
  }
  const row = { id: uid(), title: z.title, time_limit_sec: z.time_limit_sec, prize: z.prize, coupon_url: z.coupon_url ?? null, closes_at: z.closes_at ?? null, status: 'draft',
    opened_at: null, closed_at: null, created_at: new Date().toISOString(), question_ids: [] };
  s.quizzes.push(row);
  save(s);
  return row;
}

export async function setQuizQuestions(quizId, ids) {
  const s = load();
  const z = s.quizzes.find((q) => q.id === quizId);
  if (!z || z.status !== 'draft') fail('quiz_not_draft');
  z.question_ids = [...ids];
  save(s);
}

export async function openQuiz(quizId) {
  const s = load();
  const z = s.quizzes.find((q) => q.id === quizId);
  if (!z.question_ids.length) fail('quiz_empty');
  if (z.status !== 'draft') fail('quiz_not_draft');
  z.status = 'open';
  z.opened_at = new Date().toISOString();
  save(s);
}

export async function closeQuiz(quizId) {
  const s = load();
  const r = closeInternal(s, s.quizzes.find((q) => q.id === quizId));
  save(s);
  return r;
}

export async function deleteQuiz(quizId) {
  const s = load();
  const z = s.quizzes.find((q) => q.id === quizId);
  if (z?.status === 'draft') s.quizzes = s.quizzes.filter((q) => q.id !== quizId);
  save(s);
}

export async function useCoupon(code) {
  const s = load();
  const c = s.coupons.find((x) => x.code === String(code).trim().toUpperCase()) ?? fail('coupon_not_found');
  if (c.used_at) fail('coupon_used');
  c.used_at = new Date().toISOString();
  save(s);
  return { code: c.code, prize: c.prize, nickname: s.players[c.user_id], used_at: c.used_at };
}

export async function adminCoupons() {
  const s = load();
  return [...s.coupons].reverse().map((c) => ({
    code: c.code, prize: c.prize, quiz_title: s.quizzes.find((z) => z.id === c.quiz_id)?.title,
    nickname: s.players[c.user_id], issued_at: c.issued_at, used_at: c.used_at, push_status: c.push_status ?? null
  }));
}

export async function listBreaks(quizId) {
  return load().breaks.filter((b) => b.quiz_id === quizId).sort((a, b) => a.after_position - b.after_position);
}

export async function saveBreak(b) {
  const s = load();
  if (s.breaks.some((x) => x.quiz_id === b.quiz_id && x.after_position === b.after_position && x.id !== b.id)) fail('break_taken');
  if (b.id) Object.assign(s.breaks.find((x) => x.id === b.id), b);
  else s.breaks.push({ ...b, id: uid() });
  save(s);
}

export async function deleteBreak(id) {
  const s = load();
  s.breaks = s.breaks.filter((b) => b.id !== id);
  save(s);
}

/** お試しの中身を最初の状態に戻す */
export function resetDemo() {
  localStorage.removeItem(KEY);
}
