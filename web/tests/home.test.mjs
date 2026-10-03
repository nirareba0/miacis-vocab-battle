import test from 'node:test';
import assert from 'node:assert/strict';
import { jstToday, commitTodayLine, COMMIT_DAILY_CAP } from '../js/logic.js';

test('jstToday: 日本時間の日付（UTC の 15:00 で日付が変わる）', () => {
  assert.equal(jstToday(new Date('2026-10-03T14:59:59Z')), '2026-10-03');
  assert.equal(jstToday(new Date('2026-10-03T15:00:00Z')), '2026-10-04');
  assert.equal(jstToday(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
});

test('commitTodayLine: 今日の数と上限。上限で止める', () => {
  assert.equal(COMMIT_DAILY_CAP, 10);
  assert.equal(commitTodayLine(0), '今日 0 / 10');
  assert.equal(commitTodayLine(7), '今日 7 / 10');
  assert.equal(commitTodayLine(10), '今日 10 / 10 上限');
  assert.equal(commitTodayLine(12), '今日 10 / 10 上限');
  assert.equal(commitTodayLine(null), '今日 0 / 10');
});

test('shareInfo: 送る URL は入口だけ（ハッシュや ?debug を落とす）', async () => {
  const { shareInfo } = await import('../js/logic.js');
  const s = shareInfo('https://nirareba0.github.io/miacis-vocab-battle/?debug=1#/home');
  assert.equal(s.url, 'https://nirareba0.github.io/miacis-vocab-battle/');
  assert.match(s.text, /ミアキス英単語サバイバル/);
});
