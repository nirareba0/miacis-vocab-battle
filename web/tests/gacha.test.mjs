import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcNutsDisplay,
  calcRemainingCap,
  formatGachaRates,
  checkGuaranteedSr,
  itemExchangeCost,
  rarityInfo
} from '../js/logic.js';
import {
  sanitizeCss,
  sanitizeColor,
  renderMiacis
} from '../js/look.js';

test('木の実の表示計算: 残高・1回可能・10連可能・残り上限', () => {
  // 0🌰: どちらも不可
  const d0 = calcNutsDisplay(0);
  assert.equal(d0.balance, 0);
  assert.equal(d0.canPull1, false);
  assert.equal(d0.canPull10, false);
  assert.equal(d0.label, '0 🌰');

  // 14🌰: どちらも不可
  const d14 = calcNutsDisplay(14);
  assert.equal(d14.canPull1, false);
  assert.equal(d14.canPull10, false);

  // 15🌰: 1回のみ可能
  const d15 = calcNutsDisplay(15);
  assert.equal(d15.canPull1, true);
  assert.equal(d15.canPull10, false);

  // 149🌰: 1回のみ可能
  const d149 = calcNutsDisplay(149);
  assert.equal(d149.canPull1, true);
  assert.equal(d149.canPull10, false);

  // 150🌰: 10連可能
  const d150 = calcNutsDisplay(150);
  assert.equal(d150.canPull1, true);
  assert.equal(d150.canPull10, true);

  // 上限計算
  assert.equal(calcRemainingCap(300, 100), 200);
  assert.equal(calcRemainingCap(300, 300), 0);
  assert.equal(calcRemainingCap(300, 350), 0);
});

test('10連のSR以上保証の判定', () => {
  // 10連で全部 N (rarity 1) -> 保証なし判定 (false)
  const allN = Array.from({ length: 10 }, () => ({ rarity: 1, kind: 'item' }));
  assert.equal(checkGuaranteedSr(10, allN), false);

  // 10連の中に1つ SR (rarity 3) -> 保証満たす (true)
  const withSr = [...allN.slice(0, 9), { rarity: 3, kind: 'item' }];
  assert.equal(checkGuaranteedSr(10, withSr), true);

  // 10連の中に1つ UR (rarity 4) -> 保証満たす (true)
  const withUr = [{ rarity: 4, kind: 'item' }, ...allN.slice(1)];
  assert.equal(checkGuaranteedSr(10, withUr), true);

  // 10連の中に prize -> 保証満たす (true)
  const withPrize = [...allN.slice(0, 9), { kind: 'prize', rarity: 4 }];
  assert.equal(checkGuaranteedSr(10, withPrize), true);

  // 1回引きはチェック不要 (true)
  assert.equal(checkGuaranteedSr(1, [{ rarity: 1 }]), true);
});

test('レア度の色・ラベル対応', () => {
  const n = rarityInfo(1);
  assert.equal(n.code, 'N');
  assert.equal(n.color, '#94a3b8'); // 白・グレー系
  assert.equal(n.isRainbow, false);

  const r = rarityInfo(2);
  assert.equal(r.code, 'R');
  assert.equal(r.color, '#3b82f6'); // 青

  const sr = rarityInfo(3);
  assert.equal(sr.code, 'SR');
  assert.equal(sr.color, '#F2C200'); // 金

  const ur = rarityInfo(4);
  assert.equal(ur.code, 'UR');
  assert.equal(ur.isRainbow, true); // 虹
});

test('かけら交換コストの計算', () => {
  assert.equal(itemExchangeCost(1), 10);
  assert.equal(itemExchangeCost(2), 30);
  assert.equal(itemExchangeCost(3), 100);
  assert.equal(itemExchangeCost(4), 300);
});

test('ガチャの確率表の整形', () => {
  const rates = {
    prize_rate: 0.015,
    prizes: [
      { name: '特製ステッカー', stock: 12 },
      { name: 'クリアファイル', stock: 5 }
    ],
    item_rates: { N: 0.70, R: 0.22, SR: 0.07, UR: 0.01 }
  };

  const formatted = formatGachaRates(rates);
  assert.equal(formatted.prizeRatePercent, '1.5%');
  assert.equal(formatted.prizes.length, 2);
  assert.equal(formatted.prizes[0].name, '特製ステッカー');
  assert.equal(formatted.prizes[0].stock, 12);

  const urRate = formatted.itemRates.find(it => it.code === 'UR');
  assert.equal(urRate.percent, '1%');

  const srRate = formatted.itemRates.find(it => it.code === 'SR');
  assert.equal(srRate.percent, '7%');
});

test('CSS / カラーのサニタイズ: 許可された書式のみを通し危険な値を排除', () => {
  // 正常なグラデーション
  assert.equal(
    sanitizeCss('linear-gradient(135deg, #1e6b3c, #f2c200)'),
    'linear-gradient(135deg, #1e6b3c, #f2c200)'
  );
  assert.equal(
    sanitizeCss('linear-gradient(to right, #00c6ff, #0072ff)'),
    'linear-gradient(to right, #00c6ff, #0072ff)'
  );

  // 正常な単色
  assert.equal(sanitizeCss('#1e6b3c'), '#1e6b3c');
  assert.equal(sanitizeCss('#fff'), '#fff');

  // 危険な CSS やタグの混入
  assert.equal(sanitizeCss("url('javascript:alert(1)')"), '');
  assert.equal(sanitizeCss("<script>alert('x')</script>"), '');
  assert.equal(sanitizeCss('linear-gradient(red, blue); background: red'), '');
  assert.equal(sanitizeCss('expression(alert(1))'), '');
  assert.equal(sanitizeCss('red'), ''); // 名前付きカラーは拒否

  // カラーコード
  assert.equal(sanitizeColor('#f6c6cf'), '#f6c6cf');
  assert.equal(sanitizeColor('red; display:none'), '');
  assert.equal(sanitizeColor('<script>'), '');
});

test('renderMiacis: HTML を安全に組み立て、特殊文字をエスケープする', () => {
  // 悪意のある値を含む look
  const maliciousLook = {
    hat: {
      id: 'hat_bad',
      name: '悪意の帽子',
      display: { emoji: `<img src=x onerror="alert('hat')">` }
    },
    face: {
      id: 'face_bad',
      name: '悪意の顔',
      display: { emoji: `<script>alert('face')</script>` }
    },
    background: {
      id: 'bg_bad',
      name: '悪意の背景',
      display: { css: `linear-gradient(135deg, #000, #fff); alert(1)` }
    },
    aura: {
      id: 'aura_bad',
      name: '悪意のオーラ',
      display: { color: `red; background: black`, glow: '20' }
    }
  };

  const html = renderMiacis(maliciousLook, 120);

  // スクリプトタグやイベントハンドラーが生で残っていないこと
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('onerror="alert'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
  assert.equal(html.includes('&lt;img src=x'), true);

  // 危険な CSS はサニタイズされてデフォルト背景または安全な値になっていること
  assert.equal(html.includes('alert(1)'), false);
  assert.equal(html.includes('red; background: black'), false);

  // ロゴ画像が正しく含まれていること
  assert.equal(html.includes('assets/miacis-logo.png'), true);
});

test('renderMiacis: look が空または null でも正常に描画できる', () => {
  const htmlNull = renderMiacis(null, 100);
  assert.ok(htmlNull.includes('miacis-avatar-box'));
  assert.ok(htmlNull.includes('assets/miacis-logo.png'));

  const htmlEmpty = renderMiacis({}, 80);
  assert.ok(htmlEmpty.includes('miacis-avatar-box'));
  assert.ok(htmlEmpty.includes('assets/miacis-logo.png'));
});
