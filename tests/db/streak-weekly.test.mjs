// 0024: 🔥 を週単位に・休館日は数えない（2026-10-03 本人「いいよ」）
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb, createUser, asUser, asAnon, setTestTime } from './helper.mjs';

async function player(db, name, staff = false) {
  const id = randomUUID();
  await createUser(db, id);
  await asUser(db, id, () => db.query('select public.register_player($1,1,null)', [name]));
  // 登録した日の open は数えないように消す（来た日は各テストで入れる）
  await db.query('delete from public.points where player_id=$1', [id]);
  if (staff) await db.query('insert into public.staff(user_id) values($1)', [id]);
  return id;
}

const call = (db, id, sql, params = []) => asUser(db, id, async () => (await db.query(sql, params)).rows[0].r);
const visit = (db, id, days) => Promise.all(days.map(d => db.query(
  `insert into public.points (player_id, kind, reason, amount, week_start, day, created_at)
   values ($1, 'commit', 'open', 1, $2::date - (extract(isodow from $2::date)::int - 1), $2::date, ($2 || ' 16:00:00+09')::timestamptz)`, [id, d])));
const streak = (db, id) => call(db, id, 'select public.my_streak() as r');
const setSetting = (db, key, value) => db.query('insert into public.app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value', [key, value]);
// 0004 の数え方（今日か昨日まで1日も空けずに開いた日数）。切り替えで減らないかの比べ用
async function oldStreak(db, id) {
  await db.exec(`set "request.jwt.claim.sub" = '${id}'`);
  try {
    return (await db.query('select (public.my_progress_core()->>\'streak_days\')::int as n')).rows[0].n;
  } finally {
    await db.exec('reset "request.jwt.claim.sub"');
  }
}

test('休館日: 毎週火曜・毎月第3月曜（館の公式）・年末年始【仮】。日付の登録が曜日の決まりより優先', async () => {
  const db = await createTestDb();
  try {
    const closed = async d => (await db.query('select public.is_closed_day($1::date) as c', [d])).rows[0].c;
    assert.equal(await closed('2026-10-06'), true, '火曜');
    assert.equal(await closed('2026-10-19'), true, '第3月曜');
    assert.equal(await closed('2026-10-12'), false, '第2月曜（祝日）は開館');
    assert.equal(await closed('2026-10-10'), false, '土曜');
    assert.equal(await closed('2026-12-30'), true, '年末年始【仮】');
    assert.equal(await closed('2027-01-04'), false);
    await db.query(`insert into public.calendar_days(day, closed, note) values ('2026-10-13', false, '臨時開館')`);
    assert.equal(await closed('2026-10-13'), false, '臨時開館は火曜でも開館');
    await setSetting(db, 'closed_weekdays', '');
    await setSetting(db, 'closed_nth_week', '0');
    assert.equal(await closed('2026-10-20'), false, '曜日の決まりを消せば開館');
  } finally {
    await db.close();
  }
});

test('🔥 週単位: 週1回でもつながる。1週休んでも切れない（先週の休みは保険）。2週続けて休むと新しく始まる', async () => {
  const db = await createTestDb();
  try {
    await setTestTime(db, '2026-10-24T16:00:00+09:00'); // 土曜
    const weekly = await player(db, '毎週');
    const rested = await player(db, '1週休み');
    const gone = await player(db, '2週休み');
    await visit(db, weekly, ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24']);
    await visit(db, rested, ['2026-10-03', '2026-10-10', '2026-10-24']);
    await visit(db, gone, ['2026-10-03', '2026-10-24']);

    const w = await streak(db, weekly);
    assert.equal(w.days, 4);
    assert.equal(w.weeks, 4);
    assert.equal(w.rested_last_week, false);
    assert.equal(w.week_days, 1);
    assert.equal(w.week_open, 5, '今週は第3月曜と火曜が休館');
    assert.equal(w.week.length, 7);
    assert.deepEqual(w.week.map(d => d.closed), [true, true, false, false, false, false, false]);
    assert.deepEqual(w.week[5], { day: '2026-10-24', dow: 6, closed: false, played: true, today: true, future: false });
    assert.equal(w.week[6].future, true);
    assert.equal(await oldStreak(db, weekly), 1, '前の数え方では今日だけ');

    const r = await streak(db, rested);
    assert.equal(r.days, 3);
    assert.equal(r.rested_last_week, true);
    const g = await streak(db, gone);
    assert.equal(g.days, 1);
    assert.equal(g.rested_last_week, false);

    // 保険を 0 にすると、1週休んだだけで新しく始まる
    await setSetting(db, 'streak_grace_weeks', '0');
    assert.equal((await streak(db, rested)).days, 1);
    await setSetting(db, 'streak_grace_weeks', '1');

    // 開館日が3日未満の週（ここでは 10/12〜18 を全部休館に登録）は数えない → 2週休みでもつながる
    await db.query(`insert into public.calendar_days(day, closed) select d::date, true from generate_series('2026-10-12'::date, '2026-10-18'::date, interval '1 day') d`);
    assert.equal((await streak(db, gone)).days, 2);

    // 週が変わって月曜。今週はまだ来ていなくても切れない（今週は途中）
    await setTestTime(db, '2026-10-26T10:00:00+09:00');
    const w2 = await streak(db, weekly);
    assert.equal(w2.days, 4);
    assert.equal(w2.week_days, 0);
    // my_progress の streak_days も同じ数え方
    assert.equal((await call(db, weekly, 'select public.my_progress() as r')).streak_days, 4);
  } finally {
    await db.close();
  }
});

test('切り替えで 🔥 が減らない: いろいろな来方で、新しい数 ≧ 前の数え方（0004）', async () => {
  const db = await createTestDb();
  try {
    await setTestTime(db, '2026-10-24T18:00:00+09:00');
    let seed = 20261003;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const today = new Date('2026-10-24T00:00:00Z');
    const iso = n => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
    let checked = 0;
    let longer = 0;
    let maxBefore = 0;
    for (let p = 0; p < 24; p++) {
      const id = await player(db, `p${p}`);
      const rate = [0.95, 0.7, 0.4, 0.15][p % 4];
      const tail = p % 3 === 0 ? 0 : p % 3 === 1 ? 1 : 2; // 今日から何日前で止めるか（今日／昨日まで／一昨日まで）
      const days = [];
      for (let n = tail; n < 70; n++) if (n < tail + 3 + (p % 5) || rand() < rate) days.push(iso(n));
      await visit(db, id, days);
      const before = await oldStreak(db, id);
      const after = (await streak(db, id)).days;
      assert.ok(after >= before, `p${p}: 前 ${before} → 後 ${after}`);
      checked++;
      maxBefore = Math.max(maxBefore, before);
      if (after > before) longer++;
    }
    assert.equal(checked, 24);
    assert.ok(maxBefore >= 3, '前の数え方で続いている人も含む');
    assert.ok(longer > 0, '週単位にすると長くなる人がいる');
  } finally {
    await db.close();
  }
});

test('ログインボーナス: 🔥 3日で +1・7日で +3（数字は設定）。週1で来る人にも届く。次まであと何日も返す', async () => {
  const db = await createTestDb();
  try {
    const a = await player(db, '土曜の人');
    const seen = [];
    for (const day of ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17']) {
      await setTestTime(db, `${day}T16:00:00+09:00`);
      await asUser(db, a, () => db.query('select public.touch_today()'));
      const d = await call(db, a, 'select public.claim_daily_nuts() as r');
      seen.push([d.streak_days, d.streak_bonus, d.earned, d.streak_bonus_next]);
    }
    assert.deepEqual(seen, [
      [1, 0, 2, 2], [2, 0, 2, 1], [3, 1, 3, 4], [4, 1, 3, 3], [5, 1, 3, 2], [6, 1, 3, 1], [7, 3, 5, 0]
    ]);
    // 同じ日の2回目はもらえない
    const again = await call(db, a, 'select public.claim_daily_nuts() as r');
    assert.equal(again.already_claimed, true);
    assert.equal(again.earned, 0);
    // 数字は app_settings
    await setSetting(db, 'streak_bonus_big', '5');
    await setTestTime(db, '2026-10-24T16:00:00+09:00');
    await asUser(db, a, () => db.query('select public.touch_today()'));
    assert.equal((await call(db, a, 'select public.claim_daily_nuts() as r')).earned, 7);
  } finally {
    await db.close();
  }
});

test('スタッフ画面: 休館の曜日・第◯週・日付の登録。生徒は呼べない・表を直接読めない', async () => {
  const db = await createTestDb();
  try {
    await setTestTime(db, '2026-10-24T16:00:00+09:00');
    const staff = await player(db, 'スタッフ', true);
    const kid = await player(db, '生徒');

    const s = await call(db, staff, 'select public.staff_settings() as r');
    assert.equal(s.closed_weekdays.value, '2');
    assert.equal(s.closed_weekdays.kind, 'weekdays');
    assert.equal(s.closed_nth_week.value, '3');
    assert.equal(s.streak_grace_weeks.value, '1');

    const saved = await call(db, staff, `select public.staff_set_setting('closed_weekdays', ' 2,1,2 ') as r`);
    assert.equal(saved.closed_weekdays.value, '1,2', '並べ直して重複を消す');
    assert.equal((await call(db, staff, `select public.staff_set_setting('closed_weekdays', '') as r`)).closed_weekdays.value, '');
    await assert.rejects(call(db, staff, `select public.staff_set_setting('closed_weekdays', '8') as r`), /invalid_setting_value/);
    await assert.rejects(call(db, staff, `select public.staff_set_setting('closed_nth_week', '6') as r`), /setting_out_of_range/);

    const cal = await call(db, staff, `select public.staff_set_calendar_day('2026-11-03', true, '文化の日 休館') as r`);
    assert.deepEqual(cal.days.find(d => d.day === '2026-11-03'), { day: '2026-11-03', closed: true, note: '文化の日 休館' });
    assert.equal(cal.upcoming.length, 14);
    assert.equal(cal.upcoming[0].day, '2026-10-24');
    const after = await call(db, staff, `select public.staff_set_calendar_day('2026-11-03', null) as r`);
    assert.equal(after.days.some(d => d.day === '2026-11-03'), false, 'null で消える');
    assert.ok(after.days.some(d => d.note === '年末年始【仮】'));

    await assert.rejects(call(db, kid, 'select public.staff_calendar() as r'), /not_a_staff/);
    await assert.rejects(call(db, kid, `select public.staff_set_calendar_day('2026-11-03', true) as r`), /not_a_staff/);
    await assert.rejects(asUser(db, kid, () => db.query('select * from public.calendar_days')), /permission denied/);
    await assert.rejects(asUser(db, kid, () => db.query(`select public.streak_state('${kid}')`)), /permission denied/);
    await assert.rejects(asUser(db, kid, () => db.query('select public.my_progress_core()')), /permission denied/);
    await assert.rejects(asAnon(db, () => db.query('select public.my_streak()')), /permission denied/);
    assert.equal((await streak(db, kid)).days, 0);
  } finally {
    await db.close();
  }
});
