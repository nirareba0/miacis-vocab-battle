import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb, seedTestWords, createUser, asUser, setTestTime } from './helper.mjs';

test('大学生スタッフ（0026）: 表示は「大学生スタッフ」、賞の対象外、スタッフ画面には入れない。本のすがたはガチャに入る', async () => {
  const db = await createTestDb();
  try {
    await seedTestWords(db, 30);
    await setTestTime(db, '2026-10-03T12:00:00+09:00');
    const id = randomUUID();
    await createUser(db, id);
    await asUser(db, id, () => db.query("select public.register_player('Maria',6,null)"));
    await asUser(db, id, () => db.query('select public.touch_today()'));

    const sql = (await import('node:fs')).readFileSync(new URL('../../tools/sql/make-univ-staff.sql', import.meta.url), 'utf8').replaceAll('ここにニックネーム', 'Maria');
    await db.exec(sql);

    const p = (await db.query("select account_type, grade, staff_label from public.players where nickname='Maria'")).rows[0];
    assert.deepEqual(p, { account_type: 'staff', grade: null, staff_label: '大学生スタッフ' });

    const row = (await db.query("select is_staff, staff_label from public.ranking_commit_week where nickname='Maria'")).rows[0];
    assert.deepEqual(row, { is_staff: true, staff_label: '大学生スタッフ' });

    const unlocked = (await db.query('select public.stage_unlocked($1, 5) as u', [id])).rows[0].u;
    assert.equal(unlocked, true, 'スタッフはステージが全部開く');

    await asUser(db, id, async () => {
      await assert.rejects(db.query('select public.staff_settings()'), /not_a_staff/, 'スタッフ画面には入れない');
    });

    const item = (await db.query("select slot, rarity, active, source from public.items where id='staff_book'")).rows[0];
    assert.deepEqual(item, { slot: 'form', rarity: 5, active: true, source: 'gacha' });
  } finally {
    await db.close();
  }
});

test('学年で開くレベル（0027）: 自分の学年のレベルまでは最初から。最難関は全員 20 連続で', async () => {
  const db = await createTestDb();
  try {
    await seedTestWords(db, 30);
    await setTestTime(db, '2026-10-03T12:00:00+09:00');
    const opened = async (name, grade) => {
      const id = randomUUID();
      await createUser(db, id);
      await asUser(db, id, () => db.query('select public.register_player($1,$2,null)', [name, grade]));
      const st = await asUser(db, id, async () => (await db.query('select public.my_stages() as r')).rows[0].r);
      return st.map(s => s.unlocked);
    };
    assert.deepEqual(await opened('中1', 1), [true, false, false, false, false]);
    assert.deepEqual(await opened('中3', 3), [true, true, false, false, false]);
    assert.deepEqual(await opened('高1', 4), [true, true, true, false, false]);
    assert.deepEqual(await opened('高3', 6), [true, true, true, true, false]);
    const title = (await db.query("select name from public.items where id='title_wk_sv1'")).rows[0].name;
    assert.equal(title, 'サバイバル王 中1レベル');
  } finally {
    await db.close();
  }
});
