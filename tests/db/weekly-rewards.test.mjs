import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb, createUser, asUser, asAnon, setTestTime } from './helper.mjs';

// 2026-10-02 から、実物景品はガチャで直接当たらない。ガチャで「抽選券」が出て、月初に前月分を抽選する
async function setup() {
  const db = await createTestDb();
  await setTestTime(db, '2026-09-26T12:00:00+09:00');
  await db.exec(`
    update public.prizes set active=true, effective_week='2026-09-21' where weekly_refill;
    update public.app_settings set value='1' where key='raffle_rate';
    insert into public.prizes (id, name, description, stock, active, reward_channel)
      values ('77777777-0000-4000-8000-000000000003', '月末抽選 ステッカー', '館でもらえる', 1, true, 'raffle');
  `);
  return db;
}
async function player(db, name, staff = false) {
  const id = randomUUID();
  await createUser(db, id);
  await asUser(db, id, () => db.query('select public.register_player($1,1,null)', [name]));
  if (staff) await db.query('insert into public.staff(user_id) values($1)', [id]);
  await db.query("insert into public.nut_ledger(player_id,amount,reason,ref,day) values($1,2000,'test','setup',public.jst_today())", [id]);
  return id;
}
const pull = (db, id, count = 1) => asUser(db, id, async () => (await db.query('select public.pull_gacha($1) as result', [count])).rows[0].result);
const call = (db, id, sql, params = []) => asUser(db, id, async () => (await db.query(sql, params)).rows[0].r);

test('抽選券: ガチャで出る・11連の最後は確定・月が閉じるまで抽選できない・券が多いほど当たりやすい・やり直しても二重に当てない', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const b = await player(db, 'B');

    // raffle_rate=1 でも 11 連の最後は SR 以上確定の枠なので、券は 10 枚
    const ra = await pull(db, a, 10);
    assert.equal(ra.results.filter(i => i.kind === 'raffle').length, 10);
    assert.equal(ra.results[10].kind, 'item');
    assert.equal(ra.raffle_entries_month, 10);
    assert.equal(ra.results.length, 11);

    // rate をほぼ 0 にしても、11連の最後は未入手なら確定で 1 枚
    await db.exec("update public.app_settings set value='0.0000001' where key='raffle_rate'");
    const rb = await pull(db, b, 10);
    assert.equal(rb.results.filter(i => i.kind === 'raffle').length, 1);
    assert.equal(rb.results.length, 11);
    assert.equal(rb.results[9].kind, 'raffle', '10回目で確定');
    assert.equal(rb.results[10].kind, 'item', '最後の1回は SR 以上確定のために空けてある');
    assert.equal(rb.results.filter(i => i.kind === 'item').some(i => i.rarity >= 3), true, 'SR以上確定は抽選券とは別に守る');

    const mine = await call(db, a, 'select public.my_raffle() as r');
    assert.equal(mine.month, '2026-09');
    assert.equal(mine.my_entries, 10);
    assert.equal(mine.total_entries, 11);
    assert.equal(mine.holders, 2);
    assert.equal(mine.prizes.length, 1);

    // 今月はまだ抽選できない
    const staff = await player(db, 'Staff', true);
    await asUser(db, staff, async () => {
      await assert.rejects(db.query("select public.staff_draw_raffle('2026-09-01')"), /month_not_closed/);
      await assert.rejects(db.query("select public.staff_draw_raffle('2026-09-15')"), /invalid_month/);
    });
    await asUser(db, a, async () => {
      await assert.rejects(db.query("select public.staff_draw_raffle('2026-08-01')"), /not_a_staff/);
      await assert.rejects(db.query("select public.draw_monthly_raffle('2026-08-01')"), /permission denied/);
    });

    // 月が替わると前月分を抽選できる。どちらが勝っても 1 人・引換券1枚・在庫1減
    await setTestTime(db, '2026-10-01T00:05:00+09:00');
    const drawn = (await db.query('select public.draw_monthly_raffle_if_due() as r')).rows[0].r;
    assert.equal(drawn.length, 1);
    assert.ok([a, b].includes(drawn[0].player_id));
    assert.equal(drawn[0].total_entries, 11);
    assert.equal(drawn[0].winner_entries, drawn[0].player_id === a ? 10 : 1);
    assert.equal((await db.query("select stock from public.prizes where reward_channel='raffle'")).rows[0].stock, 0);
    assert.equal((await db.query('select count(*)::int n from public.prize_tickets')).rows[0].n, 1);

    // もう一度回しても二重に当てない
    assert.equal((await call(db, staff, "select public.staff_draw_raffle('2026-09-01') as r")).length, 0);
    assert.equal((await db.query('select count(*)::int n from public.prize_tickets')).rows[0].n, 1);

    // 勝者には is_me が立つ
    const winner = drawn[0].player_id;
    const res = await call(db, winner, 'select public.my_raffle() as r');
    assert.equal(res.last_results.length, 1);
    assert.equal(res.last_results[0].is_me, true);
    assert.equal(res.last_results[0].month, '2026-09');
    assert.equal(res.my_entries, 0); // 10 月の券はまだ 0

    // 1 日以外は何もしない
    await setTestTime(db, '2026-10-02T00:05:00+09:00');
    assert.equal((await db.query('select public.draw_monthly_raffle_if_due() as r')).rows[0].r.length, 0);
  } finally {
    await db.close();
  }
});

test('スタッフは学年なし・ランキングと抽選券から除外。木の実残高と着せ替えは利用可能', async () => {
  const db = await setup();
  try {
    const staff = await player(db, 'Staff', true);
    const student = await player(db, 'Student');
    const p = (await db.query('select grade,account_type from public.players where id=$1', [staff])).rows[0];
    assert.deepEqual(p, { grade: null, account_type: 'staff' });
    const result = await pull(db, staff, 10);
    assert.equal(result.results.filter(i => i.kind === 'raffle').length, 0);
    assert.equal(result.balance, 1950);
    assert.equal((await pull(db, student)).results[0].kind, 'raffle');
    // ランキングの表示には「スタッフ」の印つきで出る（景品・抽選・週間1位の券は生徒だけ）
    for (const view of ['ranking_learn_week', 'ranking_commit_week']) {
      assert.equal((await db.query(`select is_staff from public.${view} where nickname='Staff'`)).rows[0].is_staff, true);
    }
    const rate = await call(db, staff, 'select public.gacha_rates() as r');
    assert.equal(rate.staff_mode, true);
    assert.equal(rate.raffle_rate, 0);
    await db.exec('select public.advance_grades()');
    assert.equal((await db.query('select grade from public.players where id=$1', [staff])).rows[0].grade, null);
  } finally {
    await db.close();
  }
});

test('週間コミット1位: スタッフ除外・同点順・締め直しで重複なし。ガチャの週1枚は廃止', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    const b = await player(db, 'B');
    const staff = await player(db, 'Staff', true);
    for (const [id, amount] of [[a, 10], [b, 10], [staff, 100]]) {
      await db.query("insert into public.points(player_id,kind,reason,amount,week_start,day) values($1,'commit','test',$2,'2026-09-21','2026-09-26')", [id, amount]);
    }
    await pull(db, b);
    await setTestTime(db, '2026-09-28T00:05:00+09:00');
    await db.exec("select public.close_week('2026-09-21');select public.close_week('2026-09-21');");
    const awards = (await db.query("select channel,player_id from public.weekly_prize_awards where week_start='2026-09-21' order by channel")).rows;
    assert.deepEqual(awards, [{ channel: 'ranking', player_id: a }]);
    assert.equal((await db.query('select count(*)::int n from public.weekly_results where player_id=$1', [staff])).rows[0].n, 0);
    await assert.rejects(db.exec("select public.close_week('2026-09-28')"), /invalid_reward_week/);
  } finally {
    await db.close();
  }
});

test('0ポイント・停止中の券・開始前の週はランキング券を発行しない。raffle_rate=0 なら抽選券は出ない', async () => {
  const db = await setup();
  try {
    await player(db, 'A');
    await setTestTime(db, '2026-09-28T00:05:00+09:00');
    await db.exec("select public.close_week('2026-09-21')");
    assert.equal((await db.query('select count(*)::int n from public.weekly_prize_awards')).rows[0].n, 0);
    await db.exec("update public.app_settings set value='0' where key='raffle_rate'");
    const a = (await db.query("select id from public.players where nickname='A'")).rows[0].id;
    assert.equal((await pull(db, a)).results[0].kind, 'item');
    assert.equal((await pull(db, a, 10)).results.filter(i => i.kind === 'raffle').length, 0);
  } finally {
    await db.close();
  }
});

test('利用状況はスタッフだけ。生徒・匿名は管理関数と週次台帳にアクセスできない', async () => {
  const db = await setup();
  try {
    const staff = await player(db, 'Staff', true);
    const student = await player(db, 'Student');
    await pull(db, staff, 10);
    await pull(db, student, 10);
    const overview = await call(db, staff, 'select public.staff_reward_overview() as r');
    assert.equal(overview.stats.students, 1);
    assert.equal(overview.stats.staff, 1);
    assert.equal(overview.stats.weekly_pulls, 11);
    assert.equal(overview.stats.gacha_issued, 0);
    assert.equal(overview.stats.raffle_entries, 10);
    assert.equal(overview.stats.raffle_holders, 1);
    await asUser(db, student, async () => {
      await assert.rejects(db.exec('select public.staff_reward_overview()'), /not_a_staff/);
      await assert.rejects(db.exec('select * from public.weekly_prize_awards'), /permission denied/);
      await assert.rejects(db.exec('select * from public.raffle_results'), /permission denied/);
      await assert.rejects(db.exec("select public.award_weekly_ranking('2026-09-21')"), /permission denied/);
      await assert.rejects(db.exec("update public.players set account_type='staff',grade=null"), /permission denied/);
    });
    await asAnon(db, async () => {
      await assert.rejects(db.exec('select public.staff_reward_overview()'), /permission denied/);
      const rules = (await db.query('select public.weekly_reward_rules() as r')).rows[0].r;
      assert.ok(rules.ranking);
    });
  } finally {
    await db.close();
  }
});

test('設定: スタッフだけが決め打ちの鍵を範囲内で変えられる。変えた値が次の回に効く', async () => {
  const db = await setup();
  try {
    const staff = await player(db, 'Staff', true);
    const student = await player(db, 'Student');
    const s = await call(db, staff, 'select public.staff_settings() as r');
    assert.equal(s.pull_cost.value, '5');
    assert.equal(s.rank_mode_enabled.value, 'false');
    assert.equal(s.raffle_rate.label.includes('抽選券'), true);

    const after = await call(db, staff, "select public.staff_set_setting('pull_cost', '7') as r");
    assert.equal(after.pull_cost.value, '7');
    assert.equal((await call(db, student, 'select public.gacha_rates() as r')).pull_cost, 7);

    await asUser(db, staff, async () => {
      await assert.rejects(db.query("select public.staff_set_setting('pull_cost', '0')"), /setting_out_of_range/);
      await assert.rejects(db.query("select public.staff_set_setting('pull_cost', 'abc')"), /invalid_setting_value/);
      await assert.rejects(db.query("select public.staff_set_setting('pull10_count', '10.5')"), /invalid_setting_value/);
      await assert.rejects(db.query("select public.staff_set_setting('invite_code', 'x')"), /setting_not_allowed/);
      await assert.rejects(db.query("select public.staff_set_setting('rank_mode_enabled', 'yes')"), /invalid_setting_value/);
    });
    const flags = await call(db, staff, "select public.staff_set_setting('rank_mode_enabled', 'true') as r");
    assert.equal(flags.rank_mode_enabled.value, 'true');
    assert.equal((await db.query('select public.app_flags() as f')).rows[0].f.rank_mode_enabled, true);

    await asUser(db, student, async () => {
      await assert.rejects(db.query('select public.staff_settings()'), /not_a_staff/);
      await assert.rejects(db.query("select public.staff_set_setting('pull_cost', '1')"), /not_a_staff/);
    });
  } finally {
    await db.close();
  }
});

test('SECRET とすがた（0016）: 超低確率でネコ・イヌのすがた。装備できて公開の見た目にも出る。SECRET と条件達成の称号はかけら交換できない', async () => {
  const db = await setup();
  try {
    const a = await player(db, 'A');
    await db.exec("update public.app_settings set value='0' where key='raffle_rate'; update public.app_settings set value='1' where key='secret_rate';");
    const r = await pull(db, a, 1);
    assert.equal(r.results[0].rarity, 5);
    assert.ok(r.results[0].id.startsWith('form_') || r.results[0].id.startsWith('staff_'), r.results[0].id);
    const rates = await call(db, a, 'select public.gacha_rates() as r');
    assert.equal(rates.item_rates.SECRET, 1);

    await asUser(db, a, () => db.query("select public.equip_item('form', $1)", [r.results[0].id]));
    const look = (await db.query("select looks from public.public_looks where nickname='A'")).rows[0].looks;
    assert.equal(look.form.id, r.results[0].id);
    await asUser(db, a, async () => {
      await assert.rejects(db.query("select public.equip_item('form', 'hat_cap')"), /slot_mismatch/);
    });

    await db.query("insert into public.player_shards (player_id, amount) values ($1, 5000) on conflict (player_id) do update set amount = 5000", [a]);
    await asUser(db, a, async () => {
      await assert.rejects(db.query("select public.exchange_item('form_dog')"), /item_not_found/);
      await assert.rejects(db.query("select public.exchange_item('title_streak10')"), /item_not_found/);
      await assert.rejects(db.query("select public.exchange_item('form_fox')"), /item_not_found/); // ガチャから外れた
      const ok = (await db.query("select public.exchange_item('hat_kabuto') as r")).rows[0].r;
      assert.ok(ok);
    });
    const n = (await db.query("select count(*)::int n from public.items where active and source='gacha'")).rows[0].n;
    assert.equal(n, 105); // 0019: 子孫の動物 8 種を外し、スタッフモチーフ 7 種を足した
  } finally {
    await db.close();
  }
});
