import test from 'node:test';
import assert from 'node:assert/strict';
import { streakStage, streakPressureLabel, formatSeconds, knockGrade, translateError } from '../js/logic.js';

test('streakStage: 5問ごとにステージが上がる', () => {
  assert.deepEqual(streakStage(0), { stage: 1, inStage: 0, toNext: 5 });
  assert.deepEqual(streakStage(4), { stage: 1, inStage: 4, toNext: 1 });
  assert.deepEqual(streakStage(5), { stage: 2, inStage: 0, toNext: 5 });
  assert.deepEqual(streakStage(-3), { stage: 1, inStage: 0, toNext: 5 });
});

test('streakPressureLabel: 自己ベストが近いときだけ言う', () => {
  assert.equal(streakPressureLabel(3, null), '');
  assert.equal(streakPressureLabel(3, 10), '');
  assert.equal(streakPressureLabel(8, 10), '自己ベストまで あと3問');
  assert.equal(streakPressureLabel(10, 10), 'あと1問で 自己ベスト');
  assert.equal(streakPressureLabel(11, 10), '自己ベスト更新中！');
});

test('formatSeconds / knockGrade', () => {
  assert.equal(formatSeconds(12345), '12.3秒');
  assert.equal(knockGrade(100).mark, 'PERFECT');
  assert.equal(knockGrade(90).mark, 'S');
  assert.equal(knockGrade(74).mark, 'B');
  assert.equal(knockGrade(10).mark, 'C');
});

test('translateError: チャレンジのエラー', () => {
  assert.equal(translateError('revive_not_available'), '復活はもう使えません');
  assert.equal(translateError('run_not_active'), 'このチャレンジはもう終わっています');
});

test('liveRank / passedPlayers: いまの順位と、抜いた人', async () => {
  const { liveRank, passedPlayers } = await import('../js/logic.js');
  const others = [{ nickname: 'そうた', score: 23 }, { nickname: 'みく', score: 12 }, { nickname: 'れん', score: 9 }];
  assert.deepEqual(liveRank(0, others), { rank: 4, next: { nickname: 'れん', score: 9, gap: 10 }, above: 3 });
  assert.deepEqual(liveRank(9, others).next, { nickname: 'れん', score: 9, gap: 1 }); // 同点は相手が上
  assert.equal(liveRank(10, others).rank, 3);
  assert.equal(liveRank(24, others).rank, 1);
  assert.equal(liveRank(24, others).next, null);
  assert.deepEqual(passedPlayers(9, 10, others), ['れん']);
  assert.deepEqual(passedPlayers(10, 11, others), []);
  assert.deepEqual(passedPlayers(0, 13, others), ['みく', 'れん']);
  assert.deepEqual(liveRank(3, []), { rank: 1, next: null, above: 0 });
});
