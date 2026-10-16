import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyCouponToShow } from '../js/logic.js';

const now = Date.parse('2026-10-19T09:00:00+09:00');
const t = (id, over) => ({ id, prize_name: '選べる無料券（週間1位）', reward_channel: 'ranking', won_at: '2026-10-19T00:05:00', redeemed_at: null, ...over });

test('週間1位の未使用の券を出す', () => {
  assert.equal(weeklyCouponToShow([t('a')], now)?.id, 'a');
});

test('ガチャや抽選の券・使った券・古い券は出さない', () => {
  assert.equal(weeklyCouponToShow([
    t('g', { reward_channel: 'gacha' }),
    t('r', { reward_channel: 'raffle' }),
    t('u', { redeemed_at: '2026-10-19T08:00:00' }),
    t('o', { won_at: '2026-10-05T00:05:00' }),
  ], now), null);
});

test('2枚あれば新しいほう。reward_channel が無い（0038 の前）なら出さない', () => {
  assert.equal(weeklyCouponToShow([t('old', { won_at: '2026-10-13T00:05:00' }), t('new')], now)?.id, 'new');
  assert.equal(weeklyCouponToShow([{ id: 'x', won_at: '2026-10-19T00:05:00', redeemed_at: null }], now), null);
  assert.equal(weeklyCouponToShow(null, now), null);
});

import { after6PassToday } from '../js/logic.js';

test('AFTER6 参加証: きょう遊んだ日だけ出す', () => {
  const chips = (todayState) => ({ chips: [{ label: '月', state: 'played', today: false }, { label: '火', state: todayState, today: true }] });
  assert.equal(after6PassToday(chips('played')), true);
  assert.equal(after6PassToday(chips('open')), false);
  assert.equal(after6PassToday(chips('closed')), false);
  assert.equal(after6PassToday(null), false);
});
