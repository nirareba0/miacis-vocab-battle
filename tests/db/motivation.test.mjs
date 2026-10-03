// 0023: リベンジ・今日やること・図鑑の途中ごほうび（2026-10-03「中高生の学習モチベーションを高める」）
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb, seedTestWords, createUser, asUser, asAnon, setTestTime } from './helper.mjs';

async function setup() {
  const db = await createTestDb();
  await seedTestWords(db, 30);
  await setTestTime(db, '2026-10-05T16:00:00+09:00');
  return db;
}

async function player(db, name) {
  const id = randomUUID();
  await createUser(db, id);
  await asUser(db, id, () => db.query('select public.register_player($1,1,null)', [name]));
  return id;
}

const call = (db, id, sql, params = []) => asUser(db, id, async () => (await db.query(sql, params)).rows[0].r);
const start = (db, id, mode = 'streak', band = 1) => call(db, id, 'select public.start_run($1,$2) as r', [mode, band]);
const answer = (db, id, runId, choice, ms = 1000) => call(db, id, 'select public.answer_run($1,$2,$3) as r', [runId, choice, ms]);
const current = async (db, runId) => (await db.query('select current from public.runs where id=$1', [runId])).rows[0].current;
const right = async (db, id, runId) => answer(db, id, runId, (await current(db, runId)).answer_index);
const wrong = async (db, id, runId) => answer(db, id, runId, ((await current(db, runId)).answer_index + 1) % 4);
const setSetting = (db, key, value) => db.query('insert into public.app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value', [key, value]);
const coins = async (db, id, reason) => (await db.query('select coalesce(sum(amount),0)::int as n from public.nut_ledger where player_id=$1 and reason=$2', [id, reason])).rows[0].n;

test('リベンジ（0023）: 前の回でつまずいた単語が、次の回の最初に「リベンジ」として出る。正解したら次からは出ない', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const s1 = await start(db, a);
    await right(db, a, s1.run_id);
    const missedId = (await current(db, s1.run_id)).word_id;
    const r1 = await wrong(db, a, s1.run_id);
    assert.equal(r1.state, 'finished');
    assert.equal(r1.result.missed[0].word_id, missedId);

    // 次の回: 1問目がつまずいた単語。端末に来る問題にも revenge が付き、正解は付かない
    const s2 = await start(db, a);
    assert.equal(s2.question.revenge, true);
    assert.equal(s2.question.word_id, missedId);
    assert.equal(s2.question.answer_index, undefined);
    const r2 = await right(db, a, s2.run_id);
    assert.equal(r2.correct, true);
    assert.equal(r2.question.revenge, false); // つまずきは1語だけなので、2問目からはふつう
    await wrong(db, a, s2.run_id);

    // 正解したので、もうリベンジには出ない（2回目の回で間違えた語が代わりに出る）
    const s3 = await start(db, a);
    assert.notEqual(s3.question.word_id, missedId);
    assert.equal(s3.question.revenge, true);

    // 別のレベル（A2）には A1 のつまずきは出ない
    await call(db, a, 'select public.end_run($1) as r', [s3.run_id]);
    const k = await start(db, a, 'knock', 2);
    assert.equal(k.question.revenge, false);

    // スタッフ画面の設定で止められる
    await call(db, a, 'select public.end_run($1) as r', [k.run_id]);
    await setSetting(db, 'revenge_max', '0');
    const s4 = await start(db, a);
    assert.equal(s4.question.revenge, false);
  } finally {
    await db.close();
  }
});

test('今日やること（0023）: 遊べば進み、達成ごとに Miコインを1回だけ。日付が変わると0から', async () => {
  const db = await setup();
  try {
    await setSetting(db, 'quest_correct_goal', '4');
    await setSetting(db, 'quest_words_goal', '3');
    const a = await player(db, 'A');

    let q = await call(db, a, 'select public.claim_daily_quests() as r');
    assert.deepEqual(q.quests.map(x => [x.key, x.progress, x.goal]), [['survival', 0, 1], ['correct', 0, 4], ['new_words', 0, 3]]);
    assert.deepEqual(q.claimed_now, []);

    const s = await start(db, a);
    for (let i = 0; i < 3; i++) await right(db, a, s.run_id);
    await wrong(db, a, s.run_id);

    q = await call(db, a, 'select public.claim_daily_quests() as r');
    assert.deepEqual(q.quests.map(x => [x.key, x.progress]), [['survival', 1], ['correct', 3], ['new_words', 3]]);
    assert.deepEqual(q.claimed_now.map(x => x.key), ['survival', 'new_words']);
    assert.equal(await coins(db, a, 'quest'), 4);

    // 2回目は渡さない。トレーニングの正解も「正解」に数える
    const k = await start(db, a, 'knock', 1);
    await right(db, a, k.run_id);
    await call(db, a, 'select public.end_run($1) as r', [k.run_id]);
    q = await call(db, a, 'select public.claim_daily_quests() as r');
    assert.deepEqual(q.claimed_now.map(x => x.key), ['correct']);
    assert.equal(q.quests.every(x => x.claimed), true);
    q = await call(db, a, 'select public.claim_daily_quests() as r');
    assert.deepEqual(q.claimed_now, []);
    assert.equal(await coins(db, a, 'quest'), 6);

    // 次の日（日本時間 0:00 で切り替わる）
    await setTestTime(db, '2026-10-06T00:30:00+09:00');
    q = await call(db, a, 'select public.claim_daily_quests() as r');
    assert.deepEqual(q.quests.map(x => x.progress), [0, 0, 0]);
    // 昨日までに図鑑に入った語は「新しい単語」に数えない
    const s2 = await start(db, a);
    await right(db, a, s2.run_id);
    await wrong(db, a, s2.run_id);
    q = await call(db, a, 'select public.claim_daily_quests() as r');
    assert.equal(q.quests[0].progress, 1);
    assert.ok(q.quests[2].progress <= 1);
  } finally {
    await db.close();
  }
});

test('図鑑の途中ごほうび（0023）: 区切りの語数ごとに Miコイン。さかのぼって渡し、二重には渡さない。最後の区切りはコンプリートのすがた', async () => {
  const db = await setup();
  try {
    await setSetting(db, 'zukan_mile_every', '5');
    await setSetting(db, 'revenge_max', '0');
    const a = await player(db, 'A');

    let p = await call(db, a, 'select public.my_zukan_progress() as r');
    assert.deepEqual(p[0], { band: 1, total: 30, collected: 0, next_at: 5, next_kind: 'coin', coin: 5 });

    const s = await start(db, a);
    for (let i = 0; i < 11; i++) await right(db, a, s.run_id);
    await wrong(db, a, s.run_id);

    let c = await call(db, a, 'select public.claim_zukan_milestones() as r');
    assert.deepEqual(c.claimed_now.map(x => [x.band, x.at]), [[1, 5], [1, 10]]);
    assert.equal(c.bands[0].collected, 11);
    assert.equal(c.bands[0].next_at, 15);
    c = await call(db, a, 'select public.claim_zukan_milestones() as r');
    assert.deepEqual(c.claimed_now, []);
    assert.equal(await coins(db, a, 'zukan_mile'), 10);

    // 30語のレベルなら 25語が最後の区切り。30語目はコンプリートのすがた（0022）なので、コインは付けない
    await db.query("update public.runs set correct_word_ids = (select array_agg(id) from public.words where band = 1) where player_id = $1", [a]);
    c = await call(db, a, 'select public.claim_zukan_milestones() as r');
    assert.deepEqual(c.claimed_now.map(x => x.at), [15, 20, 25]);
    assert.equal(c.bands[0].next_kind, 'complete');
  } finally {
    await db.close();
  }
});

test('権限（0023）: 未ログインは使えない。中の部品（つまずきの一覧・集計）は端末から呼べない', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    for (const fn of ['claim_daily_quests()', 'my_zukan_progress()', 'claim_zukan_milestones()']) {
      await assert.rejects(asAnon(db, () => db.query(`select public.${fn}`)), /permission denied/);
    }
    await assert.rejects(asUser(db, a, () => db.query('select * from public.revenge_candidates($1, 1, null)', [a])), /permission denied/);
    await assert.rejects(asUser(db, a, () => db.query('select public.daily_quest_state($1)', [a])), /permission denied/);
    await assert.rejects(asUser(db, a, () => db.query('select public.zukan_progress_of($1)', [a])), /permission denied/);
  } finally {
    await db.close();
  }
});
