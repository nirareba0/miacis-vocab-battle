import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb, seedTestWords, createUser, asUser, asAnon, setTestTime } from './helper.mjs';

async function setup() {
  const db = await createTestDb();
  await seedTestWords(db, 30); // 150語。連続チャレンジの範囲は15語ずつ、100本ノックの段は30語
  await setTestTime(db, '2026-10-01T12:00:00+09:00');
  return db;
}

async function player(db, name, staff = false) {
  const id = randomUUID();
  await createUser(db, id);
  await asUser(db, id, () => db.query('select public.register_player($1,1,null)', [name]));
  if (staff) await db.query('insert into public.staff(user_id) values($1)', [id]);
  return id;
}

const call = (db, id, sql, params = []) =>
  asUser(db, id, async () => (await db.query(sql, params)).rows[0].r);

const start = (db, id, mode) => call(db, id, 'select public.start_run($1) as r', [mode]);
const answer = (db, id, runId, choice, ms = 1000) =>
  call(db, id, 'select public.answer_run($1,$2,$3) as r', [runId, choice, ms]);

// 正解は端末に来ないので、テストだけ管理者として覗く
async function answerIndex(db, runId) {
  return (await db.query("select (current->>'answer_index')::int as a from public.runs where id=$1", [runId])).rows[0].a;
}

async function answerRight(db, id, runId, ms = 1000) {
  return answer(db, id, runId, await answerIndex(db, runId), ms);
}

async function answerWrong(db, id, runId) {
  return answer(db, id, runId, ((await answerIndex(db, runId)) + 1) % 4);
}

test('連続チャレンジ: 正解は端末に来ない。5問ごとに範囲が上がる。制限時間は7秒のまま', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    assert.equal(s.question.answer_index, undefined);
    assert.equal(s.question.issued_at, undefined);
    assert.equal(s.question.stage, 1);
    assert.equal(s.question.range, 1);
    assert.equal(s.question.limit_ms, 7000);

    let q = s.question;
    for (let i = 0; i < 5; i++) {
      const r = await answerRight(db, a, s.run_id);
      assert.equal(r.correct, true);
      assert.equal(r.state, 'next');
      q = r.question;
    }
    // STAGE 2 に上がった直後の 2 問は「平地」: 範囲は 1 のまま。時間は 7 秒固定（0012）
    assert.equal(q.stage, 2);
    assert.equal(q.range, 1);
    assert.equal(q.limit_ms, 7000);
    for (let i = 0; i < 2; i++) q = (await answerRight(db, a, s.run_id)).question;
    assert.equal(q.range, 2);
    // 範囲2の単語は頻度順で 16〜30 番目
    const rank = (await db.query('select rank from public.words where id=$1', [q.word_id])).rows[0].rank;
    assert.ok(rank >= 16 && rank <= 30, `rank ${rank}`);

    await asAnon(db, async () => {
      await assert.rejects(db.exec('select * from public.runs'), /permission denied/);
    });
    await asUser(db, a, async () => {
      await assert.rejects(db.exec('select * from public.runs'), /permission denied/);
      await assert.rejects(db.exec("select public.run_finish(gen_random_uuid(),'quit')"), /permission denied/);
    });
  } finally {
    await db.close();
  }
});

test('連続チャレンジ: 間違えたら即終了。ポイント・木の実が付き、ランキングに出る', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    for (let i = 0; i < 6; i++) await answerRight(db, a, s.run_id);
    const r = await answerWrong(db, a, s.run_id);
    assert.equal(r.correct, false);
    assert.equal(r.state, 'finished');
    assert.equal(r.result.correct, 6);
    assert.equal(r.result.end_reason, 'wrong');
    assert.equal(r.result.learn_points, 6);
    assert.equal(r.result.nuts, 1); // 素点 6×10=60 → 2 個 × 1/3 → 四捨五入で 1
    assert.equal(r.result.new_best, true);
    assert.equal(r.result.missed.length, 1);

    await assert.rejects(answerRight(db, a, s.run_id), /run_not_active/);

    const rows = (await db.query('select nickname, best_streak, rank from public.ranking_streak_week')).rows;
    assert.deepEqual(rows, [{ nickname: 'A', best_streak: 6, rank: 1 }]);

    // 2回目が低くても、自己ベストは6のまま
    const s2 = await start(db, a, 'streak');
    const r2 = await answerWrong(db, a, s2.run_id);
    assert.equal(r2.result.new_best, false);
    assert.equal(r2.result.best.correct, 6);
  } finally {
    await db.close();
  }
});

test('連続チャレンジ: 時間切れは1回だけ復活できる。2回目の時間切れで終わる', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    await answerRight(db, a, s.run_id);
    await answerRight(db, a, s.run_id);

    const t1 = await answer(db, a, s.run_id, null, null);
    assert.equal(t1.timeout, true);
    assert.equal(t1.state, 'revive_offer');

    // 復活待ちの間は答えられない
    await assert.rejects(answerRight(db, a, s.run_id), /run_not_active/);

    const rv = await call(db, a, 'select public.revive_run($1) as r', [s.run_id]);
    assert.equal(rv.state, 'next');
    assert.equal(rv.score, 2);
    assert.equal(rv.question.no, 3); // 時間切れの1問は数えない

    await answerRight(db, a, s.run_id);
    const t2 = await answer(db, a, s.run_id, null, null);
    assert.equal(t2.state, 'finished');
    assert.equal(t2.result.correct, 3);
    assert.equal(t2.result.end_reason, 'timeout');
    assert.equal(t2.result.revive_used, true);

    await assert.rejects(call(db, a, 'select public.revive_run($1) as r', [s.run_id]), /revive_not_available/);
  } finally {
    await db.close();
  }
});

test('連続チャレンジ: 復活を10秒以上迷うと終わる。やめるを選んでも終わる', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    await answerRight(db, a, s.run_id);
    await answer(db, a, s.run_id, null, null);
    await setTestTime(db, '2026-10-01T12:00:11+09:00');
    const rv = await call(db, a, 'select public.revive_run($1) as r', [s.run_id]);
    assert.equal(rv.state, 'finished');
    assert.equal(rv.result.correct, 1);

    const s2 = await start(db, a, 'streak');
    await answer(db, a, s2.run_id, null, null);
    const e = await call(db, a, 'select public.end_run($1) as r', [s2.run_id]);
    assert.equal(e.status, 'finished');
    assert.equal(e.end_reason, 'timeout');
  } finally {
    await db.close();
  }
});

test('時間: 制限時間を過ぎてから送った正解は時間切れ。端末の時間を短く偽っても順位用の時間は縮まない', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    const idx = await answerIndex(db, s.run_id);
    await setTestTime(db, '2026-10-01T12:00:10+09:00'); // 7秒 + 猶予2.5秒 を超える
    const late = await answer(db, a, s.run_id, idx, 500);
    assert.equal(late.correct, false);
    assert.equal(late.timeout, true);

    const s2 = await start(db, a, 'streak');
    await setTestTime(db, '2026-10-01T12:00:16+09:00'); // 出題から6秒後
    await answerRight(db, a, s2.run_id, 100);
    const total = (await db.query('select total_ms from public.runs where id=$1', [s2.run_id])).rows[0].total_ms;
    assert.ok(total >= 3500, `total_ms ${total}`);
  } finally {
    await db.close();
  }
});

test('100本ノック: 間違えても続く。100問で終わり、やり切った回だけが記録とランキングに出る', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const b = await player(db, 'B');
    const s = await start(db, a, 'knock');
    assert.equal(s.band, 1);
    assert.equal(s.total, 100);
    assert.equal(s.question.limit_ms, 6000);

    let last;
    for (let i = 0; i < 100; i++) {
      last = i % 10 === 0 ? await answerWrong(db, a, s.run_id) : await answerRight(db, a, s.run_id);
      if (i < 99) assert.equal(last.state, 'next');
    }
    assert.equal(last.state, 'finished');
    assert.equal(last.result.correct, 90);
    assert.equal(last.result.end_reason, 'complete');
    assert.equal(last.result.nuts, 15); // 素点 90×10=900 → 36 個、完走 +5、90問以上 +3 → 44 × 1/3
    assert.equal(last.result.missed.length, 10);

    // 途中でやめた回は記録に出ない
    const sb = await start(db, b, 'knock');
    for (let i = 0; i < 5; i++) await answerRight(db, b, sb.run_id);
    const quit = await call(db, b, 'select public.end_run($1) as r', [sb.run_id]);
    assert.equal(quit.end_reason, 'quit');
    assert.equal(quit.best, null);

    const rows = (await db.query('select band, nickname, best_correct, rank from public.ranking_knock_week')).rows;
    assert.deepEqual(rows, [{ band: 1, nickname: 'A', best_correct: 90, rank: 1 }]);

    const bests = await call(db, a, 'select public.my_run_bests() as r');
    assert.equal(bests.knock.correct, 90);
    assert.equal(bests.streak, null);
  } finally {
    await db.close();
  }
});

test('やりかけは次に始めたとき、そこまでの記録で締める。スタッフは「スタッフ」の印つきでランキングに出る。他人の回には触れない', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const staff = await player(db, 'Staff', true);
    const s = await start(db, a, 'streak');
    await answerRight(db, a, s.run_id);
    await answerRight(db, a, s.run_id);
    await start(db, a, 'streak');
    const old = (await db.query('select status, end_reason, correct from public.runs where id=$1', [s.run_id])).rows[0];
    assert.deepEqual(old, { status: 'finished', end_reason: 'abandoned', correct: 2 });

    const ss = await start(db, staff, 'streak');
    for (let i = 0; i < 3; i++) await answerRight(db, staff, ss.run_id);
    await answerWrong(db, staff, ss.run_id);
    const rows = (await db.query('select nickname, is_staff from public.ranking_streak_all order by rank')).rows;
    assert.deepEqual(rows, [{ nickname: 'Staff', is_staff: true }, { nickname: 'A', is_staff: false }]);

    await assert.rejects(answer(db, staff, s.run_id, 0), /permission_denied/);
    await assert.rejects(start(db, a, 'hard'), /invalid_mode/);
  } finally {
    await db.close();
  }
});

test('夢中にさせる仕掛け: 結果に今週の順位とすぐ上の相手。正解した単語は図鑑に入る。連続ログインでボーナス', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const b = await player(db, 'B');
    // B が先に 8 問連続
    const sb = await start(db, b, 'streak');
    for (let i = 0; i < 8; i++) await answerRight(db, b, sb.run_id);
    const rb = await answerWrong(db, b, sb.run_id);
    assert.equal(rb.result.week_rank, 1);
    assert.equal(rb.result.rival, null);

    // A は 3 問連続 → 2位、すぐ上は B(8)
    const sa = await start(db, a, 'streak');
    for (let i = 0; i < 3; i++) await answerRight(db, a, sa.run_id);
    const ra = await answerWrong(db, a, sa.run_id);
    assert.equal(ra.result.week_rank, 2);
    assert.deepEqual(ra.result.rival, { nickname: 'B', correct: 8, rank: 1, is_staff: false });

    // 図鑑: A が対戦をしていなくても、連続チャレンジで正解した 3 語が入る
    const words = await call(db, a, 'select public.my_words() as r');
    assert.equal(words.words.length, 3);

    // 連続ログイン: 3日目のログインボーナスは +1、7日目は +3（倍率 1/3 は掛けない）
    await asUser(db, a, () => db.query('select public.touch_today()')); // 10/1（1日目）
    for (const [day, expected] of [['2026-10-02', 2], ['2026-10-03', 3], ['2026-10-04', 3], ['2026-10-05', 3], ['2026-10-06', 3], ['2026-10-07', 5]]) {
      await setTestTime(db, `${day}T09:00:00+09:00`);
      await asUser(db, a, () => db.query('select public.touch_today()'));
      const d = await call(db, a, 'select public.claim_daily_nuts() as r');
      assert.equal(d.earned, expected, `${day}: streak ${d.streak_days}`);
    }
  } finally {
    await db.close();
  }
});

test('称号: 10連続・復活からの逆転・100本完走で入手。ガチャには出ない。2回目は付かない', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    // 復活を使ってから 10 連続 → 10連続サバイバー + 逆転のサバイバー
    const s = await start(db, a, 'streak');
    await answerRight(db, a, s.run_id);
    await answer(db, a, s.run_id, null, null);
    await call(db, a, 'select public.revive_run($1) as r', [s.run_id]);
    for (let i = 0; i < 9; i++) await answerRight(db, a, s.run_id);
    const r = await answerWrong(db, a, s.run_id);
    assert.deepEqual(r.result.new_titles.map(t => t.id).sort(), ['title_comeback', 'title_streak10']);

    // もう一度 10 連続しても、同じ称号は付かない
    const s2 = await start(db, a, 'streak');
    for (let i = 0; i < 10; i++) await answerRight(db, a, s2.run_id);
    const r2 = await answerWrong(db, a, s2.run_id);
    assert.deepEqual(r2.result.new_titles, []);

    // 後半ほど木の実の素点が高い: STAGE 2 以降の正解は +3 ずつ
    const score = (await db.query('select nut_score from public.runs where id=$1', [s2.run_id])).rows[0].nut_score;
    assert.equal(score, 10 * 10 + 3 * 5); // 問 6〜10 が STAGE 2

    // 装備はできる（active）が、ガチャの抽選対象（source='gacha'）には入らない
    const titles = (await db.query("select id from public.items where source='achievement' and active")).rows;
    assert.equal(titles.length, 6);
    await asUser(db, a, () => db.query("select public.equip_item('title', 'title_streak10')"));
    assert.equal((await db.query('select title from public.player_looks where player_id=$1', [a])).rows[0].title, 'title_streak10');
    const owned = (await db.query("select item_id from public.player_items where player_id=$1 order by item_id", [a])).rows.map(x => x.item_id);
    assert.deepEqual(owned, ['title_comeback', 'title_streak10']);
  } finally {
    await db.close();
  }
});

test('同じ単語を出さない: 範囲を使い切っても、ほかの範囲のまだ出ていない単語から出す', async () => {
  const db = await setup(); // 150語。範囲は15語ずつ
  try {
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    for (let i = 0; i < 120; i++) {
      const r = await answerRight(db, a, s.run_id);
      assert.equal(r.state, 'next');
    }
    const used = (await db.query('select used_word_ids from public.runs where id=$1', [s.run_id])).rows[0].used_word_ids;
    assert.equal(used.length, 120);
    assert.equal(new Set(used).size, 120, '120問すべて別の単語');
  } finally {
    await db.close();
  }
});

test('訳が同じ単語（start / begin）: 1回の挑戦で両方は出さない。日本語→英語の選択肢にもう一つの正解を混ぜない', async () => {
  const db = await setup();
  try {
    // 段1の単語のうち 2 語を同じ訳にする
    await db.exec(`update public.words set ja = '始まる、始める' where rank in (1, 2)`);
    const ids = (await db.query('select id, en from public.words where rank in (1, 2) order by rank')).rows;
    for (let t = 0; t < 6; t++) {
      const a = await player(db, `P${t}`);
      const s = await start(db, a, 'knock'); // 段1は30語
      let q = s.question;
      for (let i = 0; i < 30; i++) {
        if (q.dir === 'ja2en' && q.prompt === '始まる、始める') {
          const both = ids.filter(w => q.choices.includes(w.en));
          assert.equal(both.length, 1, '正解の1つだけが並ぶ');
        }
        const r = await answerRight(db, a, s.run_id);
        q = r.question;
      }
      const used = (await db.query('select used_word_ids from public.runs where id=$1', [s.run_id])).rows[0].used_word_ids;
      const hit = ids.filter(w => used.includes(w.id)).length;
      assert.ok(hit <= 1, `訳が同じ2語は1回の挑戦で1つまで（${hit}）`);
    }
  } finally {
    await db.close();
  }
});

test('単語の区分（0015）: STAGE は stage_range の範囲から出る。STAGE 10 から最難関。使わない語（active=false）は出ない', async () => {
  const db = await setup(); // 150語
  try {
    // 15語ずつ 1..10 の範囲を割り当て、範囲10を「最難関」にする。範囲1の最初の5語は使わない語にする
    await db.exec(`
      update public.words set stage_range = ((rank - 1) / 15) + 1, sort_key = rank, level = 'B1';
      update public.words set level = 'AC' where stage_range = 10;
      update public.words set active = false where rank <= 5;
    `);
    const inactive = (await db.query('select id from public.words where not active')).rows.map(r => r.id);
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    let q = s.question;
    const seen = [];
    for (let i = 0; i < 47; i++) {
      seen.push(q);
      q = (await answerRight(db, a, s.run_id)).question;
    }
    // 47問正解 → STAGE 10。段差直後の2問（平地）を越えたので範囲10
    assert.equal(q.stage, 10);
    assert.equal(q.range, 10);
    const sr = (await db.query('select stage_range, level from public.words where id=$1', [q.word_id])).rows[0];
    assert.deepEqual(sr, { stage_range: 10, level: 'AC' });
    // 最初の5問は範囲1から（使わない語を除く）
    for (const x of seen.slice(0, 5)) {
      const w = (await db.query('select stage_range from public.words where id=$1', [x.word_id])).rows[0];
      assert.equal(w.stage_range, 1);
      assert.ok(!inactive.includes(x.word_id));
    }
  } finally {
    await db.close();
  }
});

test('100本ノックはレベルを選んで始める。自己ベストはレベルごと', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const s4 = await call(db, a, 'select public.start_run($1, $2) as r', ['knock', 4]);
    assert.equal(s4.band, 4);
    const w = (await db.query('select band from public.words where id=$1', [s4.question.word_id])).rows[0];
    assert.equal(w.band, 4);
    for (let i = 0; i < 100; i++) await answerRight(db, a, s4.run_id);
    // 別のレベルで始めると、その自己ベストはまだ無い
    const s1 = await call(db, a, 'select public.start_run($1, $2) as r', ['knock', 1]);
    assert.equal(s1.band, 1);
    assert.equal(s1.best, null);
    const s4b = await call(db, a, 'select public.start_run($1, $2) as r', ['knock', 4]);
    assert.equal(s4b.best.correct, 100);
    // 範囲外は丸める・省略すると自分の段
    assert.equal((await call(db, a, 'select public.start_run($1, $2) as r', ['knock', 9])).band, 5);
    assert.equal((await call(db, a, 'select public.start_run($1) as r', ['knock'])).band, 1);
  } finally {
    await db.close();
  }
});
