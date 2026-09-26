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
  rarityInfo
} from './logic.js';

import { playSfx } from './game.js';
import { renderMiacis } from './look.js';

const SLOTS = [
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
      <button class="btn-secondary" id="btn-closet-err-back" style="margin-top:16px;">ホームへ戻る</button>
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
    title: itemMap[state.myLooks.title] || null
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

  let itemsGridHtml = '';

  // 現在装備中の解除ボタン（装備中アイテムがある場合）
  let unequipBtnHtml = '';
  if (currentEquippedId) {
    unequipBtnHtml = `
      <div style="margin-bottom:12px;">
        <button class="btn-secondary" id="btn-unequip-current" style="min-height:44px; font-size:14px;">
          ✕ ${SLOTS.find(s => s.id === state.closetActiveTab)?.label || 'パーツ'} を外す
        </button>
      </div>
    `;
  }

  if (slotOwnedItems.length === 0) {
    itemsGridHtml = `
      <div class="card" style="grid-column: 1 / -1; text-align:center; padding:24px 12px; color:var(--text-muted);">
        まだこのスロットのアイテムを持っていません。<br>ガチャを引くか、かけらで交換しよう！
      </div>
    `;
  } else {
    itemsGridHtml = slotOwnedItems.map(item => {
      const isEquipped = item.id === currentEquippedId;
      const rInfo = rarityInfo(item.rarity);

      let visual = '✨';
      if (item.display?.emoji) {
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
        <button type="button" aria-pressed="${isEquipped}" class="closet-item-card ${isEquipped ? 'equipped' : ''}" data-item-id="${item.id}" style="border-color:${isEquipped ? 'var(--primary)' : rInfo.color};">
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
        🔒 未獲得のアイテム: あと <strong>${slotUnownedCount}</strong> 種類
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
    <div class="card" style="padding:12px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-size:12px; color:var(--text-muted);">重複アイテムで集まる</div>
        <div style="font-size:16px; font-weight:800; color:var(--link);">💎 かけら: ${state.shards} 個</div>
      </div>
      <button class="btn-primary" id="btn-open-exchange" style="min-height:44px; padding:6px 14px; font-size:14px;">
        かけら交換所
      </button>
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

    <div style="display:flex; gap:10px; margin-top:24px;">
      <button class="btn-sub" id="btn-to-gacha">木の実ガチャへ</button>
      <button class="btn-sub" id="btn-closet-home">ホームへ戻る</button>
    </div>
  `;

  // タブイベント
  mainEl.querySelectorAll('.closet-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.closetActiveTab = btn.dataset.slot;
      renderClosetBody(mainEl, state, callbacks);
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
 */
function renderExchangeView(mainEl, state, callbacks) {
  const myOwnedIds = new Set(state.myItems.map(it => it.item_id));

  const itemsHtml = state.allItems.map(item => {
    const cost = itemExchangeCost(item.rarity);
    const canAfford = state.shards >= cost;
    const isOwned = myOwnedIds.has(item.id);
    const rInfo = rarityInfo(item.rarity);

    let visual = '✨';
    if (item.display?.emoji) {
      visual = renderMiacis({ [item.slot]: item }, 72);
    } else if (item.slot === 'background') {
      visual = `<div style="width:36px; height:36px; border-radius:50%; background:${item.display?.css || '#1e6b3c'};"></div>`;
    } else if (item.slot === 'aura') {
      const c = item.display?.color || '#ffffff';
      visual = `<div style="width:30px; height:30px; border-radius:50%; background:#111; border:2px solid ${c}; box-shadow:0 0 6px ${c};"></div>`;
    } else if (item.slot === 'title') {
      visual = '👑';
    }

    return `
      <div class="card" style="display:flex; align-items:center; justify-content:space-between; padding:12px; margin-bottom:10px; border-left:4px solid ${rInfo.color};">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="font-size:32px; width:44px; text-align:center;">${visual}</div>
          <div>
            <div style="font-weight:700; font-size:15px;">${escapeHtml(item.name)}</div>
            <div style="font-size:12px; color:${rInfo.color}; font-weight:700;">
              ${rInfo.label} (${SLOTS.find(s => s.id === item.slot)?.label || item.slot})
              ${isOwned ? '・所持済み' : ''}
            </div>
          </div>
        </div>
        <div>
          <button class="btn-primary btn-exchange-act"
                  data-item-id="${item.id}"
                  data-cost="${cost}"
                  ${!canAfford ? 'disabled' : ''}
                  style="min-height:44px; padding:6px 14px; font-size:14px;">
            💎 ${cost}
          </button>
        </div>
      </div>
    `;
  }).join('');

  mainEl.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <div>
        <h2 style="font-size:20px; font-weight:800;">かけら交換所</h2>
        <div style="font-size:13px; color:var(--link);">💎 残高: <strong>${state.shards}</strong> 個</div>
      </div>
      <button class="btn-sub" id="btn-close-exchange" style="min-height:38px; padding:4px 12px; font-size:13px;">✕ 閉じる</button>
    </div>

    <div style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">
      好きなアイテムを選んでかけらと交換できます (N: 10 / R: 30 / SR: 100 / UR: 300)
    </div>

    <div class="exchange-list" style="margin-bottom:20px;">
      ${itemsHtml}
    </div>
  `;

  document.getElementById('btn-close-exchange').addEventListener('click', () => {
    renderClosetBody(mainEl, state, callbacks);
  });

  mainEl.querySelectorAll('.btn-exchange-act').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.itemId;
      const cost = parseInt(btn.dataset.cost, 10);
      btn.disabled = true;
      btn.textContent = '交換中...';

      try {
        const res = await exchangeItem(itemId);
        state.shards = res.shards_balance;
        // 所持品更新
        const existing = state.myItems.find(it => it.item_id === itemId);
        if (existing) {
          existing.count = res.count;
        } else {
          state.myItems.push({ item_id: itemId, count: res.count });
        }
        playSfx('correct');
        alert('アイテムを交換しました！');
        renderClosetBody(mainEl, state, callbacks);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = `💎 ${cost}`;
      }
    });
  });
}
