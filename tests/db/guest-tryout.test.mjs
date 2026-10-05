// 0028: 登録の前に中1レベルを1回まるごと遊ぶ・その記録で登録する・いま何人挑戦中・抜かれたら知らせる
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb, seedTestWords, createUser, asUser, asAnon, setTestTime } from './helper.mjs';

async function setup() {
  const db = await createTestDb();
  await seedTestWords(db, 30);
  await setTestTime(db, '2026-10-05T12:00:00+09:00');
  return db;
}

async function player(db, name, grade = 1) {
  const id = randomUUID();
  await createUser(db, id);
  await asUser(db, id, () => db.query('select public.register_player($1,$2,null)', [name, grade]));
  return id;
}

const anon = (db, sql, params = []) => asAnon(db, async () => (await db.query(sql, params)).rows[0].r);
const call = (db, id, sql, params = []) => asUser(db, id, async () => (await db.query(sql, params)).rows[0].r);

// 正解は端末に来ないので、テストだけ管理者として覗く
const guestAnswerIndex = async (db, token) =>
  (await db.query("select (current->>'answer_index')::int as a from public.guest_runs where token=$1", [token])).rows[0].a;
const runAnswerIndex = async (db, runId) =>
  (await db.query("select (current->>'answer_index')::int as a from public.runs where id=$1", [runId])).rows[0].a;

async function guestPlay(db, rights) {
  const s = await anon(db, 'select public.start_guest_run() as r');
  for (let i = 0; i < rights; i++) {
    await anon(db, 'select public.answer_guest_run($1,$2,$3) as r', [s.token, await guestAnswerIndex(db, s.token), 1000]);
  }
  const wrong = ((await guestAnswerIndex(db, s.token)) + 1) % 4;
  const r = await anon(db, 'select public.answer_guest_run($1,$2,$3) as r', [s.token, wrong, 1000]);
  return { token: s.token, last: r };
}

async function streak(db, id, rights) {
  const s = await call(db, id, 'select public.start_run($1,$2) as r', ['streak', 1]);
  for (let i = 0; i < rights; i++) {
    await call(db, id, 'select public.answer_run($1,$2,$3) as r', [s.run_id, await runAnswerIndex(db, s.run_id), 1000]);
  }
  const wrong = ((await runAnswerIndex(db, s.run_id)) + 1) % 4;
  return call(db, id, 'select public.answer_run($1,$2,$3) as r', [s.run_id, wrong, 1000]);
}

test('登録前の挑戦: ログインなしで中1レベルを最後まで遊べる。正解は端末に来ない。ランキングには出ない', async () => {
  const db = await setup();
  try {
    const s = await anon(db, 'select public.start_guest_run() as r');
    assert.ok(s.token);
    assert.equal(s.band, 1);
    assert.equal(s.question.answer_index, undefined, '正解を端末に渡さない');
    assert.equal(s.question.limit_ms, 7000);

    const { last } = await (async () => {
      for (let i = 0; i < 4; i++) {
        const r = await anon(db, 'select public.answer_guest_run($1,$2,$3) as r', [s.token, await guestAnswerIndex(db, s.token), 1000]);
        assert.equal(r.correct, true);
        assert.equal(r.question.answer_index, undefined);
      }
      const wrong = ((await guestAnswerIndex(db, s.token)) + 1) % 4;
      return { last: await anon(db, 'select public.answer_guest_run($1,$2,$3) as r', [s.token, wrong, 1000]) };
    })();
    assert.equal(last.state, 'finished');
    assert.equal(last.result.guest, true);
    assert.equal(last.result.correct, 4);
    assert.equal(last.result.end_reason, 'wrong');
    assert.equal(last.result.missed.length, 1);
    assert.equal(last.result.would_rank, 1, 'だれもいなければ 1位');

    await assert.rejects(anon(db, 'select public.answer_guest_run($1,$2,$3) as r', [s.token, 0, 1000]), /run_not_active/);

    const rows = (await db.query('select count(*)::int as n from public.ranking_streak_week')).rows[0].n;
    assert.equal(rows, 0, '登録していない回はランキングに出ない');
    const runs = (await db.query('select count(*)::int as n from public.runs')).rows[0].n;
    assert.equal(runs, 0);
  } finally {
    await db.close();
  }
});

test('登録前の挑戦: 時間切れは ❤️ 復活を1回だけ使える', async () => {
  const db = await setup();
  try {
    const s = await anon(db, 'select public.start_guest_run() as r');
    const t = await anon(db, 'select public.answer_guest_run($1,$2,$3) as r', [s.token, null, null]);
    assert.equal(t.state, 'revive_offer');
    const rv = await anon(db, 'select public.revive_guest_run($1) as r', [s.token]);
    assert.equal(rv.state, 'next');
    assert.equal(rv.question.answer_index, undefined);
    const t2 = await anon(db, 'select public.answer_guest_run($1,$2,$3) as r', [s.token, null, null]);
    assert.equal(t2.state, 'finished');
    assert.equal(t2.result.end_reason, 'timeout');
    assert.equal(t2.result.answered, 1, '復活で飛ばした1問は数えない');
  } finally {
    await db.close();
  }
});

test('その記録で登録: 登録した人の1回になる（ランキング・ポイント・Miコイン）。2回は使えない', async () => {
  const db = await setup();
  try {
    const rival = await player(db, 'ライバル');
    await streak(db, rival, 5);

    const g = await guestPlay(db, 7);
    assert.equal(g.last.result.would_rank, 1, '7連続ならライバル（5）より上');
    const g2 = await guestPlay(db, 3);
    assert.equal(g2.last.result.would_rank, 2);
    assert.equal(g2.last.result.rival.nickname, 'ライバル');
    assert.equal(g2.last.result.rival.correct, 5);

    const me = await player(db, 'しんにゅう');
    const res = await call(db, me, 'select public.claim_guest_run($1) as r', [g.token]);
    assert.equal(res.correct, 7);
    assert.equal(res.learn_points, 7);
    assert.ok(res.nuts > 0, 'Miコインも付く');
    assert.equal(res.week_rank, 1);
    assert.equal(res.new_best, true);

    const rows = (await db.query('select nickname, best_streak, rank from public.ranking_streak_week where band=1 order by rank')).rows;
    assert.deepEqual(rows, [{ nickname: 'しんにゅう', best_streak: 7, rank: 1 }, { nickname: 'ライバル', best_streak: 5, rank: 2 }]);

    const pts = (await db.query("select coalesce(sum(amount),0)::int as n from public.points where player_id=$1 and kind='learn'", [me])).rows[0].n;
    assert.equal(pts, 7);

    const other = await player(db, 'べつのひと');
    await assert.rejects(call(db, other, 'select public.claim_guest_run($1) as r', [g.token]), /already_claimed/);
    await assert.rejects(anon(db, 'select public.claim_guest_run($1) as r', [g2.token]), /permission denied|not_authenticated/);
  } finally {
    await db.close();
  }
});

test('その記録で登録: 終わっていない回・1日たった回は受け付けない。1日たった回は次の開始で消える', async () => {
  const db = await setup();
  try {
    const me = await player(db, 'わたし');
    const s = await anon(db, 'select public.start_guest_run() as r');
    await assert.rejects(call(db, me, 'select public.claim_guest_run($1) as r', [s.token]), /run_not_finished/);

    const g = await guestPlay(db, 2);
    await setTestTime(db, '2026-10-06T12:30:00+09:00');
    await assert.rejects(call(db, me, 'select public.claim_guest_run($1) as r', [g.token]), /run_expired/);
    await anon(db, 'select public.start_guest_run() as r');
    const left = (await db.query('select count(*)::int as n from public.guest_runs')).rows[0].n;
    assert.equal(left, 1, '前の日の回は消えて、いま始めた1回だけ');
  } finally {
    await db.close();
  }
});

test('いま何人挑戦中: 遊んでいる最中の人（登録前も）と、今週 中1レベルを遊んだ人の数', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const b = await player(db, 'B');
    await streak(db, a, 2);
    await streak(db, b, 1);
    await call(db, a, 'select public.start_run($1,$2) as r', ['streak', 1]);   // A は遊んでいる最中
    await anon(db, 'select public.start_guest_run() as r');                      // 登録前の1人も遊んでいる最中

    const n = await anon(db, 'select public.challenge_now() as r');
    assert.equal(n.playing_now, 2);
    assert.equal(n.week_players, 2);

    await setTestTime(db, '2026-10-05T12:20:00+09:00');
    const later = await anon(db, 'select public.challenge_now() as r');
    assert.equal(later.playing_now, 0, '10分より前に始めた回は数えない');
  } finally {
    await db.close();
  }
});

test('抜かれたら知らせる: 自分の記録のあとで上に来た人だけ。もとから上にいた人は入れない', async () => {
  const db = await setup();
  try {
    const top = await player(db, 'もとから上');
    const me = await player(db, 'わたし');
    const chaser = await player(db, 'おいかけ');
    await streak(db, top, 9);
    await setTestTime(db, '2026-10-05T12:05:00+09:00');
    await streak(db, me, 5);
    await setTestTime(db, '2026-10-05T12:10:00+09:00');
    await streak(db, chaser, 3);

    let w = await call(db, me, 'select public.my_rank_watch() as r');
    assert.equal(w.length, 1);
    assert.equal(w[0].band, 1);
    assert.equal(w[0].rank, 2);
    assert.deepEqual(w[0].passed_by, []);

    await setTestTime(db, '2026-10-05T12:15:00+09:00');
    await streak(db, chaser, 6);
    w = await call(db, me, 'select public.my_rank_watch() as r');
    assert.equal(w[0].rank, 3);
    assert.deepEqual(w[0].passed_by.map(p => [p.nickname, p.best_streak]), [['おいかけ', 6]]);

    // 抜き返したら消える
    await setTestTime(db, '2026-10-05T12:20:00+09:00');
    await streak(db, me, 7);
    w = await call(db, me, 'select public.my_rank_watch() as r');
    assert.equal(w[0].rank, 2);
    assert.deepEqual(w[0].passed_by, []);

    await assert.rejects(anon(db, 'select public.my_rank_watch() as r'), /permission denied|not_authenticated/);
  } finally {
    await db.close();
  }
});

test('権限: guest_runs は端末から読めも書けもしない。内部の関数は呼べない', async () => {
  const db = await setup();
  try {
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        const ok = (await db.query('select has_table_privilege($1, $2, $3) as ok', [role, 'public.guest_runs', priv])).rows[0].ok;
        assert.equal(ok, false, `${role} が guest_runs に ${priv} できてしまう`);
      }
      for (const fn of ['public.guest_as_run(public.guest_runs)', 'public.guest_rank_of(int, int, int)',
        'public.guest_run_result(uuid)', 'public.guest_run_finish(uuid, text)']) {
        const ok = (await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).rows[0].ok;
        assert.equal(ok, false, `${role} が ${fn} を実行できてしまう`);
      }
    }
  } finally {
    await db.close();
  }
});
