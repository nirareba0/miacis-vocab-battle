// 0034: 最初に「中高生」か「それ以外」かを選ぶ。それ以外の人は遊べるが、ランキング・人数・早押しトップ・クーポンに入らない
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, asUser, asAnon, asAdmin } from './helper.mjs';

const STAFF = '00000000-0000-0000-0000-0000000000ac';
let db;
const anon1 = async (sql, params = []) => asAnon(db, async () => Object.values((await db.query(sql, params)).rows[0])[0]);
const anonRows = async (sql, params = []) => asAnon(db, async () => (await db.query(sql, params)).rows);
const staff = async (sql, params = []) => asUser(db, STAFF, async () => (await db.query(sql, params)).rows);
const rejects = (p, code) => assert.rejects(p, (e) => e.message.includes(code));
const login = async (sub) => (await anon1('select public.quiz_line_login($1)', [`line-${sub}`])).token;

before(async () => {
  db = await createTestDb();
  await db.exec(`create or replace function public.quiz_line_verify(p_id_token text) returns text
    language plpgsql as $$ begin return substr(p_id_token, 6); end; $$;
    create or replace function public.quiz_line_push(p_to text, p_text text) returns text
    language plpgsql as $$ begin return 'sent'; end; $$;`);
  await createUser(db, STAFF);
  await asAdmin(db, () => db.query('insert into public.staff (user_id) values ($1)', [STAFF]));
});

async function play(token, set, right = true) {
  const s = await anon1('select public.quiz_start($1, $2)', [token, set]);
  for (;;) {
    const q = await anon1('select public.quiz_next($1, $2)', [token, s.attempt_id]);
    if (q.done) return;
    const i = q.choices.findIndex((c) => c.startsWith('正'));
    await anon1('select public.quiz_answer($1, $2, $3)', [token, s.attempt_id, right ? i : (i + 1) % 4]);
  }
}

test('中高生かどうかを選ばないと挑戦できない。選んだ値は quiz_me で返る', async () => {
  const t = await login('U-new');
  await rejects(anon1('select public.quiz_register($1, $2, null)', [t, 'なまえ']), 'no_student_choice');
  const z = (await staff("insert into public.quiz_sets (title) values ('x') returning id"))[0].id;
  const q = (await staff("insert into public.quiz_questions (body, choices, answer) values ('q', '{正,a,b,c}', 0) returning id"))[0].id;
  await staff('select public.quiz_set_questions($1, $2)', [z, [q]]);
  await staff('select public.quiz_open($1)', [z]);
  await rejects(anon1('select public.quiz_start($1, $2)', [t, z]), 'no_nickname');
  await anon1('select public.quiz_register($1, $2, false)', [t, 'なまえ']);
  assert.deepEqual(await anon1('select public.quiz_me($1)', [t]), { nickname: 'なまえ', is_student: false });
});

test('それ以外の人は遊べるが、ランキング・人数・早押しトップ・1位のクーポンに入らない', async () => {
  const z = (await staff("insert into public.quiz_sets (title, prize) values ('学生だけ', '購買無料券') returning id"))[0].id;
  const q = (await staff("insert into public.quiz_questions (body, choices, answer) values ('q', '{正,a,b,c}', 0) returning id"))[0].id;
  await staff('select public.quiz_set_questions($1, $2)', [z, [q]]);
  await staff('select public.quiz_open($1)', [z]);
  const adult = await login('U-adult');
  await anon1('select public.quiz_register($1, $2, false)', [adult, 'おとな']);
  const kid = await login('U-kid');
  await anon1('select public.quiz_register($1, $2, true)', [kid, 'こども']);

  await play(adult, z, true);              // 大人が先に全問正解（速い）
  // 中高生の答えに出る早押しトップに、大人は入らない
  const s = await anon1('select public.quiz_start($1, $2)', [kid, z]);
  const qn = await anon1('select public.quiz_next($1, $2)', [kid, s.attempt_id]);
  const a = await anon1('select public.quiz_answer($1, $2, $3)', [kid, s.attempt_id, qn.choices.findIndex((c) => c.startsWith('正'))]);
  assert.deepEqual(a.board.fastest.map((f) => f.nickname), ['こども']);

  const rank = await anonRows('select * from public.quiz_ranking($1)', [z]);
  assert.deepEqual(rank.map((r) => r.nickname), ['こども']);
  // 0035: おとなのランキングは別に見られる（自分の行つき）
  const adults = await anonRows('select * from public.quiz_ranking($1, $2, false)', [z, adult]);
  assert.deepEqual(adults.map((r) => [r.rank, r.nickname, r.is_me]), [[1, 'おとな', true]]);
  const item = (await anon1('select public.quiz_list($1)', [adult])).find((x) => x.id === z);
  assert.equal(item.players, 1);
  assert.equal(item.adults, 1);
  assert.equal(item.my_finished, true);    // 大人も自分の記録は見える
  const closed = (await staff('select public.quiz_close($1) as r', [z]))[0].r;
  assert.equal(closed.winner, 'こども');
  assert.equal((await anon1('select public.quiz_my_coupons($1)', [adult])).length, 0);
});

test('0035: 最後のお知らせはスタッフが書けて、一覧で返る', async () => {
  const z = (await staff(`insert into public.quiz_sets (title, end_title, end_body) values ('お知らせ', 'あした15:00〜 BINGO大会', '景品いろいろ') returning id`))[0].id;
  const q = (await staff("insert into public.quiz_questions (body, choices, answer) values ('q', '{正,a,b,c}', 0) returning id"))[0].id;
  await staff('select public.quiz_set_questions($1, $2)', [z, [q]]);
  await staff('select public.quiz_open($1)', [z]);
  await staff("update public.quiz_sets set end_link_url = 'https://example.com/bingo' where id = $1", [z]);
  const item = (await anon1('select public.quiz_list()')).find((x) => x.id === z);
  assert.deepEqual([item.end_title, item.end_body, item.end_link_url], ['あした15:00〜 BINGO大会', '景品いろいろ', 'https://example.com/bingo']);
  await rejects(staff("update public.quiz_sets set end_link_url = 'javascript:1' where id = $1", [z]), 'check constraint');
});
