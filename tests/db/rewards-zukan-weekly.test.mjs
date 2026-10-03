// 0022: 図鑑を埋めたら すがた、週間1位なら 称号（2026-10-03 本人）
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb, seedTestWords, createUser, asUser, setTestTime } from './helper.mjs';

async function setup() {
  const db = await createTestDb();
  await seedTestWords(db, 30); // 段ごとに30語
  await setTestTime(db, '2026-10-01T12:00:00+09:00'); // 週の始まりは 2026-09-28
  return db;
}

async function player(db, name, staff = false) {
  const id = randomUUID();
  await createUser(db, id);
  await asUser(db, id, () => db.query('select public.register_player($1,1,null)', [name]));
  if (staff) await db.query('insert into public.staff(user_id) values($1)', [id]);
  return id;
}

const call = (db, id, sql, params = []) => asUser(db, id, async () => (await db.query(sql, params)).rows[0].r);
const answerIndex = async (db, runId) => (await db.query("select (current->>'answer_index')::int as a from public.runs where id=$1", [runId])).rows[0].a;
const answerRight = async (db, id, runId) => call(db, id, 'select public.answer_run($1,$2,$3) as r', [runId, await answerIndex(db, runId), 1000]);
const answerWrong = async (db, id, runId) => call(db, id, 'select public.answer_run($1,$2,$3) as r', [runId, ((await answerIndex(db, runId)) + 1) % 4, 1000]);

async function streak(db, id, n, band = 1) {
  const s = await call(db, id, 'select public.start_run($1, $2) as r', ['streak', band]);
  let r;
  for (let i = 0; i < n; i++) {
    r = await answerRight(db, id, s.run_id);
    if (r.state === 'finished') return r;
  }
  return answerWrong(db, id, s.run_id);
}

test('図鑑（0022）: サバイバル・トレーニングの正解も「覚えた数」に入る。レベルを埋めると すがた が1回だけもらえる', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    let w = await call(db, a, 'select public.my_words() as r');
    assert.deepEqual(w.bands.map(b => b.collected), [0, 0, 0, 0, 0]);
    assert.equal(w.bands[0].total, 30);
    assert.equal(w.bands[0].reward.id, 'zukan_a1');
    assert.equal(w.bands[0].reward.owned, false);
    assert.equal(w.bands[4].reward.id, 'zukan_ac');

    await streak(db, a, 5);
    w = await call(db, a, 'select public.my_words() as r');
    assert.equal(w.bands[0].collected, 5, '前は対戦の正解だけを数えていて 0 のままだった');
    assert.deepEqual(await call(db, a, 'select public.claim_zukan_rewards() as r'), []);

    // A1 を出し切る（30語）→ 図鑑の A1 が埋まる
    const done = await streak(db, a, 40);
    assert.equal(done.result.end_reason, 'complete');
    const got = await call(db, a, 'select public.claim_zukan_rewards() as r');
    assert.deepEqual(got.map(g => g.id), ['zukan_a1']);
    assert.equal(got[0].name, '新入生のミアキス');
    assert.deepEqual(await call(db, a, 'select public.claim_zukan_rewards() as r'), [], '2回目は何も渡さない');
    w = await call(db, a, 'select public.my_words() as r');
    assert.equal(w.bands[0].reward.owned, true);
    assert.equal(w.bands[1].reward.owned, false);

    // もらった すがた は着られる（交換はできない）
    await call(db, a, "select public.equip_item('form', 'zukan_a1') as r");
    await db.query("insert into public.player_shards (player_id, amount) values ($1, 5000)", [a]);
    await asUser(db, a, async () => {
      await assert.rejects(db.query("select public.exchange_item('zukan_a2')"), /item_not_found/);
    });
  } finally {
    await db.close();
  }
});

test('週間1位の称号（0022）: 週の締めで、ステージごとのサバイバル1位（生徒）に称号。スタッフは対象外。二重に渡さず、また取ると回数が増える', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const b = await player(db, 'B');
    const staff = await player(db, 'Staff', true);
    await streak(db, a, 5);
    await streak(db, b, 3);
    await streak(db, staff, 9);   // スタッフが一番でも、称号は生徒の1位へ
    await db.query("insert into public.app_settings (key, value) values ('stage_unlock_correct', '3') on conflict (key) do update set value = excluded.value");
    await streak(db, b, 2, 2);    // A2 は B だけ（A1 で3連続したので開いている）

    await setTestTime(db, '2026-10-05T00:10:00+09:00');
    const out = (await db.query("select public.close_week_all('2026-09-28') as r")).rows[0].r;
    const sv = out.filter(o => o.kind === 'streak');
    assert.deepEqual(sv.map(o => [o.band, o.player_id, o.item_id]), [[1, a, 'title_wk_sv1'], [2, b, 'title_wk_sv2']]);
    const commit = out.find(o => o.kind === 'commit');
    assert.ok(commit && [a, b].includes(commit.player_id), 'コミットの1位も生徒');

    // もう一度回しても二重に渡さない
    assert.deepEqual((await db.query("select public.close_week_all('2026-09-28') as r")).rows[0].r, []);
    assert.equal((await db.query("select count from public.player_items where player_id=$1 and item_id='title_wk_sv1'", [a])).rows[0].count, 1);

    const mine = await call(db, a, 'select public.my_week_titles() as r');
    assert.ok(mine.some(t => t.item_id === 'title_wk_sv1' && t.name === 'サバイバル王 中1レベル' && t.count === 1));
    assert.equal((await call(db, staff, 'select public.my_week_titles() as r')).length, 0);

    // 次の週もAが1位 → 称号は1つのまま、回数が 2
    await streak(db, a, 4);
    await setTestTime(db, '2026-10-12T00:10:00+09:00');
    await db.query("select public.close_week_all('2026-10-05')");
    assert.equal((await db.query("select count from public.player_items where player_id=$1 and item_id='title_wk_sv1'", [a])).rows[0].count, 2);

    // 端末からは呼べない
    await asUser(db, a, async () => {
      await assert.rejects(db.query("select public.award_weekly_titles('2026-09-28')"), /permission denied/);
      await assert.rejects(db.query("select public.close_week_all('2026-09-28')"), /permission denied/);
      await assert.rejects(db.query('select * from public.weekly_title_awards'), /permission denied/);
    });
  } finally {
    await db.close();
  }
});
