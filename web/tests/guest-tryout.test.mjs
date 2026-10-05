// 0028: 登録前の中1レベル（いちばんの記録を残す）・いま何人挑戦中・抜かれたら知らせる
import test from 'node:test';
import assert from 'node:assert/strict';
import { betterRecord, pickGuestBest, GUEST_BEST_TTL_MS, challengeNowLine, newOvertakes } from '../js/logic.js';

const res = (correct, total_ms = 1000, extra = {}) => ({ answered: correct + 1, correct, total_ms, would_rank: 2, rival: null, ...extra });

test('betterRecord: 連続が多いほう → 同じなら速いほう', () => {
  assert.equal(betterRecord({ correct: 5, total_ms: 9000 }, { correct: 4, total_ms: 1000 }), true);
  assert.equal(betterRecord({ correct: 5, total_ms: 3000 }, { correct: 5, total_ms: 4000 }), true);
  assert.equal(betterRecord({ correct: 5, total_ms: 4000 }, { correct: 5, total_ms: 4000 }), false);
  assert.equal(betterRecord({ correct: 0 }, null), true);
  assert.equal(betterRecord(null, { correct: 1 }), false);
});

test('pickGuestBest: 何回挑戦しても、残すのは いちばんの記録', () => {
  const now = 1_000_000;
  const first = pickGuestBest(null, res(3), 't1', now);
  assert.equal(first.token, 't1');
  assert.equal(first.correct, 3);
  const worse = pickGuestBest(first, res(1), 't2', now + 1);
  assert.equal(worse.token, 't1', '下がった回では入れ替えない');
  const better = pickGuestBest(worse, res(6), 't3', now + 2);
  assert.equal(better.token, 't3');
  assert.equal(better.correct, 6);
});

test('pickGuestBest: 古い記録（サーバーで消える前に端末で捨てる）は残さない。1問も答えていない回は入れない', () => {
  const now = 5_000_000_000;
  const old = { token: 'old', correct: 9, total_ms: 1000, at: now - GUEST_BEST_TTL_MS - 1 };
  assert.equal(pickGuestBest(old, res(2), 'new', now).token, 'new');
  const kept = { token: 'k', correct: 2, total_ms: 1000, at: now };
  assert.equal(pickGuestBest(kept, { answered: 0, correct: 0 }, 'zero', now).token, 'k');
  assert.equal(pickGuestBest(null, { answered: 0, correct: 0 }, 'zero', now), null);
});

test('challengeNowLine: いまプレイ中 と 今週の人数。だれもいなければ 1位が空いている', () => {
  assert.equal(challengeNowLine({ playing_now: 2, week_players: 12 }), 'いま 2人がプレイ中 ・ 今週 12人が挑戦中');
  assert.equal(challengeNowLine({ playing_now: 0, week_players: 5 }), '今週 5人が挑戦中');
  assert.equal(challengeNowLine({ playing_now: 0, week_players: 0 }), '今週の1位は、まだだれもいない');
  assert.equal(challengeNowLine(null), '');
});

test('newOvertakes: まだ見せていない「抜かれた」だけを、レベルごとに1つ', () => {
  const watch = [
    { band: 1, rank: 3, best_streak: 5, my_at: 'm1', passed_by: [{ nickname: 'B', best_streak: 8, at: 't2' }, { nickname: 'C', best_streak: 6, at: 't1' }] },
    { band: 2, rank: 1, best_streak: 4, my_at: 'm2', passed_by: [] }
  ];
  const all = newOvertakes(watch, []);
  assert.equal(all.length, 1);
  assert.equal(all[0].band, 1);
  assert.equal(all[0].by.nickname, 'B');
  assert.equal(all[0].more, 1);
  assert.equal(all[0].mine, 5);
  assert.deepEqual(all[0].keys, ['1:B:m1', '1:C:m1']);

  assert.deepEqual(newOvertakes(watch, all[0].keys), [], '見せたものは出さない');
  const widened = [{ ...watch[0], passed_by: [{ nickname: 'B', best_streak: 9, at: 't3' }, watch[0].passed_by[1]] }];
  assert.deepEqual(newOvertakes(widened, all[0].keys), [], '相手が差を広げただけでは出し直さない');
  const reset = [{ ...watch[0], best_streak: 10, my_at: 'm3', passed_by: [{ nickname: 'B', best_streak: 11, at: 't4' }] }];
  assert.equal(newOvertakes(reset, all[0].keys)[0].by.best_streak, 11, '自分が記録を出し直して、また抜かれたら出す');
  assert.deepEqual(newOvertakes(null), []);
});
