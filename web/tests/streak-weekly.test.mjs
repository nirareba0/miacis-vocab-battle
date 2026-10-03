// 🔥 を週単位に・休館日は数えない（0024）の画面ロジック
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekVisits, restLine, loginStreak, calDayLabel, parseWeekdays } from '../js/logic.js';

const S = {
  days: 12, weeks: 5, week_days: 2, week_open: 5, rested_last_week: false, today_closed: false,
  week: [
    { day: '2026-10-19', dow: 1, closed: true, played: false, today: false, future: false },
    { day: '2026-10-20', dow: 2, closed: true, played: true, today: false, future: false },
    { day: '2026-10-21', dow: 3, closed: false, played: false, today: false, future: false },
    { day: '2026-10-22', dow: 4, closed: false, played: true, today: true, future: false },
    { day: '2026-10-23', dow: 5, closed: false, played: false, today: false, future: true },
    { day: '2026-10-24', dow: 6, closed: false, played: false, today: false, future: true },
    { day: '2026-10-25', dow: 7, closed: false, played: false, today: false, future: true }
  ]
};

test('weekVisits: 来た日が休館日でも「来た」。休館・まだ・これからを分ける', () => {
  const v = weekVisits(S);
  assert.equal(v.days, 12);
  assert.equal(v.weekDays, 2);
  assert.equal(v.weekOpen, 5);
  assert.deepEqual(v.chips.map(c => c.label), ['月', '火', '水', '木', '金', '土', '日']);
  assert.deepEqual(v.chips.map(c => c.state), ['closed', 'played', 'open', 'played', 'future', 'future', 'future']);
  assert.equal(v.chips[3].today, true);
  assert.equal(weekVisits(null), null);
  assert.equal(weekVisits({ days: 3 }), null);
});

test('restLine: 先週休んでつながっているときだけ。切れたとは言わない', () => {
  assert.equal(restLine(weekVisits(S)), '');
  assert.equal(restLine(weekVisits({ ...S, rested_last_week: true })), '先週は休み。🔥 は つながってる');
  assert.equal(restLine(null), '');
});

test('loginStreak: 上乗せ・次まで。古い返り値（next なし）は 3日の決まりで', () => {
  assert.deepEqual(loginStreak({ streak_days: 9, streak_bonus: 3, streak_bonus_next: 0 }), { days: 9, bonus: 3, next: 0 });
  assert.deepEqual(loginStreak({ streak_days: 4, streak_bonus: 1, streak_bonus_next: 3 }), { days: 4, bonus: 1, next: 3 });
  assert.deepEqual(loginStreak({ streak_days: 1, streak_bonus: 0 }), { days: 1, bonus: 0, next: 2 });
  assert.deepEqual(loginStreak({ streak_days: 5, streak_bonus: 1 }), { days: 5, bonus: 1, next: 0 });
  assert.deepEqual(loginStreak(null), { days: 0, bonus: 0, next: 0 });
});

test('calDayLabel / parseWeekdays', () => {
  assert.equal(calDayLabel('2026-12-28'), '12/28(月)');
  assert.equal(calDayLabel('2027-01-03'), '1/3(日)');
  assert.equal(calDayLabel('x'), '');
  assert.deepEqual(parseWeekdays(' 2,1,2,9 '), [1, 2]);
  assert.deepEqual(parseWeekdays(''), []);
});
