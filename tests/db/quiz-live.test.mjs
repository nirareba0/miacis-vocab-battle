// 0031: 締め切り（自動で閉じて1位に LINE で知らせる）・1問ごとの早押しトップ5・お知らせ（CM）・自分の全問の記録
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, asUser, asAnon, asAdmin } from './helper.mjs';

const STAFF = '00000000-0000-0000-0000-0000000000aa';
let db;
const T = {};

const STUBS = `
create or replace function public.quiz_line_verify(p_id_token text) returns text
language plpgsql as $$ begin return substr(p_id_token, 6); end; $$;
create table public.test_pushes (to_ text, text_ text);
create or replace function public.quiz_line_push(p_to text, p_text text) returns text
language plpgsql as $$ begin insert into public.test_pushes values (p_to, p_text); return 'sent'; end; $$;`;

const anon1 = async (sql, params = []) => asAnon(db, async () => Object.values((await db.query(sql, params)).rows[0])[0]);
const anonRows = async (sql, params = []) => asAnon(db, async () => (await db.query(sql, params)).rows);
const staff = async (sql, params = []) => asUser(db, STAFF, async () => (await db.query(sql, params)).rows);
const root = async (sql, params = []) => asAdmin(db, async () => (await db.query(sql, params)).rows);
const rejects = (p, code) => assert.rejects(p, (e) => e.message.includes(code));

async function login(sub, nickname) {
  const r = await anon1('select public.quiz_line_login($1)', [`line-${sub}`]);
  await anon1('select public.quiz_register($1, $2)', [r.token, nickname]);
  return r.token;
}

async function makeQuiz(title, n, closesSql = null) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    ids.push((await staff('insert into public.quiz_questions (body, choices, answer) values ($1, $2, 0) returning id',
      [`${title} Q${i + 1}`, [`正${i}`, `誤a${i}`, `誤b${i}`, `誤c${i}`]]))[0].id);
  }
  const z = (await staff(`insert into public.quiz_sets (title, prize, coupon_url, closes_at)
    values ($1, '購買で使えるクーポン', 'https://lin.ee/c', ${closesSql ?? 'null'}) returning id`, [title]))[0].id;
  await staff('select public.quiz_set_questions($1, $2)', [z, ids]);
  await staff('select public.quiz_open($1)', [z]);
  return z;
}

async function play(token, set, { wrongAt = [] } = {}) {
  const s = await anon1('select public.quiz_start($1, $2)', [token, set]);
  const answers = [];
  for (;;) {
    const q = await anon1('select public.quiz_next($1, $2)', [token, s.attempt_id]);
    if (q.done) return { done: q, answers };
    let pick = q.choices.findIndex((c) => c.startsWith('正'));
    if (wrongAt.includes(q.position)) pick = (pick + 1) % 4;
    answers.push(await anon1('select public.quiz_answer($1, $2, $3)', [token, s.attempt_id, pick]));
  }
}

before(async () => {
  db = await createTestDb();
  await db.exec(STUBS);
  await createUser(db, STAFF);
  await root('insert into public.staff (user_id) values ($1)', [STAFF]);
  T.a = await login('U-a', 'あおい');
  T.b = await login('U-b', 'Ren');
  T.c = await login('U-c', 'そら');
});

test('答えると、この問題の正解率と早押しトップ5（自分の行つき）が返る', async () => {
  const z = await makeQuiz('早押し', 2);
  await play(T.a, z);
  const { answers } = await play(T.b, z, { wrongAt: [0] });
  const b0 = answers[0].board;
  assert.equal(b0.answered, 2);
  assert.equal(b0.correct_rate, 50);
  assert.deepEqual(b0.fastest.map((f) => [f.nickname, f.is_me]), [['あおい', false]]);
  assert.equal(answers[1].board.fastest.length, 2);
  assert.ok(answers[1].board.fastest.some((f) => f.is_me && f.nickname === 'Ren'));
  assert.equal(typeof b0.fastest[0].ms, 'number');
  // 早押しの表に LINE の ID は出ない
  assert.ok(!JSON.stringify(answers).includes('U-a'));
});

test('自分の全問の記録（○×と秒）', async () => {
  const z = await makeQuiz('記録', 3);
  await play(T.c, z, { wrongAt: [1] });
  const mine = await anon1('select public.quiz_my_answers($1, $2)', [T.c, z]);
  assert.deepEqual(mine.map((m) => [m.position, m.correct]), [[0, true], [1, false], [2, true]]);
  assert.ok(mine.every((m) => typeof m.ms === 'number'));
  assert.equal((await anon1('select public.quiz_my_answers($1, $2)', [T.a, z])).length, 0);
});

test('お知らせ（CM）: 「◯問目のあと」に入れたものが、その問題に答えたときに返る。スタッフしか書けない', async () => {
  const z = await makeQuiz('CM', 3);
  await staff(`insert into public.quiz_breaks (set_id, after_position, title, body, link_url, seconds)
    values ($1, 2, '土曜はボドゲ会', '14時から', 'https://example.com/event', 5)`, [z]);
  const { answers } = await play(T.a, z);
  assert.equal(answers[0].break, null);
  assert.deepEqual([answers[1].break.title, answers[1].break.seconds], ['土曜はボドゲ会', 5]);
  assert.equal(answers[2].break, null);
  await rejects(anonRows('select * from public.quiz_breaks'), 'permission denied');
  await rejects(staff(`insert into public.quiz_breaks (set_id, after_position, title, link_url) values ($1, 1, 'x', 'javascript:1')`, [z]), 'check constraint');
});

test('締め切りを過ぎたら挑戦できない。締め切り後に終えた人は順位に入らない', async () => {
  const z = await makeQuiz('締め切り', 1, "now() + interval '1 hour'");
  await play(T.a, z);
  // b は締め切り前に始めて、締め切り後に終えた
  const s = await anon1('select public.quiz_start($1, $2)', [T.b, z]);
  const q = await anon1('select public.quiz_next($1, $2)', [T.b, s.attempt_id]);
  await root("update public.quiz_sets set closes_at = now() where id = $1", [z]);
  await anon1('select public.quiz_answer($1, $2, $3)', [T.b, s.attempt_id, q.choices.findIndex((c) => c.startsWith('正'))]);
  await root("update public.quiz_attempts set finished_at = now() + interval '1 second' where id = $1", [s.attempt_id]);
  await rejects(anon1('select public.quiz_start($1, $2)', [T.c, z]), 'quiz_closed');
  const rank = await anonRows('select * from public.quiz_ranking($1)', [z]);
  assert.deepEqual(rank.map((r) => r.nickname), ['あおい']);
  const item = (await anon1('select public.quiz_list($1)', [T.a])).find((x) => x.id === z);
  assert.equal(item.players, 1);
  assert.ok(item.closes_at);
});

test('締め切り時刻を過ぎると自動で閉じ、1位にクーポン。LINE で1位の人に送る', async () => {
  await root('select public.quiz_close_due()'); // 前のテストで締め切りを過ぎたクイズを先に閉じておく
  await root('delete from public.test_pushes');
  const z = await makeQuiz('自動', 2, "now() + interval '1 hour'");
  await play(T.a, z, { wrongAt: [0] });
  await play(T.c, z);
  assert.equal((await root('select public.quiz_close_due() as n'))[0].n, 0);
  await root("update public.quiz_sets set closes_at = now() where id = $1", [z]);
  assert.ok((await root('select public.quiz_close_due() as n'))[0].n >= 1);
  const status = (await root('select status from public.quiz_sets where id = $1', [z]))[0].status;
  assert.equal(status, 'closed');
  const [c] = await anon1('select public.quiz_my_coupons($1)', [T.c]);
  assert.equal(c.coupon_url, 'https://lin.ee/c');
  const pushes = await root('select * from public.test_pushes');
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].to_, 'U-c');
  assert.match(pushes[0].text_, /自動.*1位/);
  assert.match(pushes[0].text_, /https:\/\/lin\.ee\/c/);
  assert.match(pushes[0].text_, new RegExp(c.code));
  const admin = await staff('select public.quiz_admin_coupons() as r');
  assert.equal(admin[0].r.find((x) => x.code === c.code).push_status, 'sent');
  // 2回目は何もしない
  assert.equal((await root('select public.quiz_close_due() as n'))[0].n, 0);
});

test('LINE に送れなくても、締め切りとクーポンは止まらない', async () => {
  await root(`create or replace function public.quiz_line_push(p_to text, p_text text) returns text
    language plpgsql as $$ begin raise exception 'boom'; end; $$`);
  const z = await makeQuiz('送れない', 1);
  await play(T.b, z);
  const r = (await staff('select public.quiz_close($1) as r', [z]))[0].r;
  assert.deepEqual([r.winner, r.push], ['Ren', 'error']);
  assert.equal((await anon1('select public.quiz_my_coupons($1)', [T.b])).length >= 1, true);
});

test('締め切りの関数と LINE に送る関数は、端末から呼べない', async () => {
  await rejects(anonRows('select public.quiz_close_due()'), 'permission denied');
  await rejects(anonRows("select public.quiz_line_push('U-a', 'x')"), 'permission denied');
  await rejects(staff("select public.quiz_line_push('U-a', 'x')"), 'permission denied');
  await rejects(staff('select public.quiz_close_internal(gen_random_uuid())'), 'permission denied');
});
