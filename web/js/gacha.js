/**
 * gacha.js - ガチャ画面の描画と演出ハンドリング
 */
import {
  getMyNuts,
  pullGacha,
  getGachaRates,
  getMyShards
} from './api.js';

import {
  escapeHtml,
  calcNutsDisplay,
  gachaPrice,
  formatGachaRates,
  rarityInfo
} from './logic.js';

import {
  playSfx,
  triggerConfetti,
  isMuted,
  toggleMute
} from './game.js';

import { renderMiacis } from './look.js';

/**
 * ガチャ画面を描画する
 *
 * @param {HTMLElement} containerEl - 描画対象コンテナ
 * @param {object} state - アプリグローバル状態
 * @param {object} callbacks - 画面遷移・状態更新コールバック
 */
export async function renderGachaView(containerEl, state, callbacks = {}) {
  containerEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">木の実ガチャ</h1>
      <button class="btn-logout" id="btn-gacha-back-home">戻る</button>
    </header>
    <div id="gacha-main-content">読み込み中...</div>
  `;

  document.getElementById('btn-gacha-back-home').addEventListener('click', () => {
    if (callbacks.onGoHome) callbacks.onGoHome();
    else window.location.hash = '#/home';
  });

  const mainEl = document.getElementById('gacha-main-content');
  if (!mainEl) return;

  try {
    const [nutsData, ratesData, shardsAmount] = await Promise.all([
      getMyNuts(),
      getGachaRates(),
      getMyShards()
    ]);

    state.nuts = nutsData;
    state.shards = shardsAmount;

    renderGachaTop(mainEl, state, ratesData, callbacks);
  } catch (err) {
    mainEl.innerHTML = `
      <div class="alert alert-error">${escapeHtml(err.message)}</div>
      <button class="btn-secondary" id="btn-gacha-err-back" style="margin-top:16px;">ホーム</button>
    `;
    document.getElementById('btn-gacha-err-back')?.addEventListener('click', () => {
      window.location.hash = '#/home';
    });
  }
}

/**
 * ガチャトップ画面（ボタン・確率表）
 */
function renderGachaTop(mainEl, state, ratesData, callbacks) {
  const price = gachaPrice(ratesData);
  state.gachaPrice = price;
  const multiLabel = `${price.multiCount}連`;
  const nutsDisp = calcNutsDisplay(state.nuts.balance, price);
  const formattedRates = formatGachaRates(ratesData);
  const untilSingle = Math.max(0, price.single - nutsDisp.balance);
  const untilTen = Math.max(0, price.multi - nutsDisp.balance);
  const stockPrizes = formattedRates.prizes.filter(p => p.stock > 0);
  const staffNotice = ratesData.staff_mode ? '<div class="alert">スタッフ用：着せ替え・称号のみ出ます。実物景品の週1枚は消費しません。</div>' : '';
  const weeklyNotice = ratesData.weekly_limit ? `<p class="notice-line">ガチャの実物景品は全員で週1枚まで。${ratesData.weekly_remaining === 0 ? '今週分は当選済みです。' : '当選者が出ない週もあります。'} 月曜0:00に枠が戻ります。繰り越しはありません。</p>` : '';
  const prizeShowcase = stockPrizes.length ? `
    <section class="gacha-showcase" aria-labelledby="gacha-showcase-title">
      <p class="gacha-showcase-kicker">館で受け取れる、おくりもの</p>
      <h2 id="gacha-showcase-title">今回の景品ラインナップ</h2>
      <div class="gacha-prize-list">${stockPrizes.map(p => `
        <article class="gacha-prize-ticket"><span aria-hidden="true">🎁</span><div><h3>${escapeHtml(p.name)}</h3><p>在庫 ${p.stock}個</p><p>${escapeHtml(p.description || '')}</p></div></article>
      `).join('')}</div>
      <p class="gacha-showcase-note">景品全体の当選確率：1回あたり ${formattedRates.prizeRatePercent}。個々の景品の確率ではありません。在庫は抽選時に確認されます。</p>
      <p class="gacha-showcase-note">当選した引換券は「自分の記録」から確認できます。</p>
    </section>` : `
    <section class="gacha-showcase"><p class="gacha-showcase-kicker">自分らしいミアキスを見つけよう</p><h2>着せ替え・称号をコレクション</h2><p class="gacha-showcase-note">館の景品は準備中・品切れです。現在は着せ替え・称号が出ます。</p></section>`;


  let prizesHtml = '';
  if (formattedRates.prizes.length > 0) {
    prizesHtml = formattedRates.prizes.map(p => `
      <li style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span>🎁 ${escapeHtml(p.name)}</span>
        <span style="font-weight:700; color:var(--primary);">残り ${p.stock}個</span>
      </li>
    `).join('');
  } else {
    prizesHtml = '<li style="color:var(--text-muted);">景品は準備中。いまは着せ替えと称号</li>';
  }

  const ratesTableHtml = formattedRates.itemRates.map(r => `
    <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border);">
      <span style="font-weight:700;">レア度 ${r.code}</span>
      <span style="color:var(--text-muted);">${r.percent}</span>
    </div>
  `).join('');

  mainEl.innerHTML = `
    ${staffNotice}
    <section class="gacha-wardrobe"><span class="eyebrow">ガチャ</span><h2>次は、どんな相棒に？</h2><p>帽子・メガネ・称号。全45種</p><div class="gacha-mascots">${renderMiacis({hat:{id:'hat_cap'},face:{id:'face_sun'}},100)}${renderMiacis({hat:{id:'hat_crown'},neck:{id:'neck_star'}},136)}${renderMiacis({hat:{id:'hat_ribbon'},neck:{id:'neck_muffler'}},100)}</div><p>着せ替えの一例です。各アイテムは個別に出ます。</p></section>
    <div style="text-align:center; margin: 12px 0 20px 0;">
      <div class="nuts-badge" style="font-size:20px; padding:8px 18px;">
        <span>🌰 ${state.nuts.balance}</span>
      </div>
      <div style="font-size:13px; color:var(--text-muted); margin-top:6px;">
        今日 ${state.nuts.today_earned} / ${state.nuts.daily_cap} 🌰
      </div>
      <div style="font-size:13px; color:var(--link); margin-top:4px;">
        💎 かけら <strong>${state.shards}</strong>
      </div>
    </div>

    <section class="gacha-next-goal" aria-label="ガチャまでの進み具合">
      <div><strong>${untilSingle ? `1回まで あと${untilSingle}` : '1回 引ける'}</strong><span>🌰 ${nutsDisp.balance}</span></div>
      <progress max="${price.multi}" value="${Math.min(price.multi, nutsDisp.balance)}" aria-label="${multiLabel}までの木の実"></progress>
      <p>${untilTen ? `${multiLabel}まで あと${untilTen}` : `${multiLabel} 引ける`}</p>
      <button class="btn-sub" id="btn-gacha-to-battle">木の実を集めに行く</button>
    </section>

    <div class="gacha-pull-actions">
      <!-- 1回ガチャボタン -->
      <button class="btn-secondary" id="btn-pull-1" style="min-height:60px; font-size:18px; font-weight:700;">
        1回引く (${price.single}🌰)
      </button>

      <!-- 10連ガチャボタン -->
      <button class="btn-primary btn-gacha-10 ${nutsDisp.canPull10 ? 'ready' : ''}" id="btn-pull-10" style="min-height:64px; font-size:19px;">
        ${nutsDisp.canPull10 ? `<span class="ready-badge">${multiLabel} 引ける</span>` : ''}
        ${multiLabel}引く (${price.multi}🌰)
        <div style="font-size:12px; font-weight:normal; margin-top:2px;">SR以上 1つ確定${price.multiCount - Math.round(price.multi / price.single) > 0 ? ` ＋${price.multiCount - Math.round(price.multi / price.single)}回おまけ` : ''}</div>
      </button>
    </div>

    ${prizeShowcase}
    ${weeklyNotice}
    <!-- 確率・景品案内 -->
    <div class="card" style="padding:16px; margin-bottom:16px;">
      <div style="font-weight:800; font-size:16px; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
        <span>確率と景品</span>
        <span style="font-size:13px; color:var(--primary); font-weight:700;">景品 ${stockPrizes.length ? formattedRates.prizeRatePercent : '在庫なし'}</span>
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-size:14px; font-weight:700; color:var(--text-muted); margin-bottom:6px;">館の景品（引換券）</div>
        <ul style="list-style:none; font-size:14px; padding-left:4px;">
          ${prizesHtml}
        </ul>
      </div>

      <div>
        <div style="font-size:14px; font-weight:700; color:var(--text-muted); margin-bottom:6px;">レア度の確率</div>
        <div style="font-size:14px;">
          ${ratesTableHtml}
        </div>
      </div>
    </div>

    <div style="display:flex; gap:10px;">
      <button class="btn-sub" id="btn-to-closet">着せ替え</button>
      <button class="btn-sub" id="btn-gacha-home">ホーム</button>
    </div>
  `;

  document.getElementById('btn-gacha-to-battle').addEventListener('click', () => { window.location.hash = '#/battle'; });

  document.getElementById('btn-pull-1').addEventListener('click', () => {
    executeGacha(mainEl, state, 1, callbacks);
  });

  document.getElementById('btn-pull-10').addEventListener('click', () => {
    executeGacha(mainEl, state, 10, callbacks);
  });

  document.getElementById('btn-to-closet').addEventListener('click', () => {
    if (callbacks.onGoCloset) callbacks.onGoCloset();
    else window.location.hash = '#/closet';
  });

  document.getElementById('btn-gacha-home').addEventListener('click', () => {
    if (callbacks.onGoHome) callbacks.onGoHome();
    else window.location.hash = '#/home';
  });
}

/**
 * ガチャ実行と演出処理
 */
async function executeGacha(mainEl, state, count, callbacks) {
  // 残高チェック
  const price = state.gachaPrice || gachaPrice(null);
  const cost = count === 1 ? price.single : price.multi;
  if (state.nuts.balance < cost) {
    alert('木の実が足りない。集めてから');
    return;
  }

  mainEl.innerHTML = `
    <div style="text-align:center; padding:50px 16px;">
      <div style="font-size:48px; margin-bottom:16px; animation: pulse-gold 1s infinite;">🌰</div>
      <div style="font-size:20px; font-weight:800;">開封中…</div>
    </div>
  `;

  try {
    const result = await pullGacha(count);
    state.nuts.balance = result.balance;
    state.shards = result.shards_balance;

    if (callbacks.onUpdateNuts) callbacks.onUpdateNuts(state.nuts.balance);

    // ガチャ演出の開始
    startGachaRevealSequence(mainEl, state, result.results, count, callbacks);
  } catch (err) {
    mainEl.innerHTML = `
      <div class="alert alert-error">${escapeHtml(err.message)}</div>
      <button class="btn-secondary" id="btn-gacha-fail-back" style="margin-top:16px;">戻る</button>
    `;
    document.getElementById('btn-gacha-fail-back')?.addEventListener('click', () => {
      renderGachaView(mainEl.parentElement, state, callbacks);
    });
  }
}

/**
 * ガチャ結果のめくり演出シーケンス
 */
function startGachaRevealSequence(mainEl, state, items, count, callbacks) {
  let currentIndex = 0;
  let openingTimer = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sound = (type, options) => { try { playSfx(type, options); } catch {} };
  function bindSound() {
    const button = mainEl.querySelector('[data-gacha-sound]');
    const refresh = () => {
      button.textContent = isMuted() ? '音：オフ' : '音：オン';
      button.setAttribute('aria-pressed', String(!isMuted()));
    };
    refresh();
    button.onclick = () => { toggleMute(); refresh(); };
  }
  function stopOpening() {
    clearTimeout(openingTimer);
    window.removeEventListener('hashchange', stopOpening);
  }
  function showOpening() {
    if (!mainEl.isConnected) return;
    mainEl.innerHTML = `
      <section class="gacha-opening" aria-labelledby="gacha-opening-title">
        <div class="gacha-opening-tools"><span>${items.length > 1 ? `${items.length}個のおくりもの` : 'ひとつのおくりもの'}</span><button class="btn-sub" data-gacha-sound></button></div>
        <p class="gacha-opening-caption">木の実ガチャ</p>
        <h2 id="gacha-opening-title">おくりものが、届いた。</h2>
        <p role="status" id="gacha-opening-status">タップで開封</p>
        <button class="gacha-gift-pack" aria-label="パックを開封する">
          <img src="assets/miacis-logo.png" width="72" height="72" alt="">
          <span>木の実の<br>おくりもの</span><small>タップして開封</small>
        </button>
        <p class="gacha-opening-note">獲得したアイテムを見てみよう</p>
        <button class="btn-sub" id="btn-opening-skip">演出をスキップして結果を見る</button>
      </section>`;
    bindSound();
    const pack = mainEl.querySelector('.gacha-gift-pack');
    pack.focus({ preventScroll: true });
    pack.onclick = () => {
      if (pack.disabled) return;
      pack.disabled = true;
      pack.classList.add('is-opening');
      mainEl.querySelector('#gacha-opening-status').textContent = 'パックがひらく…';
      sound('packShake');
      if (reducedMotion) showCard(0);
      else openingTimer = setTimeout(() => { stopOpening(); showCard(0); }, 1200);
    };
    mainEl.querySelector('#btn-opening-skip').onclick = () => { stopOpening(); showSummary(); };
    window.addEventListener('hashchange', stopOpening, { once: true });
  }

  function showCard(idx) {
    stopOpening();
    if (!mainEl.isConnected) return;
    if (idx >= items.length) {
      showSummary();
      return;
    }

    const item = items[idx];
    const isPrize = item.kind === 'prize';
    const rInfo = rarityInfo(item.rarity || 1);

    let visualHtml = '';
    if (isPrize) {
      visualHtml = `
        <div style="font-size:56px; margin-bottom:8px;">🎁</div>
        <div style="font-size:14px; font-weight:800; color:#ec4899; margin-bottom:4px;">館の実物景品！</div>
      `;
    } else {
      if (item.slot === 'hat' || item.slot === 'face' || item.slot === 'neck') {
        visualHtml = renderMiacis({ [item.slot]: item }, 144);
      } else if (item.slot === 'background') {
        visualHtml = `
          <div style="width:70px; height:70px; border-radius:50%; background:${item.display?.css || '#1e6b3c'}; margin:0 auto 8px auto; box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>
        `;
      } else if (item.slot === 'aura') {
        const color = item.display?.color || '#ffffff';
        visualHtml = `
          <div style="width:60px; height:60px; border-radius:50%; background:#111; border:3px solid ${color}; box-shadow:0 0 16px ${color}; margin:0 auto 8px auto;"></div>
        `;
      } else if (item.slot === 'title') {
        visualHtml = `
          <div style="font-size:36px; margin-bottom:8px;">👑</div>
        `;
      } else {
        visualHtml = `<div style="font-size:50px; margin-bottom:8px;">✨</div>`;
      }
    }

    let badgeHtml = '';
    if (isPrize) {
      badgeHtml = `<div class="new-badge" style="background:#ec4899;">館の引換券</div>`;
    } else if (item.is_new) {
      badgeHtml = `<div class="new-badge">NEW!</div>`;
    } else {
      badgeHtml = `<div class="shard-badge">重複: 💎+${item.shards}</div>`;
    }

    let ticketInfoHtml = '';
    if (isPrize && item.ticket_id) {
      const shortId = item.ticket_id.slice(-8);
      ticketInfoHtml = `
        <div class="prize-ticket-box">
          <div style="font-size:16px; font-weight:900; color:#ec4899;">館内引換券</div>
          <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">Miacis の館内でスタッフに見せてね</div>
          <div class="ticket-number">No. ${escapeHtml(shortId)}</div>
        </div>
      `;
    }

    mainEl.innerHTML = `
      <div class="gacha-stage gacha-reveal-stage">
        <div style="display:flex; justify-content:space-between; width:100%; align-items:center; margin-bottom:12px;">
          <div style="font-size:15px; font-weight:700;">
            ${items.length > 1 ? `${idx + 1} / ${items.length} 枚目` : '結果'}
          </div>
          <div class="gacha-reveal-tools"><button class="btn-sub" data-gacha-sound></button><button class="btn-sub" id="btn-skip-gacha">まとめて見る</button></div>
        </div>

        <div class="gacha-card-container" id="gacha-card-wrap">
          <div class="gacha-card">
            <button class="gacha-card-front" id="btn-reveal-card" aria-label="アイテムをめくる"><img src="assets/miacis-logo.png" width="64" height="64" alt=""><span>タップでめくる</span></button>
            <div class="gacha-card-back rarity-${item.rarity} ${isPrize ? 'is-prize' : ''}" aria-hidden="true">
              ${badgeHtml}
              ${visualHtml}
              <div style="font-size:17px; font-weight:800; margin-bottom:4px;">${escapeHtml(item.name)}</div>
              <div style="font-size:13px; color:${rInfo.color}; font-weight:700;">${rInfo.label}</div>
            </div>
          </div>
        </div>

        <div id="gacha-ticket-detail" hidden>${ticketInfoHtml}</div>
        <p class="gacha-reveal-status" role="status">どんなアイテムかな？</p>

        <div style="width:100%; margin-top:16px;">
          <button class="btn-primary" id="btn-next-card" hidden style="font-size:18px;">
            ${idx + 1 < items.length ? '次のアイテムへ ➡️' : '結果を見る ✨'}
          </button>
        </div>
      </div>
    `;

    bindSound();
    const revealButton = mainEl.querySelector('#btn-reveal-card');
    revealButton.focus({ preventScroll: true });
    revealButton.onclick = () => {
      if (revealButton.disabled) return;
      revealButton.disabled = true;
      revealButton.setAttribute('aria-hidden', 'true');
      mainEl.querySelector('.gacha-card').classList.add('flipped');
      mainEl.querySelector('.gacha-card-back').removeAttribute('aria-hidden');
      mainEl.querySelector('#gacha-ticket-detail').hidden = false;
      mainEl.querySelector('.gacha-reveal-status').textContent = isPrize ? '館の景品引換券を獲得！' : `${rInfo.label}を獲得！`;
      const next = mainEl.querySelector('#btn-next-card');
      next.hidden = false;
      next.focus({ preventScroll: true });
      sound(isPrize ? 'prizeWin' : 'cardReveal', { rarity: item.rarity });
      if (!reducedMotion && (isPrize || item.rarity >= 3)) {
        try { triggerConfetti(1600); } catch {}
      }
    };

    document.getElementById('btn-next-card').addEventListener('click', () => {
      currentIndex++;
      showCard(currentIndex);
    });

    const skipBtn = document.getElementById('btn-skip-gacha');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        showSummary();
      });
    }
  }

  function showSummary() {
    stopOpening();
    if (!mainEl.isConnected) return;
    let gainedShards = 0;
    let prizeCount = 0;
    const itemsHtml = items.map(item => {
      const isPrize = item.kind === 'prize';
      if (isPrize) prizeCount++;
      if (item.shards) gainedShards += item.shards;
      const rInfo = rarityInfo(item.rarity || 1);

      let itemIcon = '✨';
      if (isPrize) {
        itemIcon = '🎁';
      } else if (item.display?.emoji) {
        itemIcon = escapeHtml(item.display.emoji);
      } else if (item.slot === 'background') {
        itemIcon = '🌄';
      } else if (item.slot === 'aura') {
        itemIcon = '🌟';
      } else if (item.slot === 'title') {
        itemIcon = '👑';
      }

      return `
        <div class="gacha-summary-item rarity-${item.rarity} ${isPrize ? 'is-prize' : ''}">
          <div style="font-size:32px; margin-bottom:4px;">${itemIcon}</div>
          <div style="font-size:14px; font-weight:700; margin-bottom:2px; line-height:1.2;">${escapeHtml(item.name)}</div>
          <div style="font-size:11px; color:${rInfo.color}; font-weight:700;">${isPrize ? '景品' : rInfo.code}</div>
          <div style="margin-top:4px;">
            ${isPrize ? '<span class="new-badge" style="font-size:10px; padding:1px 5px; background:#ec4899;">景品</span>' : (item.is_new ? '<span class="new-badge" style="font-size:10px; padding:1px 5px;">NEW</span>' : `<span style="font-size:11px; color:var(--link);">💎+${item.shards}</span>`)}
          </div>
        </div>
      `;
    }).join('');

    let prizeAlertHtml = '';
    if (prizeCount > 0) {
      prizeAlertHtml = `
        <div class="prize-ticket-box" style="margin-bottom:16px;">
          <div style="font-size:18px; font-weight:900; color:#ec4899;">🎉 館の景品が ${prizeCount} 件当選しました！</div>
          <div style="font-size:14px; margin-top:6px;">「自分の記録」の引換券一覧からスタッフに見せて交換してね</div>
        </div>
      `;
    }

    mainEl.innerHTML = `
      <div style="text-align:center; padding:10px 0 20px 0;">
        <h2 style="font-size:22px; font-weight:900; margin-bottom:6px;">ガチャ結果</h2>
        <div style="font-size:14px; color:var(--text-muted);">
          残高: <strong>${state.nuts.balance} 🌰</strong> / 獲得かけら: <strong>💎 +${gainedShards}</strong>
        </div>
      </div>

      ${prizeAlertHtml}

      <div class="gacha-grid">
        ${itemsHtml}
      </div>

      <div style="display:flex; flex-direction:column; gap:12px; margin-top:24px;">
        <button class="btn-primary" id="btn-pull-again" style="font-size:18px;">
          もう一度引く (${count === 1 ? (state.gachaPrice || gachaPrice(null)).single : (state.gachaPrice || gachaPrice(null)).multi}🌰)
        </button>
        <button class="btn-secondary" id="btn-summary-closet">着せ替え画面へ</button>
        <button class="btn-sub" id="btn-summary-home">ホーム</button>
      </div>
    `;

    const summaryTitle = mainEl.querySelector('h2');
    summaryTitle.tabIndex = -1;
    summaryTitle.focus({ preventScroll: true });

    document.getElementById('btn-pull-again').addEventListener('click', () => {
      executeGacha(mainEl, state, count, callbacks);
    });

    document.getElementById('btn-summary-closet').addEventListener('click', () => {
      if (callbacks.onGoCloset) callbacks.onGoCloset();
      else window.location.hash = '#/closet';
    });

    document.getElementById('btn-summary-home').addEventListener('click', () => {
      if (callbacks.onGoHome) callbacks.onGoHome();
      else window.location.hash = '#/home';
    });
  }

  showOpening();
}
