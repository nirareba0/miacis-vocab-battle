// 0032: 早押し（正解なし）の問題。どれを押しても正解・並べ替えない・みんなの答えを返す
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, asUser, asAnon, asAdmin } from './helper.mjs';

const STAFF = '00000000-0000-0000-0000-0000000000ab';
let db;
const anon1 = async (sql, params = []) => asAnon(db, async () => Object.values((await db.query(sql, params)).rows[0])[0]);
const staff = async (sql, params = []) => asUser(db, STAFF, async () => (await db.query(sql, params)).rows);

async function login(sub, nickname) {
  const r = await anon1('select public.quiz_line_login($1)', [`line-${sub}`]);
  await anon1('select public.quiz_register($1, $2, true)', [r.token, nickname]);
  return r.token;
}

before(async () => {
  db = await createTestDb();
  await db.exec(`create or replace function public.quiz_line_verify(p_id_token text) returns text
    language plpgsql as $$ begin return substr(p_id_token, 6); end; $$;`);
  await createUser(db, STAFF);
  await asAdmin(db, () => db.query('insert into public.staff (user_id) values ($1)', [STAFF]));
});

test('早押し: 選択肢はそのままの順、どれを押しても正解、みんなの答えが数で返る。ふつうの問題は今までどおり', async () => {
  const quiz = (await staff(`insert into public.quiz_questions (body, choices, answer)
    values ('ふつう', '{正,誤a,誤b,誤c}', 0) returning id`))[0].id;
  const speed = (await staff(`insert into public.quiz_questions (body, choices, answer, kind)
    values ('あしたの周年祭はくる？', '{いく！,いきたいけど・・,いけない,まよう}', 0, 'speed') returning id`))[0].id;
  const z = (await staff("insert into public.quiz_sets (title) values ('周年') returning id"))[0].id;
  await staff('select public.quiz_set_questions($1, $2)', [z, [quiz, speed]]);
  await staff('select public.quiz_open($1)', [z]);

  const results = [];
  for (const [sub, nick, pick] of [['U1', 'あおい', 2], ['U2', 'Ren', 0]]) {
    const t = await login(sub, nick);
    const s = await anon1('select public.quiz_start($1, $2)', [t, z]);
    const q1 = await anon1('select public.quiz_next($1, $2)', [t, s.attempt_id]);
    assert.equal(q1.kind, 'quiz');
    const a1 = await anon1('select public.quiz_answer($1, $2, $3)', [t, s.attempt_id, q1.choices.indexOf('正')]);
    // 0033: ふつうの問題も、この人の画面の並び順で「何番に何人」が返る
    assert.equal(a1.votes[q1.choices.indexOf('正')], results.length + 1);
    assert.equal(a1.votes.reduce((x, y) => x + y, 0), results.length + 1);
    const q2 = await anon1('select public.quiz_next($1, $2)', [t, s.attempt_id]);
    assert.equal(q2.kind, 'speed');
    assert.deepEqual(q2.choices, ['いく！', 'いきたいけど・・', 'いけない', 'まよう']);
    const a2 = await anon1('select public.quiz_answer($1, $2, $3)', [t, s.attempt_id, pick]);
    results.push(a2);
    const done = await anon1('select public.quiz_next($1, $2)', [t, s.attempt_id]);
    assert.equal(done.correct, 2);
  }
  assert.deepEqual([results[0].correct, results[0].answer, results[0].kind, results[0].choice], [true, null, 'speed', 2]);
  assert.deepEqual(results[1].votes, [1, 0, 1, 0]);
  // 0033: ふつうの問題も、選択肢ごとの人数が返る（この人の画面の並び順）
  assert.equal(results[1].votes.reduce((x, y) => x + y, 0), 2);
  assert.equal(results[1].board.correct_rate, 100);
  assert.equal(results[1].board.fastest.length, 2);
});

test('早押しでも時間切れは記録なし（正解に数えない）', async () => {
  const speed = (await staff(`insert into public.quiz_questions (body, choices, answer, kind)
    values ('くる？', '{a,b,c,d}', 0, 'speed') returning id`))[0].id;
  const z = (await staff("insert into public.quiz_sets (title, time_limit_sec) values ('時間切れ', 5) returning id"))[0].id;
  await staff('select public.quiz_set_questions($1, $2)', [z, [speed]]);
  await staff('select public.quiz_open($1)', [z]);
  const t = await login('U3', 'そら');
  const s = await anon1('select public.quiz_start($1, $2)', [t, z]);
  await anon1('select public.quiz_next($1, $2)', [t, s.attempt_id]);
  const a = await anon1('select public.quiz_answer($1, $2, null)', [t, s.attempt_id]);
  assert.deepEqual([a.correct, a.timed_out], [false, true]);
});
