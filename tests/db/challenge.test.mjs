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
// カードの候補が出たら、ほかの判定に影響しにくいものを選んで先へ進む（カード自体のテストは別にある）
const CARD_PREF = ['fifty', 'skip', 'double', 'time', 'shield'];
async function pickAndContinue(db, id, runId, r) {
  if (r.state !== 'card_offer') return r;
  const card = CARD_PREF.find(c => r.offer.includes(c));
  const p = await call(db, id, 'select public.pick_card($1,$2) as r', [runId, card]);
  return { ...r, state: 'next', question: p.question, picked: card };
}
const answer = async (db, id, runId, choice, ms = 1000) =>
  pickAndContinue(db, id, runId, await call(db, id, 'select public.answer_run($1,$2,$3) as r', [runId, choice, ms]));

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
    assert.equal(r.result.nuts, 2); // 素点 6×10=60 → 6 個（素点10で1個・0023）× 1/3 → 2
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
    assert.equal(last.result.nuts, 33); // 素点 90×10=900 → 90 個（素点10で1個・0023）、完走 +5、90問以上 +3 → 98 × 1/3 → 33
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
    assert.equal(score, 10 * 10); // 10問目まではペース1（ペースは10問正解ごと）

    // 装備はできる（active）が、ガチャの抽選対象（source='gacha'）には入らない
    const titles = (await db.query("select id from public.items where source='achievement' and active")).rows;
    assert.equal(titles.length, 6 + 5 + 11); // 0022: 図鑑のすがた 5・週間1位の称号 11
    await asUser(db, a, () => db.query("select public.equip_item('title', 'title_streak10')"));
    assert.equal((await db.query('select title from public.player_looks where player_id=$1', [a])).rows[0].title, 'title_streak10');
    const owned = (await db.query("select item_id from public.player_items where player_id=$1 order by item_id", [a])).rows.map(x => x.item_id);
    assert.deepEqual(owned, ['title_comeback', 'title_streak10']);
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



test('ステージのコース（0018）: 正解は端末に来ない。出るのはそのステージの単語だけ。10問正解ごとに 0.5秒ずつ短くなる', async () => {
  const db = await setup(); // 段ごとに30語
  try {
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    assert.equal(s.band, 1);
    assert.equal(s.question.answer_index, undefined);
    assert.equal(s.question.issued_at, undefined);
    assert.equal(s.question.limit_ms, 7000);
    let q = s.question;
    for (let i = 0; i < 10; i++) {
      const w = (await db.query('select band from public.words where id=$1', [q.word_id])).rows[0];
      assert.equal(w.band, 1);
      const r = await answerRight(db, a, s.run_id);
      assert.equal(r.state, 'next', 'カードは出ない');
      q = r.question;
    }
    assert.equal(q.limit_ms, 6500);
    for (let i = 0; i < 10; i++) q = (await answerRight(db, a, s.run_id)).question;
    assert.equal(q.limit_ms, 6000);
    await asAnon(db, async () => {
      await assert.rejects(db.exec('select * from public.runs'), /permission denied/);
    });
  } finally {
    await db.close();
  }
});

test('ステージのコース（0018）: そのステージの単語を出し切ったらコンプリート。同じ単語は出ない。ステージ制覇の称号', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    let r;
    for (let i = 0; i < 40; i++) {
      r = await answerRight(db, a, s.run_id);
      if (r.state === 'finished') break;
    }
    assert.equal(r.state, 'finished');
    assert.equal(r.result.end_reason, 'complete');
    assert.equal(r.result.correct, 30);
    const used = (await db.query('select used_word_ids from public.runs where id=$1', [s.run_id])).rows[0].used_word_ids;
    assert.equal(new Set(used).size, 30);
    assert.ok(r.result.new_titles.some(t => t.id === 'title_stage5'));
  } finally {
    await db.close();
  }
});

test('ステージのコース（0018・0025）: 入口は前のステージで20連続で開く。ランキングと自己ベストはステージごと。スタッフは全部開いている', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const staff = await player(db, 'Staff', true);
    await asUser(db, a, async () => {
      await assert.rejects(db.query("select public.start_run('streak', 2)"), /stage_locked/);
    });
    let st = await call(db, a, 'select public.my_stages() as r');
    assert.deepEqual(st.map(x => x.unlocked), [true, false, false, false, false]);
    assert.equal(st[0].words, 30);

    // 19連続では A2 は開かない（0025: 30 → 20）
    const s0 = await start(db, a, 'streak');
    for (let i = 0; i < 19; i++) await answerRight(db, a, s0.run_id);
    await answerWrong(db, a, s0.run_id);
    st = await call(db, a, 'select public.my_stages() as r');
    assert.equal(st[1].unlocked, false);
    assert.equal(st[1].need, 20);

    // A1 を出し切る（30連続）→ A2 が開く
    const s1 = await start(db, a, 'streak');
    for (let i = 0; i < 30; i++) await answerRight(db, a, s1.run_id);
    st = await call(db, a, 'select public.my_stages() as r');
    assert.deepEqual(st.map(x => x.unlocked), [true, true, false, false, false]);
    assert.equal(st[0].completed, true);
    assert.equal(st[0].best.correct, 30);

    const s2 = await call(db, a, "select public.start_run('streak', 2) as r");
    assert.equal(s2.band, 2);
    assert.equal(s2.best, null, 'A2 の自己ベストはまだ無い');
    for (let i = 0; i < 3; i++) await answerRight(db, a, s2.run_id);
    await answerWrong(db, a, s2.run_id);

    const rows = (await db.query("select band, nickname, best_streak, rank from public.ranking_streak_week where nickname='A' order by band")).rows;
    assert.deepEqual(rows, [{ band: 1, nickname: 'A', best_streak: 30, rank: 1 }, { band: 2, nickname: 'A', best_streak: 3, rank: 1 }]);

    const ss = await call(db, staff, 'select public.my_stages() as r');
    assert.ok(ss.every(x => x.unlocked));
    const s5 = await call(db, staff, "select public.start_run('streak', 5) as r");
    assert.equal(s5.band, 5);
  } finally {
    await db.close();
  }
});

test('選択肢が細かくなる（0019）: 31問目からは、似た単語か 1文字違いのつづりの罠が並ぶ', async () => {
  const db = await setup();
  try {
    // 段1の単語に「似た単語」と「つづりの罠」を持たせる（似た単語は段2の語）
    await db.exec(`
      update public.words w set
        lookalikes = array[(select en from public.words where band = 2 and rank = w.rank + 30)],
        misspellings = array[w.en || 'xa', w.en || 'xe', w.en || 'xi']
      where band = 1;
    `);
    // 追加の語にも罠を持たせる（持たない語が混ざると、罠が1回も出ない回が数%の確率で起きる）
    await db.exec(`insert into public.words (rank, en, ja, pos, band, misspellings) select 1000 + g, 'extra_' || g, '追加_' || g, 'noun', 1, array['extra_' || g || 'xa', 'extra_' || g || 'xe', 'extra_' || g || 'xi'] from generate_series(1, 30) g`);
    const a = await player(db, 'A');
    const s = await start(db, a, 'streak');
    let q = s.question;
    for (let i = 0; i < 30; i++) {
      if (i < 10) assert.equal(q.tier, 0);
      q = (await answerRight(db, a, s.run_id)).question;
    }
    let traps = 0;
    for (let i = 0; i < 30 && q; i++) {
      assert.ok(q.tier >= 2, `31問目以降は tier 2 以上（${q.tier}）`);
      if (q.tier === 3) {
        traps++;
        assert.equal(q.dir, 'ja2en');
        const w = (await db.query('select en from public.words where id=$1', [q.word_id])).rows[0];
        const wrong = q.choices.filter(c => c !== w.en);
        assert.equal(wrong.length, 3);
        assert.ok(wrong.every(c => c.startsWith(w.en) && c.length === w.en.length + 2), 'つづりの罠だけが並ぶ');
      }
      const r = await answerRight(db, a, s.run_id);
      q = r.question;
    }
    assert.ok(traps > 0, 'つづりの罠が出た');
  } finally {
    await db.close();
  }
});

test('ガチャ（0019）: 子孫の動物8種はガチャから外れ、SECRET はネコ・イヌ＋スタッフモチーフ7種', async () => {
  const db = await setup();
  try {
    const secret = (await db.query("select id from public.items where active and rarity = 5 order by id")).rows.map(r => r.id);
    assert.deepEqual(secret, ['form_cat', 'form_dog', 'staff_aussie', 'staff_backpacker', 'staff_designer', 'staff_engineer', 'staff_family', 'staff_shisa', 'staff_stylist']);
    const off = (await db.query("select count(*)::int n from public.items where id like 'form_%' and active")).rows[0].n;
    assert.equal(off, 2);
  } finally {
    await db.close();
  }
});
