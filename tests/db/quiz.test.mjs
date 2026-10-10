// 0030: Miacis クイズ（LINE ログイン・問題ストック・時間制限・ランキング・1位にクーポン）
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, asUser, asAnon, asAdmin } from './helper.mjs';

const STAFF = '00000000-0000-0000-0000-00000000000a';
const STUDENT = '00000000-0000-0000-0000-00000000000b'; // 英単語アプリの生徒（スタッフではない）

let db;
const T = {}; // 名前 → クイズのセッション

// 本番は LINE のサーバーで ID トークンを確かめる。テストでは「line-<sub>」を通すだけにする
const STUB_VERIFY = `
create or replace function public.quiz_line_verify(p_id_token text) returns text
language plpgsql as $$
begin
  if p_id_token not like 'line-%' then raise exception 'line_login_failed'; end if;
  return substr(p_id_token, 6);
end; $$;`;

const anon = async (sql, params = []) => asAnon(db, async () => (await db.query(sql, params)).rows);
const anon1 = async (sql, params) => Object.values((await anon(sql, params))[0])[0];
const staff = async (sql, params = []) => asUser(db, STAFF, async () => (await db.query(sql, params)).rows);
const staff1 = async (sql, params) => Object.values((await staff(sql, params))[0])[0];
const rejects = (p, code) => assert.rejects(p, (e) => e.message.includes(code));

async function login(sub, nickname) {
  const r = await anon1('select public.quiz_line_login($1)', [`line-${sub}`]);
  if (nickname) await anon1('select public.quiz_register($1, $2)', [r.token, nickname]);
  return r.token;
}

async function makeQuiz(title, n, { limit = 10, prize = '購買で使えるクーポン', url = 'https://lin.ee/coupon-x' } = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = await staff('insert into public.quiz_questions (body, choices, answer) values ($1, $2, 0) returning id',
      [`${title} Q${i + 1}`, [`正${i}`, `誤a${i}`, `誤b${i}`, `誤c${i}`]]);
    ids.push(r[0].id);
  }
  const z = (await staff('insert into public.quiz_sets (title, time_limit_sec, prize, coupon_url) values ($1, $2, $3, $4) returning id',
    [title, limit, prize, url]))[0].id;
  await staff('select public.quiz_set_questions($1, $2)', [z, ids]);
  return z;
}

// 画面に出た選択肢から正解（"正" で始まる）を探して答える
async function play(token, set, { wrongAt = [] } = {}) {
  const s = await anon1('select public.quiz_start($1, $2)', [token, set]);
  for (;;) {
    const q = await anon1('select public.quiz_next($1, $2)', [token, s.attempt_id]);
    if (q.done) return q;
    let pick = q.choices.findIndex((c) => c.startsWith('正'));
    if (wrongAt.includes(q.position)) pick = (pick + 1) % 4;
    await anon1('select public.quiz_answer($1, $2, $3)', [token, s.attempt_id, pick]);
  }
}

before(async () => {
  db = await createTestDb();
  await db.exec(STUB_VERIFY);
  await createUser(db, STAFF);
  await createUser(db, STUDENT);
  await asAdmin(db, () => db.query('insert into public.staff (user_id) values ($1)', [STAFF]));
  T.aoi = await login('U-aoi', 'あおい');
  T.ren = await login('U-ren', 'Ren');
  T.sora = await login('U-sora', 'そら');
});

test('LINE でログインするとセッションが返る。同じ LINE なら同じ人（名前を覚えている）', async () => {
  const first = await anon1('select public.quiz_line_login($1)', ['line-U-new']);
  assert.equal(first.nickname, null);
  assert.match(first.token, /^[0-9a-f]{64}$/);
  await anon1('select public.quiz_register($1, $2)', [first.token, 'はると']);
  const again = await anon1('select public.quiz_line_login($1)', ['line-U-new']);
  assert.equal(again.nickname, 'はると');
  assert.notEqual(again.token, first.token);
  assert.equal((await anon1('select public.quiz_me($1)', [first.token])).nickname, 'はると');
  await rejects(anon1('select public.quiz_line_login($1)', ['forged']), 'line_login_failed');
  await rejects(anon1('select public.quiz_me($1)', ['nope']), 'not_signed_in');
  // セッションは sha256 だけを持つ
  const stored = await asAdmin(db, async () => (await db.query('select token_hash from public.quiz_sessions')).rows.map((r) => r.token_hash));
  assert.ok(!stored.includes(first.token));
});

test('名前は他の人と重ならない（大文字小文字は同じ扱い）・1〜12文字', async () => {
  const t = await login('U-x');
  await rejects(anon1('select public.quiz_register($1, $2)', [t, 'ren']), 'nickname_taken');
  await rejects(anon1('select public.quiz_register($1, $2)', [t, '   ']), 'bad_nickname');
  await rejects(anon1('select public.quiz_register($1, $2)', [t, '1234567890123']), 'bad_nickname');
  assert.equal((await anon1('select public.quiz_register($1, $2)', [t, '  みお  '])).nickname, 'みお');
});

test('名前が無いと挑戦できない', async () => {
  const z = await makeQuiz('名前', 1);
  await staff1('select public.quiz_open($1)', [z]);
  const t = await login('U-noname');
  await rejects(anon1('select public.quiz_start($1, $2)', [t, z]), 'no_nickname');
});

test('遊ぶ人も英単語の生徒も、問題（正解つき）・セッション・LINE の ID を読めない', async () => {
  await makeQuiz('見えない', 1);
  for (const sql of ['select * from public.quiz_questions', 'select * from public.quiz_players',
    'select * from public.quiz_sessions', 'select * from public.quiz_attempts', 'select * from public.quiz_coupons']) {
    await rejects(anon(sql), 'permission denied');
  }
  const asStudent = (sql) => asUser(db, STUDENT, async () => (await db.query(sql)).rows);
  assert.equal((await asStudent('select * from public.quiz_questions')).length, 0);
  assert.equal((await asStudent('select * from public.quiz_sets')).length, 0);
  await rejects(asStudent('select * from public.quiz_players'), 'permission denied');
  await rejects(asStudent("insert into public.quiz_questions (body, choices, answer) values ('x', '{a,b,c,d}', 0)"), 'row-level security');
  await rejects(anon('select public.quiz_line_verify($1)', ['line-x']), 'permission denied');
});

test('スタッフの関数はスタッフしか呼べない。status は直接書き換えられない', async () => {
  const z = await makeQuiz('権限', 1);
  const asStudent = (sql, p) => asUser(db, STUDENT, async () => (await db.query(sql, p)).rows);
  await rejects(asStudent('select public.quiz_open($1)', [z]), 'not_admin');
  await rejects(asStudent('select public.quiz_close($1)', [z]), 'not_admin');
  await rejects(asStudent("select public.quiz_use_coupon('ABCDEF')"), 'not_admin');
  await rejects(asStudent('select public.quiz_admin_coupons()'), 'not_admin');
  await rejects(anon('select public.quiz_open($1)', [z]), 'permission denied');
  await rejects(staff("update public.quiz_sets set status = 'open' where id = $1", [z]), 'permission denied');
  assert.equal(await staff1('select public.quiz_is_admin()'), true);
  assert.equal(await asUser(db, STUDENT, async () => (await db.query('select public.quiz_is_admin() as r')).rows[0].r), false);
});

test('下書きは一覧に出ず、挑戦できない。問題0問は公開できない。URL は https だけ', async () => {
  const z = await makeQuiz('下書き', 2);
  assert.ok(!(await anon1('select public.quiz_list($1)', [T.aoi])).some((q) => q.id === z));
  await rejects(anon1('select public.quiz_start($1, $2)', [T.aoi, z]), 'quiz_not_found');
  const empty = (await staff("insert into public.quiz_sets (title) values ('空') returning id"))[0].id;
  await rejects(staff1('select public.quiz_open($1)', [empty]), 'quiz_empty');
  await rejects(staff("insert into public.quiz_sets (title, coupon_url) values ('x', 'javascript:alert(1)')"), 'check constraint');
});

test('答える前に正解は渡らない。選択肢は並べ替えられ、読み込み直しても同じ。答えると正解の位置が返る', async () => {
  const z = await makeQuiz('出題', 3);
  await staff1('select public.quiz_open($1)', [z]);
  const s = await anon1('select public.quiz_start($1, $2)', [T.aoi, z]);
  const q = await anon1('select public.quiz_next($1, $2)', [T.aoi, s.attempt_id]);
  assert.equal(q.choices.length, 4);
  assert.ok(!('answer' in q));
  assert.ok(q.remaining_ms > 9000 && q.remaining_ms <= 10000);
  const again = await anon1('select public.quiz_next($1, $2)', [T.aoi, s.attempt_id]);
  assert.deepEqual([again.body, again.choices], [q.body, q.choices]);
  // 他人のセッションでは同じ挑戦を触れない
  await rejects(anon1('select public.quiz_next($1, $2)', [T.ren, s.attempt_id]), 'attempt_not_found');
  const right = q.choices.findIndex((c) => c.startsWith('正'));
  const a = await anon1('select public.quiz_answer($1, $2, $3)', [T.aoi, s.attempt_id, (right + 1) % 4]);
  assert.deepEqual([a.correct, a.answer], [false, right]);
  await rejects(anon1('select public.quiz_answer($1, $2, 0)', [T.aoi, s.attempt_id]), 'no_question');
});

test('時間切れ: 制限＋1.5秒を過ぎた答えは不正解。放っておいた問題は次を開いたとき時間切れ', async () => {
  const z = await makeQuiz('時間', 3, { limit: 5 });
  await staff1('select public.quiz_open($1)', [z]);
  const s = await anon1('select public.quiz_start($1, $2)', [T.ren, z]);
  const back = (sec) => asAdmin(db, () => db.query(`update public.quiz_attempts set served_at = now() - interval '${sec} seconds' where id = $1`, [s.attempt_id]));
  const q1 = await anon1('select public.quiz_next($1, $2)', [T.ren, s.attempt_id]);
  await back(7);
  const a1 = await anon1('select public.quiz_answer($1, $2, $3)', [T.ren, s.attempt_id, q1.choices.findIndex((c) => c.startsWith('正'))]);
  assert.deepEqual([a1.timed_out, a1.correct, a1.elapsed_ms], [true, false, 5000]);
  await anon1('select public.quiz_next($1, $2)', [T.ren, s.attempt_id]);
  await back(60);
  const q3 = await anon1('select public.quiz_next($1, $2)', [T.ren, s.attempt_id]);
  assert.equal(q3.position, 2);
  await back(6);
  const a3 = await anon1('select public.quiz_answer($1, $2, $3)', [T.ren, s.attempt_id, q3.choices.findIndex((c) => c.startsWith('正'))]);
  assert.deepEqual([a3.correct, a3.done], [true, true]);
  const r = await anon1('select public.quiz_next($1, $2)', [T.ren, s.attempt_id]);
  assert.deepEqual([r.done, r.correct, r.total, r.total_ms], [true, 1, 3, 15000]);
});

test('1 LINE アカウント1回。ログインし直しても、終えたクイズには挑戦できない', async () => {
  const z = await makeQuiz('一回', 2);
  await staff1('select public.quiz_open($1)', [z]);
  await play(T.aoi, z);
  await rejects(anon1('select public.quiz_start($1, $2)', [T.aoi, z]), 'already_played');
  const relogin = await login('U-aoi');
  await rejects(anon1('select public.quiz_start($1, $2)', [relogin, z]), 'already_played');
});

test('ランキングは正解数→合計時間。締め切ると1位にクーポン（LINE のクーポン URL つき）、スタッフが使用済みにできる', async () => {
  const z = await makeQuiz('本番', 3);
  await staff1('select public.quiz_open($1)', [z]);
  await play(T.aoi, z, { wrongAt: [1] });
  await play(T.ren, z);
  await play(T.sora, z);
  const setMs = (token, ms) => asAdmin(db, () => db.query(
    `update public.quiz_attempts a set total_ms = $3 from public.quiz_sessions s
      where s.token_hash = public.quiz_hash($2) and a.player_id = s.player_id and a.set_id = $1`, [z, token, ms]));
  await setMs(T.sora, 1000);
  await setMs(T.ren, 2000);

  const rank = await anon('select * from public.quiz_ranking($1)', [z]);
  assert.deepEqual(rank.map((r) => [r.rank, r.nickname, r.correct, r.is_me]), [[1, 'そら', 3, false], [2, 'Ren', 3, false], [3, 'あおい', 2, false]]);
  const mine = await anon('select * from public.quiz_ranking($1, $2)', [z, T.aoi]);
  assert.equal(mine.find((r) => r.is_me).nickname, 'あおい');
  // 一覧は名前だけ。LINE の ID は出ない
  assert.ok(!JSON.stringify(rank).includes('U-sora'));

  const closed = await staff1('select public.quiz_close($1)', [z]);
  assert.equal(closed.winner, 'そら');
  assert.match(closed.code, /^[A-HJKMNP-Z2-9]{6}$/);
  await rejects(staff1('select public.quiz_close($1)', [z]), 'quiz_not_open');

  assert.equal((await anon1('select public.quiz_my_coupons($1)', [T.aoi])).length, 0);
  const [c] = await anon1('select public.quiz_my_coupons($1)', [T.sora]);
  assert.deepEqual([c.code, c.prize, c.coupon_url, c.used_at], [closed.code, '購買で使えるクーポン', 'https://lin.ee/coupon-x', null]);

  const used = await staff1('select public.quiz_use_coupon($1)', [` ${closed.code.toLowerCase()} `]);
  assert.equal(used.nickname, 'そら');
  await rejects(staff1('select public.quiz_use_coupon($1)', [closed.code]), 'coupon_used');
  await rejects(staff1("select public.quiz_use_coupon('ZZZZZZ')"), 'coupon_not_found');
  assert.ok((await anon1('select public.quiz_my_coupons($1)', [T.sora]))[0].used_at);
});

test('だれも終えていないクイズを締め切ると、クーポンは出ない', async () => {
  const z = await makeQuiz('無人', 1);
  await staff1('select public.quiz_open($1)', [z]);
  await anon1('select public.quiz_start($1, $2)', [T.ren, z]);
  assert.equal((await staff1('select public.quiz_close($1)', [z])).winner, null);
});

test('公開したクイズは消せず、その問題もストックから消せない。下書きは消せる', async () => {
  const z = await makeQuiz('消す', 1);
  const qid = (await staff('select question_id from public.quiz_set_items where set_id = $1', [z]))[0].question_id;
  await staff1('select public.quiz_open($1)', [z]);
  assert.equal((await staff('delete from public.quiz_sets where id = $1 returning id', [z])).length, 0);
  await rejects(staff('delete from public.quiz_questions where id = $1', [qid]), 'foreign key');
  await rejects(staff1("select public.quiz_set_questions($1, '{}')", [z]), 'quiz_not_draft');
  const d = await makeQuiz('下書き消す', 1);
  assert.equal((await staff('delete from public.quiz_sets where id = $1 returning id', [d])).length, 1);
});

test('一覧に自分の成績と参加人数が出る（ログイン前でも一覧は見える）', async () => {
  const z = await makeQuiz('一覧', 2);
  await staff1('select public.quiz_open($1)', [z]);
  await play(T.ren, z, { wrongAt: [0] });
  const item = (await anon1('select public.quiz_list($1)', [T.ren])).find((q) => q.id === z);
  assert.deepEqual([item.status, item.total, item.players, item.my_correct, item.my_finished], ['open', 2, 1, 1, true]);
  const guest = (await anon1('select public.quiz_list()')).find((q) => q.id === z);
  assert.equal(guest.my_started, false);
});
