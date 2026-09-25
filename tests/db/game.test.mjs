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

const TEST_INVITE = 'miacis_secret_code';

async function setupGameTest(options = {}) {
  const db = await createTestDb();
  await seedTestWords(db);
  if (options.setInvite !== false) {
    await db.query(
      `insert into public.app_settings (key, value) values ('invite_code', $1)
       on conflict (key) do update set value = excluded.value`,
      [options.inviteCode || TEST_INVITE]
    );
  }
  return db;
}

test('合言葉: 未設定・違う・合う・大文字小文字と空白の正規化', async () => {
  const db = await setupGameTest({ setInvite: false });

  // 1. 未設定時は合言葉なしで誰でも登録できる（0005。2026-09-25 本人判断「一旦なしでいい」）
  await asAnon(db, async () => {
    const { rows } = await db.query('select public.invite_required() as req, public.check_invite($1) as ok', ['']);
    assert.equal(rows[0].req, false);
    assert.equal(rows[0].ok, true);
  });

  const uid0 = crypto.randomUUID();
  await createUser(db, uid0);
  await asUser(db, uid0, async () => {
    const { rows } = await db.query(`select * from public.register_player('free1', 2, null)`);
    assert.equal(rows[0].nickname, 'free1');
  });

  const uid1 = crypto.randomUUID();
  await createUser(db, uid1);

  // 2. 合言葉を設定すると、要るようになる
  await db.query(
    `insert into public.app_settings (key, value) values ('invite_code', 'Miacis Secret')`
  );
  await asAnon(db, async () => {
    const { rows } = await db.query('select public.invite_required() as req');
    assert.equal(rows[0].req, true);
  });
  await asUser(db, uid1, async () => {
    await assert.rejects(db.query(`select public.register_player('user1', 1, null)`), /invite_invalid/);
  });

  // 違う合言葉
  await asAnon(db, async () => {
    const { rows } = await db.query('select public.check_invite($1) as ok', ['wrong_code']);
    assert.equal(rows[0].ok, false);
  });

  await asUser(db, uid1, async () => {
    await assert.rejects(
      db.query(`select public.register_player('user1', 1, 'wrong_code')`),
      /invite_invalid/
    );
  });

  // 完全一致・大文字小文字・前後の空白
  await asAnon(db, async () => {
    const { rows: r1 } = await db.query('select public.check_invite($1) as ok', ['Miacis Secret']);
    assert.equal(r1[0].ok, true);

    const { rows: r2 } = await db.query('select public.check_invite($1) as ok', ['  miacis secret  ']);
    assert.equal(r2[0].ok, true);

    const { rows: r3 } = await db.query('select public.check_invite($1) as ok', ['MIACIS SECRET']);
    assert.equal(r3[0].ok, true);

    const { rows: r4 } = await db.query('select public.check_invite($1) as ok', ['']);
    assert.equal(r4[0].ok, false);

    const { rows: r5 } = await db.query('select public.check_invite($1) as ok', [null]);
    assert.equal(r5[0].ok, false);
  });

  // 登録成功
  await asUser(db, uid1, async () => {
    const { rows } = await db.query(
      `select * from public.register_player('user1', 1, '  miacis secret  ')`
    );
    assert.equal(rows[0].nickname, 'user1');

    // 既に登録済みのユーザーが再度呼んだらそのまま返る
    const { rows: r2 } = await db.query(
      `select * from public.register_player('user1', 1, 'any_code')`
    );
    assert.equal(r2[0].nickname, 'user1');
  });
});

test('旧 register_player(text, int) が存在しないこと', async () => {
  const db = await setupGameTest();
  const { rows } = await db.query(
    `select 1 from pg_proc where proname = 'register_player' and pronargs = 2`
  );
  assert.equal(rows.length, 0, '旧 register_player(text, int) が残っている');

  const uid = crypto.randomUUID();
  await createUser(db, uid);
  await asUser(db, uid, async () => {
    await assert.rejects(
      db.query(`select public.register_player('test', 1)`),
      /function public\.register_player\(unknown, integer\) does not exist|function public\.register_player\(text, integer\) does not exist/
    );
  });
});

test('進化: 段階の境目と名前、routeの確定と固定', async () => {
  const db = await setupGameTest();
  const uidGrass = crypto.randomUUID();
  await createUser(db, uidGrass);

  await asUser(db, uidGrass, async () => {
    await db.query(`select public.register_player('grass_boy', 2, '${TEST_INVITE}')`);

    // 0 pt: stage 1
    const { rows } = await db.query(`select public.my_progress() as p`);
    const p = rows[0].p;
    assert.equal(p.stage, 1);
    assert.equal(p.stage_name, 'ちびミアキス');
    assert.equal(p.route, null);
    assert.equal(p.next_threshold, 30);
    assert.equal(p.points_to_next, 30);
  });

  // 29 pt: stage 1
  await asAdmin(db, async () => {
    await db.query(
      `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
       values ($1, 'learn', 'match', 29, public.jst_week_start(), public.jst_today(), public.jst_now())`,
      [uidGrass]
    );
  });
  await asUser(db, uidGrass, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    const p = rows[0].p;
    assert.equal(p.stage, 1);
    assert.equal(p.points_to_next, 1);
  });

  // 30 pt: stage 2 (ミアキス)
  await asAdmin(db, async () => {
    await db.query(
      `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
       values ($1, 'commit', 'open', 1, public.jst_week_start(), public.jst_today(), public.jst_now())`,
      [uidGrass]
    );
  });
  await asUser(db, uidGrass, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    const p = rows[0].p;
    assert.equal(p.stage, 2);
    assert.equal(p.stage_name, 'ミアキス');
    assert.equal(p.route, null);
    assert.equal(p.next_threshold, 80);
    assert.equal(p.points_to_next, 50);
  });

  // 80 pt: learn >= commit (learn=50, commit=30) -> route = 'grass'
  await asAdmin(db, async () => {
    await db.query(
      `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
       values
         ($1, 'learn', 'match', 21, public.jst_week_start(), public.jst_today(), public.jst_now()),
         ($1, 'commit', 'open', 29, public.jst_week_start(), public.jst_today(), public.jst_now())`,
      [uidGrass]
    );
  });
  await asUser(db, uidGrass, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    const p = rows[0].p;
    assert.equal(p.stage, 3);
    assert.equal(p.route, 'grass');
    assert.equal(p.stage_name, '草原をめざすミアキス');
    assert.equal(p.next_threshold, 160);
    assert.equal(p.points_to_next, 80);
  });

  // 以後変えない: commit が大幅に増えても route は grass のまま
  await asAdmin(db, async () => {
    await db.query(
      `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
       values ($1, 'commit', 'open', 100, public.jst_week_start(), public.jst_today(), public.jst_now())`,
      [uidGrass]
    );
  });
  await asUser(db, uidGrass, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    const p = rows[0].p;
    assert.equal(p.stage, 4); // 180 pt -> stage 4
    assert.equal(p.route, 'grass');
    assert.equal(p.stage_name, 'ハイイロギツネ級');
    assert.equal(p.next_threshold, 300);
    assert.equal(p.points_to_next, 120);
  });

  // stage 5 (300 pt)
  await asAdmin(db, async () => {
    await db.query(
      `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
       values ($1, 'learn', 'match', 120, public.jst_week_start(), public.jst_today(), public.jst_now())`,
      [uidGrass]
    );
  });
  await asUser(db, uidGrass, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    const p = rows[0].p;
    assert.equal(p.stage, 5);
    assert.equal(p.stage_name, 'オオカミ級');
    assert.equal(p.next_threshold, 500);
  });

  // stage 6 (500 pt)
  await asAdmin(db, async () => {
    await db.query(
      `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
       values ($1, 'learn', 'match', 200, public.jst_week_start(), public.jst_today(), public.jst_now())`,
      [uidGrass]
    );
  });
  await asUser(db, uidGrass, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    const p = rows[0].p;
    assert.equal(p.stage, 6);
    assert.equal(p.stage_name, 'ダイアウルフ級');
    assert.equal(p.next_threshold, 800);
  });

  // stage 7 (800 pt)
  await asAdmin(db, async () => {
    await db.query(
      `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
       values ($1, 'learn', 'match', 300, public.jst_week_start(), public.jst_today(), public.jst_now())`,
      [uidGrass]
    );
  });
  await asUser(db, uidGrass, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    const p = rows[0].p;
    assert.equal(p.stage, 7);
    assert.equal(p.stage_name, '草原の王');
    assert.equal(p.next_threshold, null);
    assert.equal(p.points_to_next, 0);
  });

  // 木の上ルート (tree: commit > learn at 80 pts)
  const uidTree = crypto.randomUUID();
  await createUser(db, uidTree);
  await asUser(db, uidTree, async () => {
    await db.query(`select public.register_player('tree_cat', 3, '${TEST_INVITE}')`);
  });

  await asAdmin(db, async () => {
    await db.query(
      `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
       values
         ($1, 'learn', 'match', 35, public.jst_week_start(), public.jst_today(), public.jst_now()),
         ($1, 'commit', 'open', 45, public.jst_week_start(), public.jst_today(), public.jst_now())`,
      [uidTree]
    );
  });

  await asUser(db, uidTree, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    const p = rows[0].p;
    assert.equal(p.stage, 3);
    assert.equal(p.route, 'tree');
    assert.equal(p.stage_name, '木の上のミアキス');
  });

  // 160 -> stage 4 (ヤマネコ級)
  await asAdmin(db, async () => {
    await db.query(`insert into public.points (player_id, kind, reason, amount, week_start, day, created_at) values ($1, 'learn', 'match', 80, public.jst_week_start(), public.jst_today(), public.jst_now())`, [uidTree]);
  });
  await asUser(db, uidTree, async () => {
    const res = await db.query(`select public.my_progress() as p`);
    assert.equal(res.rows[0].p.stage_name, 'ヤマネコ級');
  });

  // 300 -> stage 5 (ヒョウ級)
  await asAdmin(db, async () => {
    await db.query(`insert into public.points (player_id, kind, reason, amount, week_start, day, created_at) values ($1, 'learn', 'match', 140, public.jst_week_start(), public.jst_today(), public.jst_now())`, [uidTree]);
  });
  await asUser(db, uidTree, async () => {
    const res = await db.query(`select public.my_progress() as p`);
    assert.equal(res.rows[0].p.stage_name, 'ヒョウ級');
  });

  // 500 -> stage 6 (トラ級)
  await asAdmin(db, async () => {
    await db.query(`insert into public.points (player_id, kind, reason, amount, week_start, day, created_at) values ($1, 'learn', 'match', 200, public.jst_week_start(), public.jst_today(), public.jst_now())`, [uidTree]);
  });
  await asUser(db, uidTree, async () => {
    const res = await db.query(`select public.my_progress() as p`);
    assert.equal(res.rows[0].p.stage_name, 'トラ級');
  });

  // 800 -> stage 7 (森の王)
  await asAdmin(db, async () => {
    await db.query(`insert into public.points (player_id, kind, reason, amount, week_start, day, created_at) values ($1, 'learn', 'match', 300, public.jst_week_start(), public.jst_today(), public.jst_now())`, [uidTree]);
  });
  await asUser(db, uidTree, async () => {
    const res = await db.query(`select public.my_progress() as p`);
    assert.equal(res.rows[0].p.stage_name, '森の王');
  });
});

test('連続日数: 今日または昨日まで途切れずに reason=open のコミットがある日数', async () => {
  const db = await setupGameTest();
  const uid = crypto.randomUUID();
  await createUser(db, uid);

  await setTestTime(db, '2026-09-25T12:00:00+09:00'); // 金曜

  await asUser(db, uid, async () => {
    await db.query(`select public.register_player('streaker', 1, '${TEST_INVITE}')`);
  });

  // 2026-09-23, 2026-09-24, 2026-09-25 に open コミットを付与
  await asAdmin(db, async () => {
    await db.query(
      `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
       values
         ($1, 'commit', 'open', 1, '2026-09-21', '2026-09-23', '2026-09-23 10:00:00+09'),
         ($1, 'commit', 'open', 1, '2026-09-21', '2026-09-24', '2026-09-24 10:00:00+09'),
         ($1, 'commit', 'open', 1, '2026-09-21', '2026-09-25', '2026-09-25 10:00:00+09')`,
      [uid]
    );
  });

  await asUser(db, uid, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    assert.equal(rows[0].p.streak_days, 3);
  });

  // 翌日 2026-09-26（土）: 今日はまだ open していないが、昨日まであるので streak は 3 のまま維持される
  await setTestTime(db, '2026-09-26T08:00:00+09:00');
  await asUser(db, uid, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    assert.equal(rows[0].p.streak_days, 3, '今日まだ開いていないが昨日まである');
  });

  // 今日 (2026-09-26) 開いた -> streak は 4 に伸びる
  await asUser(db, uid, async () => {
    await db.query(`select public.touch_today()`);
    const { rows } = await db.query(`select public.my_progress() as p`);
    assert.equal(rows[0].p.streak_days, 4);
  });

  // 2日飛んで 2026-09-28 (月) に進む (2026-09-27 を逃した) -> 途切れて 0 になる
  await setTestTime(db, '2026-09-28T09:00:00+09:00');
  await asUser(db, uid, async () => {
    const { rows } = await db.query(`select public.my_progress() as p`);
    assert.equal(rows[0].p.streak_days, 0, '途切れたので0日');
  });

  await setTestTime(db, null);
});

test('open_pack: バリデーション、1日3回上限、全問正解でSR以上、日付更新でリセット', async () => {
  const db = await setupGameTest();
  const uid1 = crypto.randomUUID();
  const uid2 = crypto.randomUUID();
  await createUser(db, uid1);
  await createUser(db, uid2);

  await setTestTime(db, '2026-09-25T10:00:00+09:00');

  let matchId1;
  let matchId2;
  let matchId3;
  let matchId4;

  await asUser(db, uid1, async () => {
    await db.query(`select public.register_player('pack_user', 2, '${TEST_INVITE}')`);
  });
  await asUser(db, uid2, async () => {
    await db.query(`select public.register_player('other_user', 2, '${TEST_INVITE}')`);
  });

  // uid1 で match を開始
  await asUser(db, uid1, async () => {
    const { rows: m1 } = await db.query(`select public.start_match() as m`);
    matchId1 = m1[0].m.match_id;

    // 1. 未完了の match を開けようとすると match_not_finished
    await assert.rejects(
      db.query(`select public.open_pack($1)`, [matchId1]),
      /match_not_finished/
    );
  });

  // 2. 他人の match を開けようとすると permission_denied
  await asUser(db, uid2, async () => {
    await assert.rejects(
      db.query(`select public.open_pack($1)`, [matchId1]),
      /permission_denied/
    );
  });

  // uid1 で match1 を完了させる
  await setTestTime(db, '2026-09-25T10:00:10+09:00');
  const dummyAnswers = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ choice: 0, ms: 500 })));

  await asUser(db, uid1, async () => {
    await db.query(`select public.submit_match($1, $2::jsonb)`, [matchId1, dummyAnswers]);

    // 3. 正常にカードパックを開封
    const { rows: draw1 } = await db.query(`select public.open_pack($1) as res`, [matchId1]);
    const card1 = draw1[0].res;
    assert.ok(card1.en);
    assert.ok(card1.ja);
    assert.ok(card1.rarity >= 1 && card1.rarity <= 4);
    assert.equal(card1.is_new, true);
    assert.equal(card1.count, 1);
    assert.equal(card1.remaining, 2);

    // 4. 二重開封は already_drawn
    await assert.rejects(
      db.query(`select public.open_pack($1)`, [matchId1]),
      /already_drawn/
    );

    // pack_status の残り回数確認
    const { rows: st1 } = await db.query(`select public.pack_status() as s`);
    assert.equal(st1[0].s.remaining, 2);
  });

  // 2戦目
  await setTestTime(db, '2026-09-25T10:05:00+09:00');
  await asUser(db, uid1, async () => {
    const { rows: m2 } = await db.query(`select public.start_match() as m`);
    matchId2 = m2[0].m.match_id;
  });
  await setTestTime(db, '2026-09-25T10:05:10+09:00');
  await asUser(db, uid1, async () => {
    await db.query(`select public.submit_match($1, $2::jsonb)`, [matchId2, dummyAnswers]);
    const { rows: draw2 } = await db.query(`select public.open_pack($1) as res`, [matchId2]);
    assert.equal(draw2[0].res.remaining, 1);
  });

  // 3戦目
  await setTestTime(db, '2026-09-25T10:10:00+09:00');
  await asUser(db, uid1, async () => {
    const { rows: m3 } = await db.query(`select public.start_match() as m`);
    matchId3 = m3[0].m.match_id;
  });
  await setTestTime(db, '2026-09-25T10:10:10+09:00');
  await asUser(db, uid1, async () => {
    await db.query(`select public.submit_match($1, $2::jsonb)`, [matchId3, dummyAnswers]);
    const { rows: draw3 } = await db.query(`select public.open_pack($1) as res`, [matchId3]);
    assert.equal(draw3[0].res.remaining, 0);
  });

  // 4戦目: 1日3回の上限を超えたら pack_limit
  await setTestTime(db, '2026-09-25T10:15:00+09:00');
  await asUser(db, uid1, async () => {
    const { rows: m4 } = await db.query(`select public.start_match() as m`);
    matchId4 = m4[0].m.match_id;
  });
  await setTestTime(db, '2026-09-25T10:15:10+09:00');
  await asUser(db, uid1, async () => {
    await db.query(`select public.submit_match($1, $2::jsonb)`, [matchId4, dummyAnswers]);
    await assert.rejects(
      db.query(`select public.open_pack($1)`, [matchId4]),
      /pack_limit/
    );

    const { rows: st2 } = await db.query(`select public.pack_status() as s`);
    assert.equal(st2[0].s.remaining, 0);
  });

  // 5. 日付が変わると戻る (2026-09-26)
  await setTestTime(db, '2026-09-26T09:00:00+09:00');
  await asUser(db, uid1, async () => {
    const { rows: st3 } = await db.query(`select public.pack_status() as s`);
    assert.equal(st3[0].s.remaining, 3);

    // 昨日引けなかった matchId4 を今日開封できる
    const { rows: draw4 } = await db.query(`select public.open_pack($1) as res`, [matchId4]);
    assert.equal(draw4[0].res.remaining, 2);
  });

  // 6. 全問正解なら SR (3) または UR (4)
  for (let round = 0; round < 3; round++) {
    await setTestTime(db, `2026-09-27T10:0${round}:00+09:00`);
    let pMatchId;
    await asUser(db, uid1, async () => {
      const { rows: pm } = await db.query(`select public.start_match() as m`);
      pMatchId = pm[0].m.match_id;
    });

    // 正解を取得して全問正解を作る
    let questions;
    await asAdmin(db, async () => {
      const { rows: qr } = await db.query(`select questions from public.matches where id = $1`, [pMatchId]);
      questions = qr[0].questions;
    });

    const perfectAnswers = JSON.stringify(questions.map(q => ({ choice: q.answer_index, ms: 500 })));
    await setTestTime(db, `2026-09-27T10:0${round}:10+09:00`);
    await asUser(db, uid1, async () => {
      await db.query(`select public.submit_match($1, $2::jsonb)`, [pMatchId, perfectAnswers]);

      const { rows: drawPerfect } = await db.query(`select public.open_pack($1) as res`, [pMatchId]);
      const card = drawPerfect[0].res;
      assert.ok(
        card.rarity === 3 || card.rarity === 4,
        `全問正解なのに SR/UR 以外が出た: rarity=${card.rarity}`
      );
    });
  }

  await setTestTime(db, null);
});

test('my_collection: 所持カードと段ごとの集計', async () => {
  const db = await setupGameTest();
  const uid = crypto.randomUUID();
  await createUser(db, uid);

  await asUser(db, uid, async () => {
    await db.query(`select public.register_player('collector', 1, '${TEST_INVITE}')`);

    // 初期状態: カード0枚
    const { rows } = await db.query(`select public.my_collection() as c`);
    const col = rows[0].c;
    assert.deepEqual(col.cards, []);
    assert.equal(col.bands.length, 5);
    for (const b of col.bands) {
      assert.equal(b.collected, 0);
      assert.ok(b.total > 0);
    }
  });

  // 意図的に card_collection に投入（band 1 の語を2枚、うち1枚は重複）
  await asAdmin(db, async () => {
    const { rows: wRows } = await db.query(`select id from public.words where band = 1 limit 2`);
    const w1 = wRows[0].id;
    const w2 = wRows[1].id;

    await db.query(
      `insert into public.card_collection (player_id, word_id, rarity, count, first_at)
       values
         ($1, $2, 1, 2, public.jst_now()),
         ($1, $3, 3, 1, public.jst_now())`,
      [uid, w1, w2]
    );
  });

  await asUser(db, uid, async () => {
    const { rows } = await db.query(`select public.my_collection() as c`);
    const col = rows[0].c;
    assert.equal(col.cards.length, 2);
    const band1Stat = col.bands.find(b => b.band === 1);
    assert.equal(band1Stat.collected, 2);
    assert.equal(col.cards.find(c => c.count === 2).rarity, 1);
  });
});
