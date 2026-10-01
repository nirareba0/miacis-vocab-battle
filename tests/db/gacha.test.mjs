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

async function setupGachaTest() {
  const db = await createTestDb();
  await seedTestWords(db);
  return db;
}

async function createPlayer(db, nickname = 'player1', grade = 2) {
  const uid = crypto.randomUUID();
  await createUser(db, uid);
  await asUser(db, uid, async () => {
    await db.query(`select public.register_player($1, $2, null)`, [nickname, grade]);
  });
  return uid;
}

test('木の実: 二重に入らない・1日の上限の切り詰め・使うときは上限に数えない・日付が変わると戻る', async () => {
  const db = await setupGachaTest();
  const uid = await createPlayer(db, 'nut_hero');

  await setTestTime(db, '2026-09-25T10:00:00+09:00');

  // 上限を50に設定してテスト
  await db.query(`insert into public.app_settings (key, value) values ('nuts_daily_cap', '50')
                  on conflict (key) do update set value = excluded.value`);

  await asAdmin(db, async () => {
    // 1. 30 個獲得
    const res1 = await db.query(`select public.add_nuts($1, 30, 'test', 'ref1') as added`, [uid]);
    assert.equal(res1.rows[0].added, 30);

    // 2. 同じ理由・同じ ref で二重に入らない (unique 制約)
    await assert.rejects(
      db.query(`select public.add_nuts($1, 10, 'test', 'ref1')`, [uid]),
      /duplicate key value violates unique constraint/
    );

    // 3. 上限（50）の切り詰め: 30獲得済みなので、30追加しようとしても20に切り詰められる
    const res2 = await db.query(`select public.add_nuts($1, 30, 'test', 'ref2') as added`, [uid]);
    assert.equal(res2.rows[0].added, 20);

    // 上限到達後は 0
    const res3 = await db.query(`select public.add_nuts($1, 10, 'test', 'ref3') as added`, [uid]);
    assert.equal(res3.rows[0].added, 0);

    // 4. 使うとき（マイナス）は上限に数えない
    // 現在の残高は 50。25 を使う
    const resUse = await db.query(`select public.add_nuts($1, -25, 'use', 'ref_use1') as used`, [uid]);
    assert.equal(resUse.rows[0].used, -25);

    // 使うと残高は 25 になるが、今日の獲得累計（amount > 0）は 50 のままなので、本日はこれ以上獲得できない
    const res4 = await db.query(`select public.add_nuts($1, 10, 'test', 'ref4') as added`, [uid]);
    assert.equal(res4.rows[0].added, 0);

    // 残高が足りない場合は not_enough_nuts
    await assert.rejects(
      db.query(`select public.add_nuts($1, -100, 'use', 'ref_use2')`, [uid]),
      /not_enough_nuts/
    );
  });

  // 5. 日付が変わると、上限枠がリセットされてまた獲得できる
  await setTestTime(db, '2026-09-26T10:00:00+09:00');
  await asAdmin(db, async () => {
    const resNextDay = await db.query(`select public.add_nuts($1, 20, 'test', 'ref_next_day') as added`, [uid]);
    assert.equal(resNextDay.rows[0].added, 20);
  });

  // my_nuts の検証
  await asUser(db, uid, async () => {
    const { rows } = await db.query(`select public.my_nuts() as nuts`);
    // 残高: 50 - 25 + 20 = 45
    // 今日(09-26)の獲得: 20
    assert.equal(rows[0].nuts.balance, 45);
    assert.equal(rows[0].nuts.today_earned, 20);
    assert.equal(rows[0].nuts.daily_cap, 50);
    assert.equal(rows[0].nuts.remaining_cap, 30);
  });
});

test('claim_match_nuts と claim_daily_nuts: 正解と勝利ボーナス、1matchにつき1回、未終了拒否、デイリーボーナス', async () => {
  const db = await setupGachaTest();
  const uid = await createPlayer(db, 'match_hero');

  await setTestTime(db, '2026-09-25T10:00:00+09:00');

  // match 開始
  let matchId;
  await asUser(db, uid, async () => {
    const startRes = await db.query(`select public.start_match() as m`);
    matchId = startRes.rows[0].m.match_id;

    // 未終了の match は claim_match_nuts できない
    await assert.rejects(
      db.query(`select public.claim_match_nuts($1)`, [matchId]),
      /match_not_finished/
    );
  });

  // 10問全問正解で勝利させる (correct: 10, win: 10 + 3 + 5 = 18 nuts)
  // questions を admin 権限で取得して正解の choice で回答
  let questions;
  await asAdmin(db, async () => {
    const { rows } = await db.query(`select questions from public.matches where id = $1`, [matchId]);
    questions = rows[0].questions;
  });

  const answers = questions.map(q => ({
    choice: q.answer_index,
    ms: 500
  }));

  // 回答時間調整（too_fast 回避）
  await setTestTime(db, '2026-09-25T10:00:10+09:00');

  await asUser(db, uid, async () => {
    const subRes = await db.query(`select public.submit_match($1, $2::jsonb) as res`, [matchId, JSON.stringify(answers)]);
    assert.equal(subRes.rows[0].res.correct, 10);
    assert.equal(subRes.rows[0].res.result, 'win');

    // claim_match_nuts 呼び出し: 10(正解) + 3(勝利) + 5(全問正解) = 18 に 1/3 を掛けて 6 木の実
    const claimRes = await db.query(`select public.claim_match_nuts($1) as n`, [matchId]);
    const nuts = claimRes.rows[0].n;
    assert.equal(nuts.raw, 6);
    assert.equal(nuts.earned, 6);
    assert.equal(nuts.capped, false);
    assert.equal(nuts.balance, 6);

    // 同じ match で2回目は拒否 (already_claimed)
    await assert.rejects(
      db.query(`select public.claim_match_nuts($1)`, [matchId]),
      /already_claimed/
    );

    // claim_daily_nuts
    const daily1 = await db.query(`select public.claim_daily_nuts() as d`);
    assert.equal(daily1.rows[0].d.earned, 2); // 5 × 1/3 を四捨五入
    assert.equal(daily1.rows[0].d.already_claimed, false);
    assert.equal(daily1.rows[0].d.balance, 8); // 6 + 2

    // 同日2回目は earned 0
    const daily2 = await db.query(`select public.claim_daily_nuts() as d`);
    assert.equal(daily2.rows[0].d.earned, 0);
    assert.equal(daily2.rows[0].d.already_claimed, true);
    assert.equal(daily2.rows[0].d.balance, 8);
  });
});

test('ガチャ: 値段・足りない・1と10以外は拒否・10連の SR 以上保証・重なりでかけら', async () => {
  const db = await setupGachaTest();
  const uid = await createPlayer(db, 'gacha_hero');

  // 景品率を 0 にしてアイテムガチャをテスト
  await db.query(`insert into public.app_settings (key, value) values ('prize_rate', '0')
                  on conflict (key) do update set value = excluded.value`);

  await asUser(db, uid, async () => {
    // 1. 木の実 0 で引こうとすると not_enough_nuts
    await assert.rejects(db.query(`select public.pull_gacha(1)`), /not_enough_nuts/);

    // 不正な回数は拒否
    await assert.rejects(db.query(`select public.pull_gacha(5)`), /invalid_pull_count/);
    await assert.rejects(db.query(`select public.pull_gacha(0)`), /invalid_pull_count/);
  });

  // 木の実を 100 付与（1日の上限 100 ちょうど）
  await asAdmin(db, async () => {
    await db.query(`select public.add_nuts($1, 100, 'admin_grant', 'ref1')`, [uid]);
  });

  await asUser(db, uid, async () => {
    // 1回引く (5消費、残高 95)
    const { rows: r1 } = await db.query(`select public.pull_gacha(1) as res`);
    const g1 = r1[0].res;
    assert.equal(g1.spent_nuts, 5);
    assert.equal(g1.balance, 95);
    assert.equal(g1.results.length, 1);
    assert.equal(g1.results[0].kind, 'item');
    assert.equal(g1.results[0].is_new, true);
    assert.equal(g1.results[0].shards, 0);

    // まとめ引き (50消費で11回、残高 45)
    const { rows: r10 } = await db.query(`select public.pull_gacha(10) as res`);
    const g10 = r10[0].res;
    assert.equal(g10.spent_nuts, 50);
    assert.equal(g10.balance, 45);
    assert.equal(g10.results.length, 11);
    assert.equal(g10.count, 11);

    // 10連の中に SR (rarity 3) 以上が必ず1つ以上含まれる
    const hasSrOrAbove = g10.results.some(it => it.rarity >= 3);
    assert.equal(hasSrOrAbove, true, '10連にはSR以上が最低1つ含まれること');
  });

  // 重なりでかけらを検証
  // 特定のアイテムを先に付与しておき、ガチャまたは exchange で確認
  await asAdmin(db, async () => {
    // uid に hat_cap (N, rarity 1) を所持させる
    await db.query(`insert into public.player_items (player_id, item_id, count) values ($1, 'hat_cap', 1)
                    on conflict (player_id, item_id) do nothing`, [uid]);
  });

  // ガチャのテーブルで hat_cap 以外の active を一時的に false にして確実に hat_cap が出るようにする
  await db.query(`update public.items set active = false where id <> 'hat_cap' and rarity = 1`);

  // 木の実を追加
  await asAdmin(db, async () => {
    await db.query(`select public.add_nuts($1, 100, 'admin_grant', 'ref2')`, [uid]);
    // 確実にテストするため、全アイテムを hat_cap 以外 active=false にする
    await db.query(`update public.items set active = false where id <> 'hat_cap'`);
  });

  await asUser(db, uid, async () => {
    // Nアイテムのみが出る確率で1連を引く（SR以上確定枠のない通常1連）
    const { rows } = await db.query(`select public.pull_gacha(1) as res`);
    const res = rows[0].res;
    const item = res.results[0];
    assert.equal(item.id, 'hat_cap');
    assert.equal(item.is_new, false);
    assert.equal(item.shards, 1); // N の重なりは かけら +1
    assert.ok(res.shards_balance >= 1);
  });

  // 元に戻す
  await asAdmin(db, async () => {
    await db.query(`update public.items set active = true`);
  });
});

test('景品: 在庫0の景品は出ない・景品の在庫が減る・prize_rate=1 にすると必ず景品・チケット発行', async () => {
  const db = await setupGachaTest();
  const uid = await createPlayer(db, 'p_winner');

  // 木の実を付与
  await asAdmin(db, async () => {
    await db.query(`select public.add_nuts($1, 100, 'admin_grant', 'ref1')`, [uid]);
  });

  // prize_rate を 1.0 に設定（必ず景品判定に入る）
  await db.query(`insert into public.app_settings (key, value) values ('prize_rate', '1.0')
                  on conflict (key) do update set value = excluded.value`);

  // 1. 景品が 0 件のときは、景品が出ずに通常のアイテム抽選に倒れる
  await asUser(db, uid, async () => {
    const { rows } = await db.query(`select public.pull_gacha(1) as res`);
    assert.equal(rows[0].res.results[0].kind, 'item');
  });

  // 2. 在庫 0 の景品があっても出ない
  const prizeId0 = crypto.randomUUID();
  await asAdmin(db, async () => {
    await db.query(`insert into public.prizes (id, name, description, stock, active) values ($1, '品切れ景品', '在庫なし', 0, true)`, [prizeId0]);
  });
  await asUser(db, uid, async () => {
    const { rows } = await db.query(`select public.pull_gacha(1) as res`);
    assert.equal(rows[0].res.results[0].kind, 'item');
  });

  // 3. 在庫 1 の景品を追加 -> 必ず当選して在庫が 0 になり、チケットが発行される
  const prizeId1 = crypto.randomUUID();
  await asAdmin(db, async () => {
    await db.query(`insert into public.prizes (id, name, description, stock, active) values ($1, '特製シール', '館内引換券', 1, true)`, [prizeId1]);
  });

  await asUser(db, uid, async () => {
    const { rows } = await db.query(`select public.pull_gacha(1) as res`);
    const result = rows[0].res.results[0];
    assert.equal(result.kind, 'prize');
    assert.equal(result.name, '特製シール');
    assert.ok(result.ticket_id);

    // チケット一覧（my_tickets）で確認
    const { rows: tRows } = await db.query(`select public.my_tickets() as t`);
    const tickets = tRows[0].t;
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].prize_name, '特製シール');
    assert.equal(tickets[0].redeemed_at, null);
  });

  // 在庫が 0 になっていること (admin で確認)
  await asAdmin(db, async () => {
    const { rows: pRows } = await db.query(`select stock from public.prizes where id = $1`, [prizeId1]);
    assert.equal(pRows[0].stock, 0);
  });
});

test('交換: かけらで交換・足りないとエラー・景品とは交換不可', async () => {
  const db = await setupGachaTest();
  const uid = await createPlayer(db, 'p_trader');

  // かけらを 35 付与
  await db.query(`insert into public.player_shards (player_id, amount) values ($1, 35)`, [uid]);

  await asUser(db, uid, async () => {
    // N アイテム (hat_straw: cost 10) を交換 -> 残り 25
    const { rows: r1 } = await db.query(`select public.exchange_item('hat_straw') as res`);
    assert.equal(r1[0].res.shards_balance, 25);
    assert.equal(r1[0].res.count, 1);

    // R アイテム (hat_grad: cost 30) を交換しようとすると、残高25のため not_enough_shards
    await assert.rejects(
      db.query(`select public.exchange_item('hat_grad')`),
      /not_enough_shards/
    );

    // 存在しないアイテム
    await assert.rejects(
      db.query(`select public.exchange_item('unknown_item')`),
      /item_not_found/
    );
  });
});

test('装備: 持っていないものは付けられない・slot 違いは拒否・装備と外す・public_looks に id と学年が無い', async () => {
  const db = await setupGachaTest();
  const uid = await createPlayer(db, 'p_fashion', 3);

  // 1. 未所持アイテムの装備はエラー
  await asUser(db, uid, async () => {
    await assert.rejects(
      db.query(`select public.equip_item('hat', 'hat_crown')`),
      /item_not_owned/
    );
  });

  // face アイテムを持たせる
  await asAdmin(db, async () => {
    await db.query(`insert into public.player_items (player_id, item_id, count) values ($1, 'face_glasses', 1)`, [uid]);
  });

  // 2. slot 不一致、装備、外す、再装備
  await asUser(db, uid, async () => {
    // slot の不一致 (face アイテムを hat に装備しようとする)
    await assert.rejects(
      db.query(`select public.equip_item('hat', 'face_glasses')`),
      /slot_mismatch/
    );

    // 正しいスロットに装備
    const eqRes = await db.query(`select public.equip_item('face', 'face_glasses') as res`);
    assert.equal(eqRes.rows[0].res.success, true);

    // 外す (null)
    const unRes = await db.query(`select public.equip_item('face', null) as res`);
    assert.equal(unRes.rows[0].res.success, true);

    // 再度装備
    await db.query(`select public.equip_item('face', 'face_glasses')`);
  });

  // public_looks ビューの検証: id と学年が含まれていないこと！
  await asAnon(db, async () => {
    const { rows } = await db.query(`select * from public.public_looks where nickname = 'p_fashion'`);
    assert.equal(rows.length, 1);
    const row = rows[0];

    // nickname, tier, route, looks だけがあること
    assert.equal(row.nickname, 'p_fashion');
    assert.equal(row.tier, 1);
    assert.ok(row.looks);
    assert.equal(row.looks.face.id, 'face_glasses');
    assert.equal(row.looks.hat, null);

    // id (UUID) と grade が列に存在しないこと
    assert.equal('id' in row, false, 'public_looks に id 列が含まれてはいけない');
    assert.equal('grade' in row, false, 'public_looks に grade 列が含まれてはいけない');
    assert.equal('player_id' in row, false, 'public_looks に player_id 列が含まれてはいけない');
  });
});

test('スタッフ権限: スタッフ以外は景品作成・チケット交換できない・スタッフは可能', async () => {
  const db = await setupGachaTest();
  const playerUid = await createPlayer(db, 'p_normal');

  const staffUid = crypto.randomUUID();
  await createUser(db, staffUid, 'staff@miacis.example');
  await db.query(`insert into public.staff (user_id) values ($1)`, [staffUid]);

  // 1. 一般プレイヤーは staff_upsert_prize を呼べない
  await asUser(db, playerUid, async () => {
    await assert.rejects(
      db.query(`select public.staff_upsert_prize(null, 'ペン', '青ペン', 10, true)`),
      /not_a_staff/
    );
    await assert.rejects(
      db.query(`select public.staff_list_tickets(true)`),
      /not_a_staff/
    );
  });

  // 2. スタッフなら staff_upsert_prize で景品を作成できる
  let prizeId;
  await asUser(db, staffUid, async () => {
    const { rows } = await db.query(`select * from public.staff_upsert_prize(null, '特製ノート', 'B5ノート', 5, true)`);
    assert.equal(rows[0].name, '特製ノート');
    assert.equal(rows[0].stock, 5);
    prizeId = rows[0].id;
  });

  // プレイヤーがチケットを獲得
  const ticketId = crypto.randomUUID();
  await db.query(`insert into public.prize_tickets (id, player_id, prize_id) values ($1, $2, $3)`, [ticketId, playerUid, prizeId]);

  // 3. 一般プレイヤーは staff_redeem_ticket を呼べない
  await asUser(db, playerUid, async () => {
    await assert.rejects(
      db.query(`select public.staff_redeem_ticket($1)`, [ticketId]),
      /not_a_staff/
    );
  });

  // 4. スタッフは staff_list_tickets を見られ、staff_redeem_ticket で交換できる
  await asUser(db, staffUid, async () => {
    const { rows: listRows } = await db.query(`select public.staff_list_tickets(true) as list`);
    assert.equal(listRows[0].list.length, 1);
    assert.equal(listRows[0].list[0].nickname, 'p_normal');
    assert.equal(listRows[0].list[0].prize_name, '特製ノート');

    // 交換実行
    const { rows: redRows } = await db.query(`select public.staff_redeem_ticket($1) as res`, [ticketId]);
    assert.ok(redRows[0].res.redeemed_at);
    assert.equal(redRows[0].res.redeemed_by, staffUid);

    // 二重交換は already_redeemed
    await assert.rejects(
      db.query(`select public.staff_redeem_ticket($1)`, [ticketId]),
      /already_redeemed/
    );
  });
});

test('my_words: 正解した単語の集計と段ごとの達成率', async () => {
  const db = await setupGachaTest();
  const uid = await createPlayer(db, 'p_vocab');

  // match を作成し、band 1 の単語 3 問を正解させて終了状態にする
  const matchId = crypto.randomUUID();
  const questions = [
    { word_id: 1, answer_index: 0 },
    { word_id: 2, answer_index: 1 },
    { word_id: 3, answer_index: 2 },
    { word_id: 4, answer_index: 3 },
  ];
  // 1, 2 は正解、3 は不正解 (choice 0)、4 はタイムアウト (ms 6000)
  const answers = [
    { choice: 0, ms: 500 },
    { choice: 1, ms: 800 },
    { choice: 0, ms: 700 }, // 不正解
    { choice: 3, ms: 6000 }, // タイムアウト扱い
  ];

  await asAdmin(db, async () => {
    await db.query(`
      insert into public.matches (id, player_id, band, questions, answers, correct, total_ms, finished_at, week_start)
      values ($1, $2, 1, $3::jsonb, $4::jsonb, 2, 8000, now(), public.jst_week_start())
    `, [matchId, uid, JSON.stringify(questions), JSON.stringify(answers)]);
  });

  await asUser(db, uid, async () => {
    const { rows } = await db.query(`select public.my_words() as w`);
    const data = rows[0].w;
    // 正解した単語は word_id 1 と 2 のみ
    assert.equal(data.words.length, 2);
    const wordIds = data.words.map(w => w.word_id).sort();
    assert.deepEqual(wordIds, [1, 2]);

    // band 1 の collected は 2
    const band1 = data.bands.find(b => b.band === 1);
    assert.equal(band1.collected, 2);
    assert.ok(band1.total >= 2);
  });
});
