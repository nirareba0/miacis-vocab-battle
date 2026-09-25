import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInviteCode,
  calcStageProgress,
  rarityInfo,
  checkComboMilestone,
  getStageName,
  translateError
} from '../js/logic.js';

test('normalizeInviteCode: 合言葉の入力の正規化 (トリム・全角空白・小文字化)', () => {
  assert.equal(normalizeInviteCode('Miacis'), 'miacis');
  assert.equal(normalizeInviteCode('  MIACIS  '), 'miacis');
  assert.equal(normalizeInviteCode('\u3000miacis 2026\u3000'), 'miacis 2026');
  assert.equal(normalizeInviteCode('  Secret Code  '), 'secret code');
  assert.equal(normalizeInviteCode(''), '');
  assert.equal(normalizeInviteCode(null), '');
  assert.equal(normalizeInviteCode(undefined), '');
  assert.equal(normalizeInviteCode(123), '');
});

test('calcStageProgress: 段階とバーの割合の計算', () => {
  // 0 pt -> stage 1, 0%
  const p0 = calcStageProgress(0);
  assert.equal(p0.stage, 1);
  assert.equal(p0.nextThreshold, 30);
  assert.equal(p0.pointsToNext, 30);
  assert.equal(p0.percent, 0);

  // 15 pt -> stage 1, 50%
  const p15 = calcStageProgress(15);
  assert.equal(p15.stage, 1);
  assert.equal(p15.nextThreshold, 30);
  assert.equal(p15.pointsToNext, 15);
  assert.equal(p15.percent, 50);

  // 30 pt -> stage 2, 0% (範囲: 30〜80, 幅 50)
  const p30 = calcStageProgress(30);
  assert.equal(p30.stage, 2);
  assert.equal(p30.nextThreshold, 80);
  assert.equal(p30.pointsToNext, 50);
  assert.equal(p30.percent, 0);

  // 55 pt -> stage 2, 50% ( (55 - 30) / 50 = 50% )
  const p55 = calcStageProgress(55);
  assert.equal(p55.stage, 2);
  assert.equal(p55.nextThreshold, 80);
  assert.equal(p55.pointsToNext, 25);
  assert.equal(p55.percent, 50);

  // 80 pt -> stage 3, 0% (範囲: 80〜160, 幅 80)
  const p80 = calcStageProgress(80);
  assert.equal(p80.stage, 3);
  assert.equal(p80.nextThreshold, 160);
  assert.equal(p80.pointsToNext, 80);
  assert.equal(p80.percent, 0);

  // 160 pt -> stage 4 (範囲: 160〜300, 幅 140)
  const p160 = calcStageProgress(160);
  assert.equal(p160.stage, 4);
  assert.equal(p160.nextThreshold, 300);
  assert.equal(p160.pointsToNext, 140);
  assert.equal(p160.percent, 0);

  // 300 pt -> stage 5 (範囲: 300〜500, 幅 200)
  const p300 = calcStageProgress(300);
  assert.equal(p300.stage, 5);
  assert.equal(p300.nextThreshold, 500);
  assert.equal(p300.pointsToNext, 200);

  // 500 pt -> stage 6 (範囲: 500〜800, 幅 300)
  const p500 = calcStageProgress(500);
  assert.equal(p500.stage, 6);
  assert.equal(p500.nextThreshold, 800);
  assert.equal(p500.pointsToNext, 300);

  // 800 pt 以上 -> stage 7, 100%, pointsToNext 0
  const p800 = calcStageProgress(800);
  assert.equal(p800.stage, 7);
  assert.equal(p800.nextThreshold, null);
  assert.equal(p800.pointsToNext, 0);
  assert.equal(p800.percent, 100);

  const p1200 = calcStageProgress(1200);
  assert.equal(p1200.stage, 7);
  assert.equal(p1200.percent, 100);
});

test('rarityInfo: レア度の表示名・色の対応', () => {
  const n = rarityInfo(1);
  assert.equal(n.code, 'N');
  assert.equal(n.label, 'ノーマル');
  assert.ok(n.color);
  assert.equal(n.isRainbow, false);

  const r = rarityInfo(2);
  assert.equal(r.code, 'R');
  assert.equal(r.label, 'レア');
  assert.ok(r.color);
  assert.equal(r.isRainbow, false);

  const sr = rarityInfo(3);
  assert.equal(sr.code, 'SR');
  assert.equal(sr.label, 'スーパーレア');
  assert.ok(sr.color);
  assert.equal(sr.isRainbow, false);

  const ur = rarityInfo(4);
  assert.equal(ur.code, 'UR');
  assert.equal(ur.label, 'ウルトラレア');
  assert.ok(ur.color);
  assert.equal(ur.isRainbow, true);

  // 不正値は N にフォールバック
  const unknown = rarityInfo(99);
  assert.equal(unknown.code, 'N');
});

test('checkComboMilestone: コンボの判定 (3・5・7・10)', () => {
  assert.equal(checkComboMilestone(1).isMilestone, false);
  assert.equal(checkComboMilestone(2).isMilestone, false);

  assert.equal(checkComboMilestone(3).isMilestone, true);
  assert.equal(checkComboMilestone(3).label, '3 COMBO!');

  assert.equal(checkComboMilestone(4).isMilestone, false);

  assert.equal(checkComboMilestone(5).isMilestone, true);
  assert.equal(checkComboMilestone(5).label, '5 COMBO!');

  assert.equal(checkComboMilestone(6).isMilestone, false);

  assert.equal(checkComboMilestone(7).isMilestone, true);
  assert.equal(checkComboMilestone(7).label, '7 COMBO!');

  assert.equal(checkComboMilestone(8).isMilestone, false);
  assert.equal(checkComboMilestone(9).isMilestone, false);

  assert.equal(checkComboMilestone(10).isMilestone, true);
  assert.equal(checkComboMilestone(10).label, '10 COMBO!');

  assert.equal(checkComboMilestone(11).isMilestone, false);
});

test('getStageName: 段階名とルートの対応', () => {
  assert.equal(getStageName(1, null), 'ちびミアキス');
  assert.equal(getStageName(2, null), 'ミアキス');

  assert.equal(getStageName(3, 'grass'), '草原をめざすミアキス');
  assert.equal(getStageName(3, 'tree'), '木の上のミアキス');

  assert.equal(getStageName(4, 'grass'), 'ハイイロギツネ級');
  assert.equal(getStageName(4, 'tree'), 'ヤマネコ級');

  assert.equal(getStageName(5, 'grass'), 'オオカミ級');
  assert.equal(getStageName(5, 'tree'), 'ヒョウ級');

  assert.equal(getStageName(6, 'grass'), 'ダイアウルフ級');
  assert.equal(getStageName(6, 'tree'), 'トラ級');

  assert.equal(getStageName(7, 'grass'), '草原の王');
  assert.equal(getStageName(7, 'tree'), '森の王');
});

test('translateError: 新規ゲームエラーの翻訳', () => {
  assert.equal(translateError('invite_not_set'), '合言葉がまだ設定されていません。スタッフに確認してね');
  assert.equal(translateError('invite_invalid'), '合言葉が違います（館内の掲示を見てね）');
  assert.equal(translateError('pack_limit'), '今日のカードパックは上限（3回）に達しました。明日また引いてね');
  assert.equal(translateError('already_drawn'), 'この対戦のカードパックはすでに開封済みです');
  assert.equal(translateError('match_not_finished'), '対戦がまだ完了していません');
});
