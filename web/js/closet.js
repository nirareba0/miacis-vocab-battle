/**
 * closet.js - 着せ替え・称号の着脱とかけら交換画面
 */
import {
  getItems,
  getMyItems,
  getMyLooks,
  equipItem,
  getMyShards,
  exchangeItem
} from './api.js';

import {
  escapeHtml,
  itemExchangeCost,
  rarityInfo,
  canExchange,
  EXCHANGE_MAX_RARITY,
  FORM_BLOCKS
} from './logic.js';

import { playSfx } from './game.js';
import { renderMiacis } from './look.js';

const SLOTS = [
  { id: 'form', label: '🐾 すがた' },
  { id: 'hat', label: '🎩 帽子' },
  { id: 'face', label: '👓 顔' },
  { id: 'neck', label: '🧣 首まわり' },
  { id: 'background', label: '🌄 背景' },
  { id: 'aura', label: '🌟 オーラ' },
  { id: 'title', label: '👑 称号' }
];

/**
 * 着せ替え画面を描画する
 */
export async function renderClosetView(containerEl, state, callbacks = {}) {
  containerEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">着せ替え</h1>
      <button class="btn-logout" id="btn-closet-back-home">戻る</button>
    </header>
    <div id="closet-main-content">読み込み中...</div>
  `;

  document.getElementById('btn-closet-back-home').addEventListener('click', () => {
    if (callbacks.onGoHome) callbacks.onGoHome();
    else window.location.hash = '#/home';
  });

  const mainEl = document.getElementById('closet-main-content');
  if (!mainEl) return;

  try {
    const [allItems, myItemsList, myLooksData, shardsAmount] = await Promise.all([
      getItems(),
      getMyItems(),
      getMyLooks(),
      getMyShards()
    ]);

    state.allItems = allItems;
    state.myItems = myItemsList;
    state.myLooks = myLooksData || {};
    state.shards = shardsAmount;
    if (!state.closetActiveTab) {
      state.closetActiveTab = 'hat';
    }

    renderClosetBody(mainEl, state, callbacks);
  } catch (err) {
    mainEl.innerHTML = `
      <div class="alert alert-error">${escapeHtml(err.message)}</div>
      <button class="btn-secondary" id="btn-closet-err-back" style="margin-top:16px;">ホーム</button>
    `;
    document.getElementById('btn-closet-err-back')?.addEventListener('click', () => {
      window.location.hash = '#/home';
    });
  }
}

/**
 * 着せ替え画面本体
 */
function renderClosetBody(mainEl, state, callbacks) {
  // アイテムマップ作成
  const itemMap = Object.fromEntries(state.allItems.map(it => [it.id, it]));

  // 現在の見た目オブジェクト構築
  const currentLook = {
    hat: itemMap[state.myLooks.hat] || null,
    face: itemMap[state.myLooks.face] || null,
    neck: itemMap[state.myLooks.neck] || null,
    background: itemMap[state.myLooks.background] || null,
    aura: itemMap[state.myLooks.aura] || null,
    title: itemMap[state.myLooks.title] || null,
    form: itemMap[state.myLooks.form] || null
  };

  const previewHtml = renderMiacis(currentLook, 160);
  const currentTitleName = currentLook.title ? escapeHtml(currentLook.title.name) : '称号なし';

  const tabsHtml = SLOTS.map(s => `
    <button class="closet-tab-btn ${state.closetActiveTab === s.id ? 'active' : ''}" data-slot="${s.id}">
      ${s.label}
    </button>
  `).join('');

  // 現在選択中のスロットの所持アイテム
  const myOwnedIds = new Set(state.myItems.map(it => it.item_id));
  const slotAllItems = state.allItems.filter(it => it.slot === state.closetActiveTab);
  const slotOwnedItems = slotAllItems.filter(it => myOwnedIds.has(it.id));
  const slotUnownedCount = slotAllItems.length - slotOwnedItems.length;

  const currentEquippedId = state.myLooks[state.closetActiveTab];
  // すがた（特殊スキン）を着ている間は、帽子・顔・首は付けられない（外せば元の装備が戻る）
  const blocked = !!state.myLooks.form && FORM_BLOCKS.includes(state.closetActiveTab);

  let itemsGridHtml = '';

  // 現在装備中の解除ボタン（装備中アイテムがある場合）
  let unequipBtnHtml = '';
  if (blocked) {
    unequipBtnHtml = `
      <div class="closet-blocked">
        <strong>すがたの間は 付けられない</strong>
        <button class="btn-sub" id="btn-unequip-form">すがたを外す</button>
      </div>
    `;
  } else if (currentEquippedId) {
    unequipBtnHtml = `
      <div style="margin-bottom:12px;">
        <button class="btn-secondary" id="btn-unequip-current" style="min-height:44px; font-size:14px;">外す</button>
      </div>
    `;
  }

  if (slotOwnedItems.length === 0) {
    itemsGridHtml = `
      <div class="card" style="grid-column: 1 / -1; text-align:center; padding:24px 12px; color:var(--text-muted);">
        まだ ない。ガチャで出る
      </div>
    `;
  } else {
    itemsGridHtml = slotOwnedItems.map(item => {
      const isEquipped = item.id === currentEquippedId;
      const rInfo = rarityInfo(item.rarity);

      let visual = '✨';
      if (item.slot !== 'title') {
        // 帽子・顔・首・すがた・背景・オーラは、相棒に付けた姿で見せる
        visual = renderMiacis({ [item.slot]: item }, 72);
      } else if (item.slot === 'background') {
        visual = `<div style="width:36px; height:36px; border-radius:50%; background:${item.display?.css || '#1e6b3c'}; box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`;
      } else if (item.slot === 'aura') {
        const c = item.display?.color || '#ffffff';
        visual = `<div style="width:30px; height:30px; border-radius:50%; background:#111; border:2px solid ${c}; box-shadow:0 0 8px ${c};"></div>`;
      } else if (item.slot === 'title') {
        visual = '👑';
      }

      return `
        <button type="button" aria-pressed="${isEquipped}" ${blocked ? 'disabled' : ''} class="closet-item-card ${isEquipped ? 'equipped' : ''}" data-item-id="${item.id}" style="border-color:${isEquipped ? 'var(--primary)' : rInfo.color};">
          ${isEquipped ? '<span class="equipped-tag">装備中</span>' : ''}
          <div style="font-size:32px; margin-bottom:8px; height:76px; display:flex; align-items:center; justify-content:center;">${visual}</div>
          <div style="font-size:13px; font-weight:700; margin-bottom:2px; line-height:1.2;">${escapeHtml(item.name)}</div>
          <div style="font-size:11px; color:${rInfo.color}; font-weight:700;">${rInfo.code}</div>
        </button>
      `;
    }).join('');
  }

  // 未所持プレースホルダー
  let unownedSummaryHtml = '';
  if (slotUnownedCount > 0) {
    unownedSummaryHtml = `
      <div style="text-align:center; font-size:13px; color:var(--text-muted); margin-top:12px;">
        🔒 あと <strong>${slotUnownedCount}</strong>種
      </div>
    `;
  }

  mainEl.innerHTML = `
    <!-- ミアキスプレビュー -->
    <div class="closet-studio" style="display:flex; flex-direction:column; align-items:center; margin: 8px 0 16px 0;"><span class="eyebrow">今日のコーデをつくろう</span>
      <div style="margin-bottom:8px;">
        ${previewHtml}
      </div>
      <div class="user-title-badge">
        👑 ${currentTitleName}
      </div>
    </div>

    <!-- かけら残高とお知らせ -->
    <div class="card shard-bar">
      <div>
        <div class="shard-bar-label">かけら・ダブりで たまる</div>
        <div class="shard-bar-num">💎 ${state.shards}</div>
      </div>
      <button class="btn-primary" id="btn-open-exchange">交換所</button>
    </div>

    <!-- タブ一覧 -->
    <div class="closet-tabs">
      ${tabsHtml}
    </div>

    ${unequipBtnHtml}

    <!-- アイテムグリッド -->
    <div class="closet-items-grid">
      ${itemsGridHtml}
    </div>

    ${unownedSummaryHtml}

  `;

  // タブイベント
  mainEl.querySelectorAll('.closet-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.closetActiveTab = btn.dataset.slot;
      renderClosetBody(mainEl, state, callbacks);
      mainEl.querySelector('.closet-tab-btn.active')?.focus({ preventScroll: true });
    });
  });

  // アイテム装備/解除タップイベント
  mainEl.querySelectorAll('.closet-item-card').forEach(card => {
    card.addEventListener('click', async () => {
      if (state.closetSaving) return;
      state.closetSaving = true;
      card.disabled = true;
      const itemId = card.dataset.itemId;
      const slot = state.closetActiveTab;
      const isAlreadyEquipped = state.myLooks[slot] === itemId;

      try {
        if (isAlreadyEquipped) {
          // すでに装備中なら外す
          await equipItem(slot, null);
          state.myLooks[slot] = null;
        } else {
          // 装備
          await equipItem(slot, itemId);
          state.myLooks[slot] = itemId;
        }
        playSfx('correct');
        if (mainEl.isConnected) {
          renderClosetBody(mainEl, state, callbacks);
          mainEl.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`)?.focus({ preventScroll: true });
        }
      } catch (err) {
        alert(err.message);
        card.disabled = false;
      } finally {
        state.closetSaving = false;
      }
    });
  });

  // 外すボタン
  document.getElementById('btn-unequip-current')?.addEventListener('click', async () => {
    const slot = state.closetActiveTab;
    try {
      await equipItem(slot, null);
      state.myLooks[slot] = null;
      playSfx('correct');
      renderClosetBody(mainEl, state, callbacks);
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-unequip-form')?.addEventListener('click', async () => {
    try {
      await equipItem('form', null);
      state.myLooks.form = null;
      playSfx('correct');
      renderClosetBody(mainEl, state, callbacks);
    } catch (err) {
      alert(err.message);
    }
  });

  // かけら交換所ボタン
  document.getElementById('btn-open-exchange')?.addEventListener('click', () => {
    renderExchangeView(mainEl, state, callbacks);
  });

  document.getElementById('btn-to-gacha')?.addEventListener('click', () => {
    if (callbacks.onGoGacha) callbacks.onGoGacha();
    else window.location.hash = '#/gacha';
  });

  document.getElementById('btn-closet-home')?.addEventListener('click', () => {
    if (callbacks.onGoHome) callbacks.onGoHome();
    else window.location.hash = '#/home';
  });
}

/**
 * かけら交換所画面
 * 交換できるのはガチャの品の SR まで（UR・SECRET・すがた・称号の条件達成品は出ない）。
 * スロットごとのタブで分け、着せ替えと同じ大きさの絵で見せる（長い1列にしない・絵と名前を重ねない）
 */
function renderExchangeView(mainEl, state, callbacks) {
  const myOwnedIds = new Set(state.myItems.map(it => it.item_id));
  const pool = state.allItems.filter(canExchange);
  const slots = SLOTS.filter(sl => pool.some(it => it.slot === sl.id));
  if (!slots.some(sl => sl.id === state.exchangeTab)) state.exchangeTab = slots[0]?.id;
  const tab = state.exchangeTab;
  const costs = [1, 2, 3].filter(r => r <= EXCHANGE_MAX_RARITY).map(r => `<span>${rarityInfo(r).code} 💎${itemExchangeCost(r)}</span>`).join('');

  const cards = pool.filter(it => it.slot === tab)
    .sort((a, b) => Number(myOwnedIds.has(a.id)) - Number(myOwnedIds.has(b.id)) || a.rarity - b.rarity)
    .map(item => {
      const cost = itemExchangeCost(item.rarity);
      const owned = myOwnedIds.has(item.id);
      const rInfo = rarityInfo(item.rarity);
      const visual = item.slot === 'title' ? '<span class="exchange-crown">👑</span>' : renderMiacis({ [item.slot]: item }, 72);
      return `
        <div class="closet-item-card exchange-card${owned ? ' owned' : ''}" style="border-color:${rInfo.color};">
          <div class="exchange-art">${visual}</div>
          <div class="exchange-name">${escapeHtml(item.name)}</div>
          <div class="exchange-rarity" style="color:${rInfo.color};">${rInfo.code}</div>
          ${owned
            ? '<span class="exchange-owned">持っている</span>'
            : `<button class="btn-primary btn-exchange-act" data-item-id="${item.id}" data-cost="${cost}" ${state.shards < cost ? 'disabled' : ''}>💎 ${cost}</button>`}
        </div>
      `;
    }).join('');

  mainEl.innerHTML = `
    <div class="exchange-head">
      <div>
        <h2>交換所</h2>
        <div class="exchange-balance">💎 <strong>${state.shards}</strong></div>
      </div>
      <button class="btn-sub" id="btn-close-exchange">閉じる</button>
    </div>
    <div class="exchange-costs">${costs}<span class="muted">UR・SECRET は ガチャだけ</span></div>
    <div class="closet-tabs">
      ${slots.map(sl => `<button class="closet-tab-btn ${sl.id === tab ? 'active' : ''}" data-ex-slot="${sl.id}">${sl.label}</button>`).join('')}
    </div>
    <div class="closet-items-grid">${cards}</div>
  `;

  document.getElementById('btn-close-exchange').addEventListener('click', () => {
    renderClosetBody(mainEl, state, callbacks);
  });
  mainEl.querySelectorAll('[data-ex-slot]').forEach(btn => btn.addEventListener('click', () => {
    state.exchangeTab = btn.dataset.exSlot;
    renderExchangeView(mainEl, state, callbacks);
    mainEl.querySelector('[data-ex-slot].active')?.focus({ preventScroll: true });
  }));

  mainEl.querySelectorAll('.btn-exchange-act').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.itemId;
      const cost = parseInt(btn.dataset.cost, 10);
      btn.disabled = true;
      btn.textContent = '…';

      try {
        const res = await exchangeItem(itemId);
        state.shards = res.shards_balance;
        const existing = state.myItems.find(it => it.item_id === itemId);
        if (existing) {
          existing.count = res.count;
        } else {
          state.myItems.push({ item_id: itemId, count: res.count });
        }
        playSfx('correct');
        renderExchangeView(mainEl, state, callbacks);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = `💎 ${cost}`;
      }
    });
  });
}
