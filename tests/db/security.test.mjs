// 本物の Supabase の既定の権限（helper.mjs で再現）の上で、端末から触れてはいけないものを確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createTestDb, seedTestWords, createUser, asUser, asAnon } from './helper.mjs';

// 端末（anon / authenticated）から呼べてはいけない関数
const INTERNAL_FUNCTIONS = [
  "public.add_commit(uuid, text, int)",
  "public.close_week(date)",
  "public.advance_grades()",
  "public.purge_graduates()",
  "public.purge_inactive()",
];

// 端末から書けてはいけないテーブル
const TABLES = [
  'players', 'staff', 'words', 'matches', 'points', 'contents',
  'content_opens', 'content_quiz_answers', 'writings', 'weekly_results',
];

test('内部の関数は anon からも authenticated からも実行できない', async () => {
  const db = await createTestDb();
  for (const role of ['anon', 'authenticated']) {
    for (const fn of INTERNAL_FUNCTIONS) {
      const { rows } = await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]);
      assert.equal(rows[0].ok, false, `${role} が ${fn} を実行できてしまう`);
    }
  }
});

test('どのテーブルにも anon / authenticated は書き込めない', async () => {
  const db = await createTestDb();
  for (const role of ['anon', 'authenticated']) {
    for (const t of TABLES) {
      for (const priv of ['insert', 'update', 'delete', 'truncate']) {
        const { rows } = await db.query(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${t}`, priv]);
        assert.equal(rows[0].ok, false, `${role} が ${t} に ${priv} できてしまう`);
      }
    }
  }
});

test('authenticated は matches.questions（正解つき）を読めない', async () => {
  const db = await createTestDb();
  const { rows } = await db.query(
    `select has_column_privilege('authenticated', 'public.matches', 'questions', 'select') as ok`);
  assert.equal(rows[0].ok, false);

  // 実際に対戦を始めて、自分の行から questions を読もうとすると拒否される
  await seedTestWords(db);
  const uid = crypto.randomUUID();
  await createUser(db, uid);
  await asUser(db, uid, async () => {
    await db.query(`select public.register_player('てすと', 3)`);
    await db.query(`select public.start_match()`);
    await assert.rejects(db.query(`select questions from public.matches`), /permission denied/);
  });
});

test('anon は本人用のテーブルを読めず、ランキングと ping は使える', async () => {
  const db = await createTestDb();
  await asAnon(db, async () => {
    for (const t of ['players', 'points', 'writings', 'matches', 'weekly_results']) {
      await assert.rejects(db.query(`select 1 from public.${t} limit 1`), /permission denied/, t);
    }
    await db.query(`select * from public.ranking_learn_week`);
    await db.query(`select * from public.ranking_commit_week`);
    await db.query(`select public.ping()`);
  });
});
