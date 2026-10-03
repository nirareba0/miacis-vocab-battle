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

test('nextStageGuide: 次のステージまで あと何連続か・この回で初めて開いたか', async () => {
  const { nextStageGuide } = await import('../js/logic.js');
  const stages = [{ band: 1, unlocked: true, need: 20 }, { band: 2, unlocked: false, need: 20 }];
  assert.deepEqual(nextStageGuide(stages, 1, 12), { band: 2, need: 20, left: 8, reached: false, firstOpen: false });
  assert.deepEqual(nextStageGuide(stages, 1, 20), { band: 2, need: 20, left: 0, reached: true, firstOpen: true });
  const opened = [{ band: 1, unlocked: true, need: 20 }, { band: 2, unlocked: true, need: 20 }];
  assert.equal(nextStageGuide(opened, 1, 25).firstOpen, false);
  assert.equal(nextStageGuide(opened, 2, 25), null, '最後のステージの次は無い');
  assert.equal(nextStageGuide(null, 1, 5), null);
});
