/**
 * backend-supabase.js - 本番の Supabase に話す。関数の中身は supabase/migrations/0030_quiz.sql
 * 遊ぶ人: 公式LINE から開き、LINE ログイン（LIFF）→ サーバーで ID トークンを確かめてクイズのセッションを受け取る。
 *         Supabase のログインは使わない（英単語アプリのログインとは別）。
 * スタッフ: 英単語アプリと同じニックネーム＋あいことば。同じサイトなので、英単語アプリでログイン中ならそのまま入れる。
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../js/config.js';
import { nicknameToEmail } from '../../js/logic.js';

export const isDemo = false;
export const LIFF_ID = '2011955776-yNs3e6Lq';
const LIFF_SDK = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
const TOKEN_KEY = 'miacis-quiz-session';
const BUCKET = 'quiz-images';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function call(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function setToken(t) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* 保存できない端末 */ }
}

function loadLiff() {
  if (window.liff) return Promise.resolve(window.liff);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIFF_SDK;
    s.onload = () => resolve(window.liff);
    s.onerror = () => reject(new Error('Failed to fetch'));
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------- 遊ぶ人

/** クイズのセッションを用意する。無ければ LINE でログインする（LINE の外では LINE のログイン画面へ移る） */
export async function ensureSession() {
  if (getToken()) {
    try { await call('quiz_me', { p_token: getToken() }); return; } catch { setToken(''); }
  }
  const liff = await loadLiff();
  await liff.init({ liffId: LIFF_ID });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    await new Promise(() => {}); // ログイン画面へ移るので、ここから先は進まない
  }
  try {
    const r = await call('quiz_line_login', { p_id_token: liff.getIDToken() });
    setToken(r.token);
  } catch (e) {
    // ID トークンの期限切れ。一度だけログインし直す
    if (!sessionStorage.getItem('quiz-relogin')) {
      sessionStorage.setItem('quiz-relogin', '1');
      liff.logout();
      liff.login({ redirectUri: location.href });
      await new Promise(() => {});
    }
    throw e;
  }
  sessionStorage.removeItem('quiz-relogin');
}

export async function me() {
  const r = await call('quiz_me', { p_token: getToken() });
  return r.nickname ? r : null;
}

export const register = (nickname) => call('quiz_register', { p_token: getToken(), p_nickname: nickname });
export const listQuizzes = () => call('quiz_list', { p_token: getToken() });
export const startAttempt = (setId) => call('quiz_start', { p_token: getToken(), p_set: setId });
export const nextQuestion = (attemptId) => call('quiz_next', { p_token: getToken(), p_attempt: attemptId });
export const answer = (attemptId, choice) => call('quiz_answer', { p_token: getToken(), p_attempt: attemptId, p_choice: choice });
export const ranking = (setId) => call('quiz_ranking', { p_set: setId, p_token: getToken() });
export const myCoupons = () => call('quiz_my_coupons', { p_token: getToken() });
export const myAnswers = (setId) => call('quiz_my_answers', { p_token: getToken(), p_set: setId });

export function imageUrl(path) {
  if (!path) return null;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** 公式LINE で送るリンク。LINE の中で開くとそのまま LINE ログインになる */
export function shareUrl(setId) {
  return `https://liff.line.me/${LIFF_ID}?quiz=${encodeURIComponent(setId)}`;
}

// ---------------------------------------------------------------- スタッフ

export async function adminSignIn(nickname, passphrase) {
  const email = nicknameToEmail(nickname);
  let res = await sb.auth.signInWithPassword({ email, password: passphrase });
  if (res.error && passphrase.trim() !== passphrase) {
    res = await sb.auth.signInWithPassword({ email, password: passphrase.trim() });
  }
  check(res);
  if (!(await call('quiz_is_admin'))) {
    await sb.auth.signOut();
    throw new Error('not_admin');
  }
}

export async function adminSession() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return false;
  return Boolean(await call('quiz_is_admin'));
}

export async function adminSignOut() {
  await sb.auth.signOut();
}

export async function listQuestions() {
  return check(await sb.from('quiz_questions').select('*').order('created_at', { ascending: false }));
}

export async function saveQuestion(q) {
  const row = { body: q.body, choices: q.choices, answer: q.answer, tag: q.tag, image_path: q.image_path,
    kind: q.kind ?? 'quiz', updated_at: new Date().toISOString() };
  if (q.id) return check(await sb.from('quiz_questions').update(row).eq('id', q.id).select().single());
  return check(await sb.from('quiz_questions').insert(row).select().single());
}

export async function saveQuestions(list) {
  return check(await sb.from('quiz_questions').insert(list).select());
}

export async function deleteQuestion(id) {
  check(await sb.from('quiz_questions').delete().eq('id', id));
}

/** 画像（Blob）を置いて、置き場のパスを返す */
export async function uploadImage(blob) {
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false }));
  return path;
}

export async function listAdminQuizzes() {
  const sets = check(await sb.from('quiz_sets').select('*').order('created_at', { ascending: false }));
  const items = check(await sb.from('quiz_set_items').select('set_id, question_id, position').order('position'));
  return sets.map((z) => ({ ...z, question_ids: items.filter((i) => i.set_id === z.id).map((i) => i.question_id) }));
}

export async function saveQuiz(z) {
  const row = { title: z.title, time_limit_sec: z.time_limit_sec, prize: z.prize, coupon_url: z.coupon_url, closes_at: z.closes_at };
  if (z.id) return check(await sb.from('quiz_sets').update(row).eq('id', z.id).select().single());
  return check(await sb.from('quiz_sets').insert(row).select().single());
}

export const setQuizQuestions = (setId, ids) => call('quiz_set_questions', { p_set: setId, p_questions: ids });
export const openQuiz = (setId) => call('quiz_open', { p_set: setId });
export const closeQuiz = (setId) => call('quiz_close', { p_set: setId });
export async function deleteQuiz(setId) {
  check(await sb.from('quiz_sets').delete().eq('id', setId));
}
export const useCoupon = (code) => call('quiz_use_coupon', { p_code: code });
export const adminCoupons = () => call('quiz_admin_coupons');

// お知らせ（CM）。after_position は「◯問目のあと」（1 始まり）
export async function listBreaks(setId) {
  return check(await sb.from('quiz_breaks').select('*').eq('set_id', setId).order('after_position'));
}
export async function saveBreak(b) {
  const row = { set_id: b.quiz_id, after_position: b.after_position, title: b.title, body: b.body,
    image_path: b.image_path, link_url: b.link_url, seconds: b.seconds };
  const res = b.id ? await sb.from('quiz_breaks').update(row).eq('id', b.id) : await sb.from('quiz_breaks').insert(row);
  if (res.error?.code === '23505') throw new Error('break_taken');
  check(res);
}
export async function deleteBreak(id) {
  check(await sb.from('quiz_breaks').delete().eq('id', id));
}
