import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createTestDb,
  seedTestWords,
  createUser,
  asUser,
  asAnon,
  asAdmin,
  setTestTime
} from './helper.mjs';

// 0004 で登録に館の合言葉が要るようになった。このファイルの検査は合言葉を設定済みの DB で行う
// （合言葉そのものの検査は game.test.mjs）。
async function withInvite(db) {
  await db.query(`insert into public.app_settings (key, value) values ('invite_code', 'test-invite')
                  on conflict (key) do update set value = excluded.value`);
  return db;
}

test('1. authenticated cannot insert into points / update players', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  const u1 = crypto.randomUUID();
  await createUser(db, u1);

  // Register player
  await asUser(db, u1, async () => {
    await db.query(`select public.register_player('user1', 2, 'test-invite');`);
  });

  // Try INSERT into points as authenticated user -> must be denied
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`
          insert into public.points (player_id, kind, reason, amount, week_start, day)
          values ('${u1}', 'learn', 'cheat', 100, public.jst_week_start(), public.jst_today());
        `);
      },
      /permission denied for table points/i
    );
  });

  // Try UPDATE on players as authenticated user -> must be denied
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`update public.players set tier = 5 where id = '${u1}';`);
      },
      /permission denied for table players/i
    );
  });

  // Try DELETE on players as authenticated user -> must be denied
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`delete from public.players where id = '${u1}';`);
      },
      /permission denied for table players/i
    );
  });
});

test('2. user cannot read others writings/matches/points; staff can read writings and players', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  const u1 = crypto.randomUUID();
  const u2 = crypto.randomUUID();
  const s1 = crypto.randomUUID();

  await createUser(db, u1);
  await createUser(db, u2);
  await createUser(db, s1);

  // Setup staff
  await db.query(`insert into public.staff (user_id) values ('${s1}');`);

  // Register u1, u2
  await asUser(db, u1, async () => {
    await db.query(`select public.register_player('user1', 1, 'test-invite');`);
  });
  await asUser(db, u2, async () => {
    await db.query(`select public.register_player('user2', 1, 'test-invite');`);
  });

  // Create content, writing, match, points for u1 as admin
  const contentId = crypto.randomUUID();
  await db.query(`
    insert into public.contents (id, week_start, title, url, quiz, writing_prompt, approved_at)
    values ('${contentId}', public.jst_week_start(), 'Title', 'https://example.com', '[]'::jsonb, '{"type":"three_words"}'::jsonb, now());
  `);
  await db.query(`
    insert into public.writings (player_id, content_id, text)
    values ('${u1}', '${contentId}', 'User 1 secret writing');
  `);
  await db.query(`
    insert into public.points (player_id, kind, reason, amount, week_start, day)
    values ('${u1}', 'learn', 'test', 5, public.jst_week_start(), public.jst_today());
  `);
  const matchId = crypto.randomUUID();
  await db.query(`
    insert into public.matches (id, player_id, band, questions, week_start)
    values ('${matchId}', '${u1}', 1, '[]'::jsonb, public.jst_week_start());
  `);

  // User 2 tries to read User 1's writings, matches, points -> RLS should return 0 rows
  await asUser(db, u2, async () => {
    const writingsRes = await db.query(`select * from public.writings where player_id = '${u1}';`);
    assert.equal(writingsRes.rows.length, 0);

    const matchesRes = await db.query(`select id from public.matches where player_id = '${u1}';`);
    assert.equal(matchesRes.rows.length, 0);

    const pointsRes = await db.query(`select * from public.points where player_id = '${u1}';`);
    assert.equal(pointsRes.rows.length, 0);
  });

  // Staff can read User 1's writings and players
  await asUser(db, s1, async () => {
    const writingsRes = await db.query(`select * from public.writings where player_id = '${u1}';`);
    assert.equal(writingsRes.rows.length, 1);
    assert.equal(writingsRes.rows[0].text, 'User 1 secret writing');

    const playersRes = await db.query(`select * from public.players where id = '${u1}';`);
    assert.equal(playersRes.rows.length, 1);
  });
});

test('3. answer_index is not in start_match return value nor accessible via matches query', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  const u1 = crypto.randomUUID();
  await createUser(db, u1);

  let matchData;
  await asUser(db, u1, async () => {
    await db.query(`select public.register_player('user1', 1, 'test-invite');`);
    const res = await db.query(`select public.start_match() as match;`);
    matchData = res.rows[0].match;
  });

  assert.ok(matchData.match_id);
  assert.equal(matchData.questions.length, 10);

  // 1. Check start_match questions return value has NO answer_index
  for (const q of matchData.questions) {
    assert.equal(q.answer_index, undefined, 'answer_index must not be returned by start_match');
    assert.ok(q.prompt);
    assert.equal(q.choices.length, 4);
  }

  // 2. Opponent summary must NOT reveal opponent's correct count or total_ms
  assert.ok(matchData.opponent.nickname);
  assert.equal(matchData.opponent.correct, undefined);
  assert.equal(matchData.opponent.total_ms, undefined);

  // 3. Authenticated query on matches: questions column is not granted
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`select questions from public.matches where id = '${matchData.match_id}';`);
      },
      /permission denied for (column questions of relation matches|table matches)/i
    );

    // select * is also blocked due to ungranted column
    await assert.rejects(
      async () => {
        await db.query(`select * from public.matches where id = '${matchData.match_id}';`);
      },
      /permission denied for (column questions of relation matches|table matches)/i
    );

    // Permitted columns query succeeds
    const allowed = await db.query(`
      select id, player_id, band, answers, correct, total_ms, opponent, result, started_at, finished_at, week_start
      from public.matches where id = '${matchData.match_id}';
    `);
    assert.equal(allowed.rows.length, 1);
  });
});

test('4. submit_match: scoring, win/lose, tie-breaker, learn points, duplicate submission, and too_fast', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  const u1 = crypto.randomUUID();
  await createUser(db, u1);

  await setTestTime(db, '2026-09-25 10:00:00+09');

  let matchId;
  await asUser(db, u1, async () => {
    await db.query(`select public.register_player('user1', 1, 'test-invite');`);
    const res = await db.query(`select public.start_match() as match;`);
    matchId = res.rows[0].match.match_id;
  });

  // Admin inspects questions and sets controlled opponent
  const matchRow = (await db.query(`select questions from public.matches where id = '${matchId}';`)).rows[0];
  const questions = matchRow.questions;

  // Set opponent to correct: 7, total_ms: 30000
  await db.query(`
    update public.matches
    set opponent = jsonb_build_object('nickname', 'Opponent', 'correct', 7, 'total_ms', 30000, 'is_practice', false)
    where id = '${matchId}';
  `);

  // Case 4a: too_fast check
  // started_at is 10:00:00. If test time is 10:00:01 (1 sec elapsed), but sum of ms is 30000ms -> too_fast
  await setTestTime(db, '2026-09-25 10:00:01+09');
  const tooFastAnswers = questions.map(q => ({ choice: q.answer_index, ms: 3000 }));
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`select public.submit_match('${matchId}', $1::jsonb);`, [JSON.stringify(tooFastAnswers)]);
      },
      /too_fast/
    );
  });

  // Advance time to 10:00:35 (35 sec elapsed, sufficient for 30000ms total)
  await setTestTime(db, '2026-09-25 10:00:35+09');

  // Case 4b: Submit valid winning answers: 8 correct, ms = 3000 each (total 30000ms)
  // Opponent has 7 correct -> result: win!
  const winAnswers = questions.map((q, idx) => {
    if (idx < 8) {
      return { choice: q.answer_index, ms: 3000 };
    } else {
      return { choice: (q.answer_index + 1) % 4, ms: 3000 };
    }
  });

  let submitRes;
  await asUser(db, u1, async () => {
    const res = await db.query(`select public.submit_match('${matchId}', $1::jsonb) as res;`, [JSON.stringify(winAnswers)]);
    submitRes = res.rows[0].res;
  });

  assert.equal(submitRes.correct, 8);
  assert.equal(submitRes.result, 'win');
  assert.equal(submitRes.total_ms, 30000);
  // Learn points = 8 (correct) + 3 (win) = 11
  assert.equal(submitRes.learn_points, 11);
  assert.equal(submitRes.commit_points, 1);

  // Verify points were stored
  const pointsRes = await db.query(`select kind, amount, reason from public.points where player_id = '${u1}';`);
  const learnPt = pointsRes.rows.find(p => p.kind === 'learn' && p.reason === 'match');
  const commitPt = pointsRes.rows.find(p => p.kind === 'commit' && p.reason === 'match');
  assert.equal(learnPt.amount, 11);
  assert.equal(commitPt.amount, 1);

  // Case 4c: Duplicate submission rejection
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`select public.submit_match('${matchId}', $1::jsonb);`, [JSON.stringify(winAnswers)]);
      },
      /already_submitted/
    );
  });

  // Case 4d: Tie-breaker test (same correct, shorter ms wins)
  const u2 = crypto.randomUUID();
  await createUser(db, u2);
  let matchId2;
  await setTestTime(db, '2026-09-25 11:00:00+09');
  await asUser(db, u2, async () => {
    await db.query(`select public.register_player('user2', 1, 'test-invite');`);
    const res = await db.query(`select public.start_match() as match;`);
    matchId2 = res.rows[0].match.match_id;
  });

  const q2 = (await db.query(`select questions from public.matches where id = '${matchId2}';`)).rows[0].questions;
  // Opponent: 7 correct, 30000ms
  await db.query(`
    update public.matches
    set opponent = jsonb_build_object('nickname', 'Opponent', 'correct', 7, 'total_ms', 30000, 'is_practice', false)
    where id = '${matchId2}';
  `);

  // User 2: 7 correct, 25000ms (shorter ms -> win!)
  await setTestTime(db, '2026-09-25 11:00:30+09');
  const tieWinAnswers = q2.map((q, idx) => {
    if (idx < 7) {
      return { choice: q.answer_index, ms: 2500 };
    } else {
      return { choice: (q.answer_index + 1) % 4, ms: 2500 };
    }
  });

  await asUser(db, u2, async () => {
    const res = await db.query(`select public.submit_match('${matchId2}', $1::jsonb) as res;`, [JSON.stringify(tieWinAnswers)]);
    assert.equal(res.rows[0].res.correct, 7);
    assert.equal(res.rows[0].res.result, 'win'); // Tie-breaker won
  });
});

test('5. commit points cap: max 10 per day in JST, caps correctly, resets next day', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  const u1 = crypto.randomUUID();
  await createUser(db, u1);

  await setTestTime(db, '2026-09-25 09:00:00+09');

  await asUser(db, u1, async () => {
    await db.query(`select public.register_player('user1', 1, 'test-invite');`);
  });

  // 1. touch_today gives +1 commit point ('open')
  let touchPts;
  await asUser(db, u1, async () => {
    const res = await db.query(`select public.touch_today() as pts;`);
    touchPts = res.rows[0].pts;
  });
  assert.equal(touchPts, 1);

  // Calling touch_today again on same day gives 0
  await asUser(db, u1, async () => {
    const res = await db.query(`select public.touch_today() as pts;`);
    assert.equal(res.rows[0].pts, 0);
  });

  // Current commit: 1. Add 8 -> should be 9
  const res8 = await db.query(`select public.add_commit('${u1}', 'test', 8) as pts;`);
  assert.equal(res8.rows[0].pts, 8);

  // Current commit: 9. Add 3 -> cap is 10, so only +1 is added
  const res3 = await db.query(`select public.add_commit('${u1}', 'test', 3) as pts;`);
  assert.equal(res3.rows[0].pts, 1);

  // Current commit: 10. Add 2 -> cap reached, +0 returned, no row inserted
  const pointsBefore = await db.query(`select count(*) from public.points where player_id = '${u1}' and kind = 'commit';`);
  const res2 = await db.query(`select public.add_commit('${u1}', 'test', 2) as pts;`);
  assert.equal(res2.rows[0].pts, 0);
  const pointsAfter = await db.query(`select count(*) from public.points where player_id = '${u1}' and kind = 'commit';`);
  assert.equal(pointsBefore.rows[0].count, pointsAfter.rows[0].count);

  // Advance time to next day JST: 2026-09-26 09:00:00+09
  await setTestTime(db, '2026-09-26 09:00:00+09');

  // New day: cap is reset, can earn up to 10 points again
  const nextDayPts = await db.query(`select public.add_commit('${u1}', 'test_new_day', 5) as pts;`);
  assert.equal(nextDayPts.rows[0].pts, 5);
});

test('6. submit_writing: 3 prompt types validation, masking, duplicate rejection, and daily point cap', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  const u1 = crypto.randomUUID();
  await createUser(db, u1);

  await setTestTime(db, '2026-09-25 10:00:00+09');
  await asUser(db, u1, async () => {
    await db.query(`select public.register_player('user1', 1, 'test-invite');`);
  });

  // Prompt Type 1: use_word
  const c1 = crypto.randomUUID();
  await db.query(`
    insert into public.contents (id, week_start, title, url, quiz, writing_prompt, approved_at)
    values ('${c1}', public.jst_week_start(), 'Content 1', 'https://example.com/1', '[]'::jsonb,
            '{"type":"use_word", "words":["deadline", "awkward"]}'::jsonb, now());
  `);

  // Type 1 - Pass: 3+ words, contains "deadlines" (plural allowed)
  let w1Res;
  await asUser(db, u1, async () => {
    const res = await db.query(
      `select public.submit_writing('${c1}', $1) as res;`,
      ['I have two deadlines this week.']
    );
    w1Res = res.rows[0].res;
  });
  assert.equal(w1Res.commit_points, 3);
  assert.equal(w1Res.text, 'I have two deadlines this week.');

  // Type 1 - Fail: missing prompt word
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`select public.submit_writing('${c1}', $1);`, ['I have two tests this week.']);
      },
      /must include at least one of the specified prompt words/
    );
  });

  // Type 1 - Fail: under 3 words
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`select public.submit_writing('${c1}', $1);`, ['Big deadline.']);
      },
      /must contain at least 3 english words/
    );
  });

  // Duplicate rejection (case & whitespace insensitive)
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`select public.submit_writing('${c1}', $1);`, ['  i  HAVE two DEADLINES this week.  ']);
      },
      /duplicate of past writing/
    );
  });

  // 6+ consecutive identical characters rejection
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`select public.submit_writing('${c1}', $1);`, ['Sooooooo awkward to miss deadline.']);
      },
      /identical characters repeated 6 or more times/
    );
  });

  // Second submission on same day: saved but gets 0 commit points
  let w2Res;
  await asUser(db, u1, async () => {
    const res = await db.query(
      `select public.submit_writing('${c1}', $1) as res;`,
      ['That was very awkward yesterday.']
    );
    w2Res = res.rows[0].res;
  });
  assert.equal(w2Res.commit_points, 0);

  // Masking test: phone numbers and email
  const c2 = crypto.randomUUID();
  await db.query(`
    insert into public.contents (id, week_start, title, url, quiz, writing_prompt, approved_at)
    values ('${c2}', public.jst_week_start(), 'Content 2', 'https://example.com/2', '[]'::jsonb,
            '{"type":"what_would_you_do"}'::jsonb, now());
  `);

  let maskRes;
  await asUser(db, u1, async () => {
    const res = await db.query(
      `select public.submit_writing('${c2}', $1) as res;`,
      ['Call me at 090-1234-5678 or write to test@example.com right away please.']
    );
    maskRes = res.rows[0].res;
  });
  assert.ok(maskRes.text.includes('***'));
  assert.ok(!maskRes.text.includes('090-1234-5678'));
  assert.ok(!maskRes.text.includes('test@example.com'));

  // Prompt Type 2: three_words
  const c3 = crypto.randomUUID();
  await db.query(`
    insert into public.contents (id, week_start, title, url, quiz, writing_prompt, approved_at)
    values ('${c3}', public.jst_week_start(), 'Content 3', 'https://example.com/3', '[]'::jsonb,
            '{"type":"three_words"}'::jsonb, now());
  `);

  // Exactly 3 words -> pass
  await asUser(db, u1, async () => {
    const res = await db.query(`select public.submit_writing('${c3}', $1) as res;`, ['Life is wonderful.']);
    assert.equal(res.rows[0].res.text, 'Life is wonderful.');
  });

  // 4 words -> fail
  await asUser(db, u1, async () => {
    await assert.rejects(
      async () => {
        await db.query(`select public.submit_writing('${c3}', $1);`, ['Life is truly wonderful.']);
      },
      /must contain exactly 3 english words/
    );
  });
});

test('7. close_week: top 3 promotion (points >= 1), inactivity demotion, tier 1/5 boundaries, idempotent', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  const week = '2026-09-14'; // Prior week
  await setTestTime(db, '2026-09-21 00:05:00+09');

  // Create Tier 1 players: P1..P6
  // P1: 15 pts (rank 1) -> tier 2
  // P2: 10 pts, earned at 10:00 (rank 2) -> tier 2
  // P3: 10 pts, earned at 11:00 (rank 3, tie broken by earlier time) -> tier 2
  // P4: 5 pts (rank 4) -> tier 1
  // P5: 0 learn pts, active (commit 1 pt) -> tier 1 (not demoted because active)
  // P6: 0 pts, inactive -> tier 1 (cannot demote below 1)
  const players = [];
  for (let i = 1; i <= 6; i++) {
    const uid = crypto.randomUUID();
    await createUser(db, uid);
    await asUser(db, uid, async () => {
      await db.query(`select public.register_player('p${i}', 1, 'test-invite');`);
    });
    players.push(uid);
  }

  // Create Tier 5 players: T5_1 (20 pts), T5_2 (inactive)
  const t5_top = crypto.randomUUID();
  const t5_inactive = crypto.randomUUID();
  await createUser(db, t5_top);
  await createUser(db, t5_inactive);
  await asUser(db, t5_top, async () => {
    await db.query(`select public.register_player('t5_top', 3, 'test-invite');`);
  });
  await asUser(db, t5_inactive, async () => {
    await db.query(`select public.register_player('t5_inact', 3, 'test-invite');`);
  });
  // Set tier 5 manually
  await db.query(`update public.players set tier = 5 where id in ('${t5_top}', '${t5_inactive}');`);

  // Insert points for week 2026-09-14
  await db.query(`
    insert into public.points (player_id, kind, reason, amount, week_start, day, created_at) values
    ('${players[0]}', 'learn', 'match', 15, '${week}', '${week}', '2026-09-15 10:00:00+09'),
    ('${players[1]}', 'learn', 'match', 10, '${week}', '${week}', '2026-09-15 10:00:00+09'),
    ('${players[2]}', 'learn', 'match', 10, '${week}', '${week}', '2026-09-15 11:00:00+09'),
    ('${players[3]}', 'learn', 'match', 5, '${week}', '${week}', '2026-09-15 12:00:00+09'),
    ('${players[4]}', 'commit', 'open', 1, '${week}', '${week}', '2026-09-15 12:00:00+09'),
    ('${t5_top}', 'learn', 'match', 20, '${week}', '${week}', '2026-09-15 10:00:00+09');
  `);

  // Execute close_week
  await db.query(`select public.close_week('${week}'::date);`);

  // Verify weekly_results and updated tiers
  const getTier = async (uid) => (await db.query(`select tier from public.players where id = '${uid}';`)).rows[0].tier;
  const getResult = async (uid) => (await db.query(`select * from public.weekly_results where player_id = '${uid}' and week_start = '${week}';`)).rows[0];

  assert.equal(await getTier(players[0]), 2, 'P1 promoted to 2');
  assert.equal(await getTier(players[1]), 2, 'P2 promoted to 2');
  assert.equal(await getTier(players[2]), 2, 'P3 promoted to 2');
  assert.equal(await getTier(players[3]), 1, 'P4 remains 1');
  assert.equal(await getTier(players[4]), 1, 'P5 active with 0 learn pts remains 1');
  assert.equal(await getTier(players[5]), 1, 'P6 inactive stays at 1 (boundary)');

  assert.equal(await getTier(t5_top), 5, 'T5 top remains 5 (max boundary)');
  assert.equal(await getTier(t5_inactive), 4, 'T5 inactive demoted to 4');

  // Verify rank in tier tie-breaker: P2 has rank 2, P3 has rank 3
  const rP2 = await getResult(players[1]);
  const rP3 = await getResult(players[2]);
  assert.equal(rP2.learn_rank_in_tier, 2);
  assert.equal(rP3.learn_rank_in_tier, 3);

  // Idempotency: re-running close_week should not change anything
  await db.query(`select public.close_week('${week}'::date);`);
  assert.equal(await getTier(players[0]), 2, 'P1 tier unchanged on re-run');
  const countRes = await db.query(`select count(*) from public.weekly_results where week_start = '${week}';`);
  assert.equal(countRes.rows[0].count, 8);
});

test('8. purge_graduates and purge_inactive cascades and deletes from auth.users', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  await setTestTime(db, '2026-03-31 23:30:00+09');

  // Create grade 6 student and grade 5 student
  const gradUid = crypto.randomUUID();
  const undergradUid = crypto.randomUUID();
  await createUser(db, gradUid);
  await createUser(db, undergradUid);

  await asUser(db, gradUid, async () => {
    await db.query(`select public.register_player('grad', 6, 'test-invite');`);
  });
  await asUser(db, undergradUid, async () => {
    await db.query(`select public.register_player('undergrad', 5, 'test-invite');`);
  });

  // Add match and points for gradUid
  await db.query(`
    insert into public.points (player_id, kind, reason, amount, week_start, day)
    values ('${gradUid}', 'learn', 'test', 5, public.jst_week_start(), public.jst_today());
  `);

  // Run purge_graduates
  const purgedCount = (await db.query(`select public.purge_graduates() as cnt;`)).rows[0].cnt;
  assert.equal(purgedCount, 1);

  // Verify gradUid deleted from auth.users and cascaded
  const gradAuth = await db.query(`select * from auth.users where id = '${gradUid}';`);
  assert.equal(gradAuth.rows.length, 0);
  const gradPlayer = await db.query(`select * from public.players where id = '${gradUid}';`);
  assert.equal(gradPlayer.rows.length, 0);
  const gradPoints = await db.query(`select * from public.points where player_id = '${gradUid}';`);
  assert.equal(gradPoints.rows.length, 0);

  // undergradUid still exists
  const underAuth = await db.query(`select * from auth.users where id = '${undergradUid}';`);
  assert.equal(underAuth.rows.length, 1);

  // Test purge_inactive
  const inactiveUid = crypto.randomUUID();
  const activeUid = crypto.randomUUID();
  await createUser(db, inactiveUid);
  await createUser(db, activeUid);

  await asUser(db, inactiveUid, async () => {
    await db.query(`select public.register_player('inactive', 2, 'test-invite');`);
  });
  await asUser(db, activeUid, async () => {
    await db.query(`select public.register_player('active', 2, 'test-invite');`);
  });

  // Set inactive user's last_active_at to 185 days ago relative to jst_now()
  await db.query(`
    update public.players
    set last_active_at = public.jst_now() - interval '185 days', created_at = public.jst_now() - interval '185 days'
    where id = '${inactiveUid}';
  `);
  // Active user active 10 days ago
  await db.query(`
    update public.players
    set last_active_at = public.jst_now() - interval '10 days'
    where id = '${activeUid}';
  `);

  const inactivePurged = (await db.query(`select public.purge_inactive() as cnt;`)).rows[0].cnt;
  assert.equal(inactivePurged, 1);

  const inactAuth = await db.query(`select * from auth.users where id = '${inactiveUid}';`);
  assert.equal(inactAuth.rows.length, 0);
  const actAuth = await db.query(`select * from auth.users where id = '${activeUid}';`);
  assert.equal(actAuth.rows.length, 1);
});

test('9. ranking views: no grade or id exposed, rank calculations are correct', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  await setTestTime(db, '2026-09-25 12:00:00+09');

  const u1 = crypto.randomUUID();
  const u2 = crypto.randomUUID();
  await createUser(db, u1);
  await createUser(db, u2);

  await asUser(db, u1, async () => {
    await db.query(`select public.register_player('alice', 1, 'test-invite');`);
  });
  await asUser(db, u2, async () => {
    await db.query(`select public.register_player('bob', 3, 'test-invite');`);
  });

  await db.query(`
    insert into public.points (player_id, kind, reason, amount, week_start, day) values
    ('${u1}', 'learn', 'match', 20, public.jst_week_start(), public.jst_today()),
    ('${u1}', 'commit', 'match', 5, public.jst_week_start(), public.jst_today()),
    ('${u2}', 'learn', 'match', 10, public.jst_week_start(), public.jst_today()),
    ('${u2}', 'commit', 'match', 8, public.jst_week_start(), public.jst_today());
  `);

  // Query as anon
  await asAnon(db, async () => {
    // 1. ranking_learn_week
    const learnView = await db.query(`select * from public.ranking_learn_week;`);
    const learnCols = Object.keys(learnView.rows[0]);
    assert.deepEqual(learnCols.sort(), ['is_staff', 'learn_points', 'nickname', 'rank', 'staff_label', 'tier'].sort());
    assert.ok(!learnCols.includes('grade'), 'grade must not be in learn view');
    assert.ok(!learnCols.includes('id'), 'id must not be in learn view');
    assert.ok(!learnCols.includes('player_id'), 'player_id must not be in learn view');

    // 2. ranking_commit_week
    const commitView = await db.query(`select * from public.ranking_commit_week;`);
    const commitCols = Object.keys(commitView.rows[0]);
    assert.deepEqual(commitCols.sort(), ['commit_points', 'is_staff', 'nickname', 'rank', 'staff_label', 'tier'].sort());
    assert.ok(!commitCols.includes('grade'), 'grade must not be in commit view');
    assert.ok(!commitCols.includes('id'), 'id must not be in commit view');
    assert.ok(!commitCols.includes('player_id'), 'player_id must not be in commit view');

    // Commit view rank check: bob has 8 points (rank 1), alice has 5 points (rank 2)
    assert.equal(commitView.rows[0].nickname, 'bob');
    assert.equal(commitView.rows[0].rank, 1);
    assert.equal(commitView.rows[1].nickname, 'alice');
    assert.equal(commitView.rows[1].rank, 2);
  });
});

test('10. unapproved contents invisible to normal users, visible to staff; approve_content awards +5 to picker', async () => {
  const db = await createTestDb().then(withInvite);
  await seedTestWords(db);

  const pickerUid = crypto.randomUUID();
  const normalUid = crypto.randomUUID();
  const staffUid = crypto.randomUUID();

  await createUser(db, pickerUid);
  await createUser(db, normalUid);
  await createUser(db, staffUid);

  await db.query(`insert into public.staff (user_id) values ('${staffUid}');`);

  await asUser(db, pickerUid, async () => {
    await db.query(`select public.register_player('picker', 2, 'test-invite');`);
  });
  await asUser(db, normalUid, async () => {
    await db.query(`select public.register_player('normal', 1, 'test-invite');`);
  });

  // Make picker a picker
  await db.query(`update public.players set is_picker = true where id = '${pickerUid}';`);

  // Picker proposes content
  let proposed;
  await asUser(db, pickerUid, async () => {
    const res = await db.query(`
      select (public.propose_content(
        'Interesting Video',
        'https://example.com/video',
        '[{"type":"choice","prompt":"What color?","choices":["Red","Blue","Green"],"answer":"Red"}]'::jsonb,
        '{"type":"three_words"}'::jsonb
      )).* ;
    `);
    proposed = res.rows[0];
  });
  assert.ok(proposed.id);
  assert.equal(proposed.approved_at, null);

  // Normal user cannot see unapproved content
  await asUser(db, normalUid, async () => {
    const res = await db.query(`select * from public.contents where id = '${proposed.id}';`);
    assert.equal(res.rows.length, 0);
  });

  // Staff can see unapproved content
  await asUser(db, staffUid, async () => {
    const res = await db.query(`select * from public.contents where id = '${proposed.id}';`);
    assert.equal(res.rows.length, 1);
  });

  // Staff approves content
  await asUser(db, staffUid, async () => {
    await db.query(`select public.approve_content('${proposed.id}');`);
  });

  // Picker receives +5 commit points (reason 'picked')
  const pickerPoints = await db.query(`select * from public.points where player_id = '${pickerUid}' and reason = 'picked';`);
  assert.equal(pickerPoints.rows.length, 1);
  assert.equal(pickerPoints.rows[0].amount, 5);
  assert.equal(pickerPoints.rows[0].kind, 'commit');

  // Normal user can now see approved content
  await asUser(db, normalUid, async () => {
    const res = await db.query(`select * from public.contents where id = '${proposed.id}';`);
    assert.equal(res.rows.length, 1);
    assert.ok(res.rows[0].approved_at);
  });
});
