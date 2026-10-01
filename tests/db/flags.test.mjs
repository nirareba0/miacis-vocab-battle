import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, asAnon } from './helper.mjs';

test('app_flags: 既定でランクモードは隠す。設定を true にすると解禁。匿名でも読めるが設定表は読めない', async () => {
  const db = await createTestDb();
  try {
    await asAnon(db, async () => {
      assert.equal((await db.query('select public.app_flags() as f')).rows[0].f.rank_mode_enabled, false);
      await assert.rejects(db.exec('select * from public.app_settings'), /permission denied/);
    });
    await db.exec("update public.app_settings set value = 'true' where key = 'rank_mode_enabled'");
    await asAnon(db, async () => {
      assert.equal((await db.query('select public.app_flags() as f')).rows[0].f.rank_mode_enabled, true);
    });
  } finally {
    await db.close();
  }
});
