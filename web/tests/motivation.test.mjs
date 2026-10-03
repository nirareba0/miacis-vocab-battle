// 学習のやる気（0023）の画面ロジック
import test from 'node:test';
import assert from 'node:assert/strict';
import { questSummary, questLine, zukanGain, zukanNextLine, coinsToGacha, raffleRateLabel, gachaPrice } from '../js/logic.js';

const STATE = { quests: [
  { key: 'survival', label: 'サバイバル', unit: '回', goal: 1, progress: 1, claimed: true },
  { key: 'correct', label: '正解', unit: '問', goal: 20, progress: 12 },
  { key: 'new_words', label: '図鑑に新しい単語', unit: '語', goal: 5, progress: 7 }
] };

test('questSummary: 済んだ数・次の1つ・全部済んだか。進みは目標で止める', () => {
  const s = questSummary(STATE);
  assert.equal(s.done, 2);
  assert.equal(s.total, 3);
  assert.equal(s.allDone, false);
  assert.equal(s.next.key, 'correct');
  assert.equal(s.next.left, 8);
  assert.equal(s.quests[2].progress, 5);
  assert.equal(questSummary({ quests: STATE.quests.map(q => ({ ...q, progress: q.goal })) }).allDone, true);
  assert.deepEqual(questSummary(null), { quests: [], done: 0, total: 0, allDone: false, next: null });
});

test('questLine: 目標1のものは数を並べない。それ以外は いま/目標', () => {
  assert.equal(questLine(STATE.quests[0]), 'サバイバル 1回');
  assert.equal(questLine(STATE.quests[1]), '正解 12/20問');
  assert.equal(questLine(STATE.quests[2]), '図鑑に新しい単語 5/5語');
});

test('zukanGain / zukanNextLine: 1回で増えた語と、次のごほうびまで', () => {
  const before = [{ band: 1, total: 911, collected: 110, next_at: 150, next_kind: 'coin', coin: 5 }];
  const after = [{ band: 1, total: 911, collected: 117, next_at: 150, next_kind: 'coin', coin: 5 }];
  const g = zukanGain(before, after, 1);
  assert.deepEqual(g, { gained: 7, collected: 117, total: 911, toNext: 33, nextKind: 'coin', coin: 5 });
  assert.equal(zukanNextLine(g), 'あと33語で Mi +5');
  assert.equal(zukanNextLine({ ...g, collected: 905, toNext: 6, nextKind: 'complete' }, '新入生のミアキス'), 'あと6語で 新入生のミアキス');
  assert.equal(zukanNextLine({ ...g, collected: 911 }), 'コンプリート済み');
  assert.equal(zukanGain(null, after, 1).gained, 0);
  assert.equal(zukanGain(before, after, 2), null);
});

test('coinsToGacha: ガチャ1回まであと何個', () => {
  assert.equal(coinsToGacha(3, gachaPrice({ pull_cost: 5 })), 2);
  assert.equal(coinsToGacha(9, gachaPrice({ pull_cost: 5 })), 0);
  assert.equal(coinsToGacha(undefined), 5);
});

test('raffleRateLabel: スタッフには「0%」と出さない', () => {
  assert.equal(raffleRateLabel({ raffle_rate: 0.1 }), 'ガチャ1回で 10%');
  assert.equal(raffleRateLabel({ raffle_rate: 0, staff_mode: true }), 'スタッフには出ない');
  assert.equal(raffleRateLabel({ raffle_rate: 0 }), 'いまは出ない');
});
