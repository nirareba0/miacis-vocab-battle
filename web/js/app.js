/**
 * app.js - 画面遷移・状態管理・UIイベントハンドリング
 */
import {
  isConfigured,
  signUpPlayer,
  inviteRequired,
  signInPlayer,
  signOutPlayer,
  getSession,
  getMyPlayer,
  isStaffUser,
  touchToday,
  getMySummary,
  getMyProgress,
  startMatch,
  submitMatch,
  getWordsByIds,
  getRankingLearn,
  getRankingCommit,
  getApprovedContents,
  openContent,
  answerContentQuiz,
  submitWriting,
  proposeContent,
  getMyContentOpens,
  getMyQuizAnswers,
  getMyWritings,
  getMyWeeklyResults,
  getUnapprovedContents,
  approveContent,
  getRecentWritings,
  stampWriting,
  claimMatchNuts,
  claimDailyNuts,
  getMyNuts,
  getItems,
  getMyItems,
  getMyLooks,
  equipItem,
  getPublicLooks,
  getMyWords,
  getMyTickets,
  getGachaRates,
  staffUpsertPrize,
  staffListTickets,
  staffRedeemTicket,
  getStaffRewardOverview,
  getWeeklyRewardRules,
  getRankingStreak,
  getRankingKnock,
  getMyRunBests,
  getAppFlags
} from './api.js';

import {
  extractYouTubeId,
  validateWriting,
  isMyRow,
  formatRank,
  gradeToLabel,
  tierToLabel,
  escapeHtml,
  calcStageProgress,
  rarityInfo,
  checkComboMilestone,
  getStageName,
  normalizeInviteCode
} from './logic.js';

import {
  playSfx,
  triggerConfetti,
  isMuted,
  toggleMute
} from './game.js';

import { renderMiacis } from './look.js';
import { updateNavigation, icon } from './ui.js';
import { renderGachaView } from './gacha.js';
import { renderClosetView } from './closet.js';
import { renderChallengeView, stopChallenge } from './challenge.js';

// グローバル状態
const state = {
  session: null,
  player: null,
  isStaff: false,
  progress: null,
  nuts: { balance: 0, today_earned: 0, daily_cap: 200, remaining_cap: 200 },
  shards: 0,
  myLooks: {},
  allItems: [],
  myItems: [],
  publicLooksMap: {},
  closetActiveTab: 'hat',
  staffTab: 'overview',
  currentHash: window.location.hash || '#/home',
  battle: {
    matchId: null,
    opponent: null,
    questions: [],
    wordMap: {},
    answers: [],
    currentIndex: 0,
    startTime: 0,
    timerId: null,
    timerIntervalId: null,
    combo: 0,
    prevProgress: null,
    resultData: null
  },
  flags: { rank_mode_enabled: false }, // 段（ランク）の表示。利用者が集まったら解禁
  rankingTab: 'streak', // 'learn' | 'commit' | 'streak' | 'knock'
  streakScope: 'week', // 'week' | 'all'
  zukanTab: 1 // band 1..5
};

// DOM 要素
const appEl = document.getElementById('app-container');

/**
 * 初期化
 */
async function init() {
  if (!isConfigured()) {
    renderPreparation();
    return;
  }

  getAppFlags().then(f => { state.flags = { ...state.flags, ...f }; }).catch(() => {});

  try {
    state.session = await getSession();
    if (state.session) {
      state.player = await getMyPlayer();
      state.isStaff = await isStaffUser();
    }
  } catch (err) {
    console.error('初期化エラー:', err);
  }

  window.addEventListener('hashchange', () => {
    state.currentHash = window.location.hash || '#/home';
    render();
  });

  render();
}

/**
 * ルーター / メイン描画
 */
async function render() {
  cleanBattleTimers();
  stopChallenge();
  const signedIn = Boolean(state.session && state.player);
  const route = signedIn ? (state.currentHash || '#/home') : '#/auth';
  document.body.dataset.screen = route.slice(2);
  updateNavigation(route, signedIn);
  window.scrollTo(0, 0);
  if (!isConfigured()) {
    renderPreparation();
    return;
  }

  if (!state.session || !state.player) {
    renderAuth();
    return;
  }

  const hash = state.currentHash;

  if (hash === '#/gacha') {
    renderGacha();
  } else if (hash === '#/closet') {
    renderCloset();
  } else if (hash === '#/battle') {
    renderBattle();
  } else if (hash === '#/streak' || hash === '#/knock') {
    renderChallenge(hash.slice(2));
  } else if (hash === '#/content') {
    renderContent();
  } else if (hash === '#/ranking') {
    renderRanking();
  } else if (hash === '#/zukan') {
    renderZukan();
  } else if (hash === '#/me') {
    renderMe();
  } else if (hash === '#/staff') {
    renderStaff();
  } else {
    // 既定は #/home
    renderHome();
  }
}

/**
 * 準備中画面
 */
function renderPreparation() {
  appEl.innerHTML = `
    <div class="prep-container">
      <div class="prep-icon">🚧</div>
      <h1 class="prep-title">準備中</h1>
      <p class="prep-desc">現在アプリの初期設定を行っています。<br>しばらくお待ちください。</p>
    </div>
  `;
}

/**
 * 認証画面（登録・ログイン）
 */
function renderAuth(mode = 'register') {
  appEl.innerHTML = `
    <div class="auth-hero"><span class="eyebrow">ミアキス英単語サバイバル</span><img src="assets/miacis-avatar.png" alt="ミアキスくん" width="160" height="160"><h1>Miacisで<br>いちばん続くのは、誰だ。</h1><p>1問6秒。間違えたら終わり。</p></div>

    <div class="tab-bar">
      <button id="tab-register" class="tab-btn ${mode === 'register' ? 'active' : ''}">新しく登録</button>
      <button id="tab-login" class="tab-btn ${mode === 'login' ? 'active' : ''}">ログイン</button>
    </div>

    <div id="auth-alert"></div>

    <form id="auth-form">
      <div class="form-group">
        <label class="form-label" for="auth-nick">ニックネーム</label>
        <input class="form-input" id="auth-nick" type="text" maxlength="10" placeholder="1〜10文字" required autocomplete="username">
      </div>

      <div class="form-group">
        <label class="form-label" for="auth-pass">あいことば</label>
        <div class="password-wrapper">
          <input class="form-input" id="auth-pass" type="password" placeholder="6文字以上" required autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}">
          <button type="button" class="password-toggle" id="pass-toggle">表示</button>
        </div>
      </div>

      ${
        mode === 'register'
          ? `
        <div class="form-group">
          <label class="form-label">学年</label>
          <div class="grade-grid" role="group" aria-label="学年（必須）">
            <button type="button" class="grade-btn" aria-pressed="false" data-grade="1">中1</button>
            <button type="button" class="grade-btn" aria-pressed="false" data-grade="2">中2</button>
            <button type="button" class="grade-btn" aria-pressed="false" data-grade="3">中3</button>
            <button type="button" class="grade-btn" aria-pressed="false" data-grade="4">高1</button>
            <button type="button" class="grade-btn" aria-pressed="false" data-grade="5">高2</button>
            <button type="button" class="grade-btn" aria-pressed="false" data-grade="6">高3</button>
          </div>
          <input type="hidden" id="auth-grade" value="">
        </div>

        <div class="form-group" id="invite-group" hidden>
          <label class="form-label" for="auth-invite">ミアキスの合言葉（館内に貼ってあるよ）</label>
          <input class="form-input" id="auth-invite" type="text" placeholder="館内ポスターを見てね" autocomplete="off">
        </div>

        <div class="notice-line" style="text-align: left; margin-bottom: 20px;">
          本名・学校名は入れないでね。あいことばを忘れたらミアキスのスタッフに言ってね
        </div>
      `
          : ''
      }

      <button type="submit" class="btn-primary" id="btn-auth-submit" style="margin-top: 10px;">
        ${mode === 'register' ? 'はじめる' : 'ログイン'}
      </button>
    </form>

    <footer class="app-footer">
      <p><a href="credits.html">単語データの出典（クレジット）</a></p>
    </footer>
  `;

  // イベント設定
  document.getElementById('tab-register').addEventListener('click', () => renderAuth('register'));
  document.getElementById('tab-login').addEventListener('click', () => renderAuth('login'));

  const passInput = document.getElementById('auth-pass');
  const passToggle = document.getElementById('pass-toggle');
  passToggle.addEventListener('click', () => {
    if (passInput.type === 'password') {
      passInput.type = 'text';
      passToggle.textContent = '隠す';
    } else {
      passInput.type = 'password';
      passToggle.textContent = '表示';
    }
  });

  if (mode === 'register') {
    const gradeBtns = document.querySelectorAll('.grade-btn');
    const gradeInput = document.getElementById('auth-grade');
    gradeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        gradeBtns.forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('selected');
        gradeInput.value = btn.dataset.grade;
      });
    });
  }

  const form = document.getElementById('auth-form');

  // 合言葉が設定されているときだけ欄を出す（未設定なら誰でも登録できる）
  if (mode === 'register') {
    inviteRequired()
      .then(req => {
        const g = document.getElementById('invite-group');
        if (g && req) g.hidden = false;
      })
      .catch(() => {});
  }
  const alertEl = document.getElementById('auth-alert');
  const submitBtn = document.getElementById('btn-auth-submit');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    alertEl.innerHTML = '';
    const nick = document.getElementById('auth-nick').value.trim();
    const pass = document.getElementById('auth-pass').value;

    if (!nick) {
      alertEl.innerHTML = '<div class="alert alert-error">ニックネームを入力してください</div>';
      return;
    }
    if (!pass || pass.length < 6) {
      alertEl.innerHTML = '<div class="alert alert-error">あいことばは6文字以上で入力してください</div>';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '処理中...';

    try {
      if (mode === 'register') {
        const gradeVal = parseInt(document.getElementById('auth-grade').value, 10);
        if (!gradeVal || gradeVal < 1 || gradeVal > 6) {
          alertEl.innerHTML = '<div class="alert alert-error">学年を選択してください</div>';
          submitBtn.disabled = false;
          submitBtn.textContent = 'はじめる';
          return;
        }
        const inviteGroup = document.getElementById('invite-group');
        const inviteVal = document.getElementById('auth-invite').value.trim();
        if (inviteGroup && !inviteGroup.hidden && !inviteVal) {
          alertEl.innerHTML = '<div class="alert alert-error">ミアキスの合言葉を入力してください</div>';
          submitBtn.disabled = false;
          submitBtn.textContent = 'はじめる';
          return;
        }

        await signUpPlayer(nick, pass, gradeVal, inviteVal);

        state.session = await getSession();
        state.player = await getMyPlayer();
        state.isStaff = await isStaffUser();

        // 登録完了後に「スクショしてね」画面を表示
        showScreenshotModal(nick, pass, gradeVal);
      } else {
        await signInPlayer(nick, pass);
        state.session = await getSession();
        state.player = await getMyPlayer();
        state.isStaff = await isStaffUser();
        window.location.hash = '#/home';
        render();
      }
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'register' ? 'はじめる' : 'ログイン';
    }
  });
}

/**
 * 登録直後の「スクショしてね」モーダル
 */
function showScreenshotModal(nick, pass, gradeVal) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'screenshot-modal';
  modal.innerHTML = `
    <div class="screenshot-modal-card">
      <button class="modal-close-btn" id="btn-close-screenshot" aria-label="閉じる">×</button>
      <img src="assets/miacis-logo.png" alt="Miacis Logo" style="width: 64px; height: 64px; object-fit: contain; margin-bottom: 8px;">
      <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 6px;">登録完了！</h2>
      <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.5;">
        📸 この画面をスクショしてね。<br>あいことばを忘れるとログインできなくなるよ
      </div>
      <div class="screenshot-info-box">
        <div class="screenshot-row">
          <div class="screenshot-label">ニックネーム</div>
          <div class="screenshot-val">${escapeHtml(nick)}</div>
        </div>
        <div class="screenshot-row">
          <div class="screenshot-label">あいことば</div>
          <div class="screenshot-val" style="color: var(--miacis-yellow);">${escapeHtml(pass)}</div>
        </div>
        <div class="screenshot-row">
          <div class="screenshot-label">学年</div>
          <div class="screenshot-val">${gradeToLabel(gradeVal)}</div>
        </div>
      </div>
      <button class="btn-primary" id="btn-screenshot-ok" style="font-size: 18px;">スクショした！</button>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    window.location.hash = '#/home';
    render();
  };

  document.getElementById('btn-screenshot-ok').addEventListener('click', closeModal);
  document.getElementById('btn-close-screenshot').addEventListener('click', closeModal);
}

/**
 * ガチャ画面 (#/gacha)
 */
async function renderGacha() {
  await renderGachaView(appEl, state, {
    onUpdateNuts: (newBalance) => {
      state.nuts.balance = newBalance;
    },
    onGoHome: () => {
      window.location.hash = '#/home';
    },
    onGoCloset: () => {
      window.location.hash = '#/closet';
    }
  });
}

/**
 * 着せ替え画面 (#/closet)
 */
async function renderCloset() {
  await renderClosetView(appEl, state, {
    onGoHome: () => {
      window.location.hash = '#/home';
    },
    onGoGacha: () => {
      window.location.hash = '#/gacha';
    }
  });
}

/**
 * ホーム画面 (#/home)
 */
async function renderHome() {
  const muteIcon = isMuted() ? '🔇' : '🔊';

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">
        <span class="brand-mark" aria-hidden="true">✦</span><span class="brand-name">ミアキス</span>
      </h1>
      <div class="header-user">
        <button class="btn-mute" id="btn-mute-toggle" aria-label="効果音ミュート切り替え">${muteIcon}</button>
        <span id="header-user-nick">${escapeHtml(state.player.nickname)} さん</span>
        <button class="btn-logout" id="btn-logout">ログアウト</button>
      </div>
    </header>
    <div id="home-content"><div class="loading-state" role="status"><span class="loading-orbit"></span>相棒を呼んでいます…</div></div>
  `;

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    const nextMuted = toggleMute();
    document.getElementById('btn-mute-toggle').textContent = nextMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await signOutPlayer();
    state.session = null;
    state.player = null;
    state.isStaff = false;
    window.location.hash = '#/home';
    render();
  });

  try {
    // 1日1回のアクセス記録 & 木の実デイリーボーナス付与
    await touchToday();
    const dailyNutsRes = await claimDailyNuts().catch(() => ({ earned: 0 }));

    const [summary, progress, nutsData, myLooksData, allItems] = await Promise.all([
      getMySummary(),
      getMyProgress(),
      getMyNuts(),
      getMyLooks(),
      getItems()
    ]);
    state.progress = progress;
    state.nuts = nutsData;
    state.myLooks = myLooksData || {};
    state.allItems = allItems || [];

    const learnRankStr = summary.learn_rank_in_tier ? `${summary.learn_rank_in_tier}位` : '集計中';
    const commitRankStr = summary.commit_rank ? `${summary.commit_rank}位` : '集計中';

    let lastWeekDiff = '先週のデータなし';
    if (summary.last_week) {
      const lw = summary.last_week;
      lastWeekDiff = `先週: 段${lw.tier_before} → 段${lw.tier_after}（${lw.learn_points}点）`;
    }

    const homeContent = document.getElementById('home-content');
    if (!homeContent) return;

    // 着せ替えミアキスの構築
    const itemMap = Object.fromEntries(state.allItems.map(it => [it.id, it]));
    const myLook = {
      hat: itemMap[state.myLooks.hat] || null,
      face: itemMap[state.myLooks.face] || null,
      neck: itemMap[state.myLooks.neck] || null,
      background: itemMap[state.myLooks.background] || null,
      aura: itemMap[state.myLooks.aura] || null,
      title: itemMap[state.myLooks.title] || null
    };

    const miacisAvatarHtml = renderMiacis(myLook, 160);
    const titleName = myLook.title ? escapeHtml(myLook.title.name) : '';

    const stageProg = calcStageProgress(progress.total_points);
    let evolutionLabel = '';
    if (progress.stage < 7) {
      evolutionLabel = `<span>次の進化まで <strong>あと ${progress.points_to_next}</strong></span><span>${progress.total_points} / ${progress.next_threshold}</span>`;
    } else {
      evolutionLabel = `<span>最高段階</span><span>${progress.total_points}</span>`;
    }


    // デイリーボーナス案内
    let dailyToastHtml = '';
    if (dailyNutsRes.earned > 0) {
      const bonus = dailyNutsRes.streak_bonus || 0;
      const days = dailyNutsRes.streak_days || 0;
      const streakLine = bonus > 0
        ? `<div style="font-size:12px; font-weight:700; margin-top:2px;">${days}日連続 🌰 +${bonus}</div>`
        : days >= 1 && days < 3
          ? `<div style="font-size:12px; font-weight:500; margin-top:2px;">あと${3 - days}日連続で ボーナス↑</div>`
          : '';
      dailyToastHtml = `
        <div class="alert alert-success" style="margin-bottom:12px; font-weight:700; text-align:center;">
          🌰 +${dailyNutsRes.earned} 今日のログイン${streakLine}
        </div>
      `;
    }

    homeContent.innerHTML = `
      <div class="home-greeting"><div><p class="eyebrow">ベース</p><h2>${escapeHtml(state.player.nickname)}</h2></div><span class="level-pill${state.flags.rank_mode_enabled || state.player.account_type === 'staff' ? '' : ' locked'}">${state.player.account_type === 'staff' ? 'スタッフ' : state.flags.rank_mode_enabled ? tierToLabel(summary.tier) : '🔒 ランク 準備中'}</span></div>
      ${dailyToastHtml}
      <section class="companion-card" aria-label="相棒と進化">
        <div class="companion-copy"><span class="eyebrow">あなたの相棒</span><h3>${escapeHtml(progress.stage_name || 'ミアキス')}</h3>${progress.route ? `<p>${progress.route === 'grass' ? '草原ルート' : '木の上ルート'}</p>` : ''}${titleName ? `<span class="companion-title">${titleName}</span>` : ''}<span class="streak-pill">🔥 ${progress.streak_days} 日連続</span></div>
        <div class="companion-art">${miacisAvatarHtml}</div>
        <div class="companion-progress"><div class="evolution-label">${evolutionLabel}</div><div class="evolution-bar-bg" role="progressbar" aria-label="次の進化まで" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stageProg.percent}"><div class="evolution-bar-fill" style="width:${stageProg.percent}%"></div></div></div>
      </section>
      <div class="record-strip" id="record-strip" hidden></div>
      <button class="battle-launch streak" id="go-streak"><span class="launch-icon" aria-hidden="true">🔥</span><span><strong>連続チャレンジ</strong><small>間違えたら終わり。何問続く？</small></span><span class="launch-arrow" aria-hidden="true">↗</span></button>
      <div class="challenge-launch"><button id="go-battle"><span class="challenge-launch-mark" aria-hidden="true">${icon('battle')}</span><strong>対戦</strong><span>10問 vs だれかの記録</span></button><button id="go-knock"><span class="challenge-launch-mark" aria-hidden="true">💯</span><strong>100本ノック</strong><span>100問 ノンストップ</span></button></div>
      <div class="home-wallet"><div><span class="eyebrow">集めた木の実</span><strong>🌰 ${state.nuts.balance.toLocaleString()} <small>個</small></strong></div><div class="wallet-actions"><button id="go-gacha">ガチャ ${icon('arrow')}</button><button id="go-closet">着せ替え ${icon('arrow')}</button></div><p>今日集めた木の実 ${state.nuts.today_earned} / ${state.nuts.daily_cap} 個</p></div>
      <div class="section-heading"><h2>今週</h2><span>月曜リセット</span></div>
      <div class="weekly-score"><div><span>学習ポイント</span><strong>${summary.learn_points}<small>点</small></strong><p>${state.flags.rank_mode_enabled ? `段内 ${learnRankStr}` : 'ランク 準備中'}</p></div><div><span>コミットポイント</span><strong>${summary.commit_points}<small>点</small></strong><p>全体 ${commitRankStr}</p></div></div>
      <p class="week-history">${lastWeekDiff}</p>
      <div class="home-explore"><button id="go-content">${icon('play')}<strong>今週の英語</strong><span>動画とクイズ</span></button><button id="go-ranking">${icon('ranking')}<strong>ランキング</strong><span>今週の順位</span></button><button id="go-zukan">${icon('book')}<strong>単語図鑑</strong><span>覚えた単語</span></button><button id="go-me">${icon('record')}<strong>自分の記録</strong><span>記録と引換券</span></button></div>
      ${state.isStaff ? '<button class="btn-sub" id="go-staff">スタッフ画面</button>' : ''}

      <footer class="app-footer">
        <p><a href="credits.html">単語データの出典（クレジット）</a></p>
      </footer>
    `;

    document.getElementById('go-gacha').addEventListener('click', () => {
      window.location.hash = '#/gacha';
    });
    document.getElementById('go-closet').addEventListener('click', () => {
      window.location.hash = '#/closet';
    });
    document.getElementById('go-battle').addEventListener('click', () => {
      window.location.hash = '#/battle';
    });
    // 今週の連続記録: 自分と1位（開くたびに「抜かれた/抜ける」が見える）
    Promise.all([getMyRunBests().catch(() => null), getRankingStreak('week').catch(() => [])]).then(([bests, rows]) => {
      const strip = document.getElementById('record-strip');
      if (!strip) return;
      const mine = bests?.streak_week?.correct ?? null;
      const top = rows?.[0] || null;
      if (mine === null && !top) return;
      const myRow = rows.find(r => isMyRow(r, state.player.nickname));
      let msg;
      if (top && isMyRow(top, state.player.nickname)) {
        msg = rows[1] ? `1位。${escapeHtml(rows[1].nickname)} が ${rows[1].best_streak}連続で追ってくる` : '1位。追われる側だ';
      } else if (top && mine !== null) {
        msg = `1位 ${escapeHtml(top.nickname)} まで あと${top.best_streak + 1 - mine}問`;
      } else if (top) {
        msg = `1位 ${escapeHtml(top.nickname)} ${top.best_streak}連続。抜けるか？`;
      } else {
        msg = 'まだ誰も出していない。1位をとれる';
      }
      strip.innerHTML = `<span class="eyebrow">今週の連続記録</span><strong>${mine === null ? '—' : `${mine} 連続`}${myRow ? `<small>${myRow.rank}位</small>` : ''}</strong><p>${msg}</p>`;
      strip.hidden = false;
    });

    document.getElementById('go-streak').addEventListener('click', () => {
      window.location.hash = '#/streak';
    });
    document.getElementById('go-knock').addEventListener('click', () => {
      window.location.hash = '#/knock';
    });
    document.getElementById('go-content').addEventListener('click', () => {
      window.location.hash = '#/content';
    });
    document.getElementById('go-ranking').addEventListener('click', () => {
      window.location.hash = '#/ranking';
    });
    document.getElementById('go-zukan').addEventListener('click', () => {
      window.location.hash = '#/zukan';
    });
    document.getElementById('go-me').addEventListener('click', () => {
      window.location.hash = '#/me';
    });
    if (state.isStaff) {
      document.getElementById('go-staff').addEventListener('click', () => {
        window.location.hash = '#/staff';
      });
    }
  } catch (err) {
    const homeContent = document.getElementById('home-content');
    if (homeContent) {
      homeContent.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }
}

/**
 * 連続チャレンジ (#/streak) ・ 100本ノック (#/knock)
 */
function renderChallenge(mode) {
  renderChallengeView(appEl, mode, {
    nickname: state.player.nickname,
    onGoHome: () => {
      window.location.hash = '#/home';
    },
    onGoRanking: (m) => {
      state.rankingTab = m;
      window.location.hash = '#/ranking';
    },
    onNuts: () => {
      getMyNuts().then(n => { state.nuts = n; }).catch(() => {});
    }
  });
}

/**
 * 対戦画面 (#/battle)
 */
async function renderBattle() {
  cleanBattleTimers();
  const muteIcon = isMuted() ? '🔇' : '🔊';

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">英単語バトル</h1>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn-mute" id="btn-mute-toggle" aria-label="効果音ミュート切り替え">${muteIcon}</button>
        <button class="btn-logout" id="btn-back-home">戻る</button>
      </div>
    </header>
    <div id="battle-area">マッチング中...</div>
  `;

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    const nextMuted = toggleMute();
    document.getElementById('btn-mute-toggle').textContent = nextMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-back-home').addEventListener('click', () => {
    cleanBattleTimers();
    window.location.hash = '#/home';
  });

  try {
    const matchData = await startMatch();
    if (state.currentHash !== '#/battle') return;
    state.battle.matchId = matchData.match_id;
    state.battle.opponent = matchData.opponent;
    state.battle.questions = matchData.questions;
    state.battle.answers = [];
    state.battle.currentIndex = 0;
    state.battle.combo = 0;
    state.battle.wordMap = {};

    // 10問の単語詳細を取得（回答時の即時正誤フィードバック用）
    const wordIds = matchData.questions.map(q => q.word_id).filter(Boolean);
    try {
      const words = await getWordsByIds(wordIds);
      state.battle.wordMap = Object.fromEntries(words.map(w => [w.id, w]));
    } catch {
      state.battle.wordMap = {};
    }

    // 進化検知用に対戦開始時の進捗を取得
    try {
      state.battle.prevProgress = await getMyProgress();
    } catch {
      state.battle.prevProgress = null;
    }

    const oppName = matchData.opponent.is_practice
      ? '練習相手と勝負'
      : `${matchData.opponent.nickname} さんの記録と勝負`;

    // 相手の着せ替えを取得（練習相手は素のミアキス）
    let oppLook = null;
    if (!matchData.opponent.is_practice) {
      try {
        const publicLooks = await getPublicLooks();
        const oppRow = publicLooks.find(p => p.nickname === matchData.opponent.nickname);
        if (oppRow) {
          oppLook = oppRow.looks;
        }
      } catch {}
    }
    const oppMiacisHtml = renderMiacis(oppLook, 110);

    const area = document.getElementById('battle-area');
    if (!area || state.currentHash !== '#/battle') return;
    area.innerHTML = `
      <div class="card battle-ready" style="text-align: center; padding: 28px 16px;"><span class="eyebrow">対戦</span>
        <div style="font-size: 22px; font-weight: 800; margin-bottom: 12px;">${escapeHtml(oppName)}</div>
        <div style="margin: 0 auto 16px auto; display:flex; justify-content:center;">
          ${oppMiacisHtml}
        </div>
        <div style="font-size: 15px; color: var(--text-muted); margin-bottom: 24px;">10問 ・ 1問6秒</div>
        <button class="btn-primary" id="btn-start-countdown" style="font-size: 20px;">スタート</button>
      </div>
    `;

    document.getElementById('btn-start-countdown').addEventListener('click', () => {
      startQuestion(0);
    });
  } catch (err) {
    const area = document.getElementById('battle-area');
    if (area) {
      area.innerHTML = `
        <div class="alert alert-error">${escapeHtml(err.message)}</div>
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
      `;
    }
  }
}

function cleanBattleTimers() {
  if (state.battle.timerId) {
    clearTimeout(state.battle.timerId);
    state.battle.timerId = null;
  }
  if (state.battle.timerIntervalId) {
    clearInterval(state.battle.timerIntervalId);
    state.battle.timerIntervalId = null;
  }
}

/**
 * 1問ごとの進行
 */
function startQuestion(qIndex) {
  cleanBattleTimers();

  if (qIndex >= 10) {
    finishMatch();
    return;
  }

  state.battle.currentIndex = qIndex;
  const q = state.battle.questions[qIndex];
  state.battle.startTime = performance.now();

  const area = document.getElementById('battle-area');
  if (!area) return;

  const choicesHtml = q.choices
    .map(
      (choice, idx) => `
    <button class="btn-choice" data-choice="${idx}"><span class="choice-number" aria-hidden="true">${idx + 1}</span><span>${escapeHtml(choice)}</span></button>
  `
    )
    .join('');

  const comboHtml = state.battle.combo >= 3
    ? `<div class="combo-container"><div class="combo-badge">🔥 ${state.battle.combo} COMBO!</div></div>`
    : `<div class="combo-container"></div>`;

  area.innerHTML = `
    <div class="battle-header">
      <span class="q-counter">第 ${qIndex + 1} / 10 問</span><span class="question-dots" aria-hidden="true">${Array.from({length:10}, (_, i) => `<i class="${i < qIndex ? 'done' : i === qIndex ? 'current' : ''}"></i>`).join('')}</span>
    </div>

    ${comboHtml}

    <div class="timer-bar-bg">
      <div id="timer-bar" class="timer-bar-fill"></div>
    </div>

    <div class="word-prompt">${escapeHtml(q.prompt)}</div>

    <div class="choices-list">
      ${choicesHtml}
    </div>
  `;

  const timerBar = document.getElementById('timer-bar');
  const duration = 6000;

  state.battle.timerIntervalId = setInterval(() => {
    const elapsed = performance.now() - state.battle.startTime;
    const remainingRatio = Math.max(0, (duration - elapsed) / duration);
    if (timerBar) {
      timerBar.style.width = `${remainingRatio * 100}%`;
      if (remainingRatio < 0.3) {
        timerBar.classList.add('danger');
      }
    }
  }, 50);

  // 6秒タイマー（時間切れ）
  state.battle.timerId = setTimeout(() => {
    cleanBattleTimers();
    handleQuestionAnswer(null, 6000, null);
  }, duration);

  const choiceBtns = area.querySelectorAll('.btn-choice');
  choiceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      cleanBattleTimers();
      const choiceIdx = parseInt(btn.dataset.choice, 10);
      const elapsedMs = Math.min(6000, Math.round(performance.now() - state.battle.startTime));
      handleQuestionAnswer(choiceIdx, elapsedMs, btn);
    });
  });
}

/**
 * 回答処理（即時フィードバック・効果音・コンボ判定・0.35秒待機）
 */
function handleQuestionAnswer(choiceIdx, elapsedMs, clickedBtn) {
  // すべてのボタンを即座に無効化（重複クリック防止）
  const area = document.getElementById('battle-area');
  if (area) {
    area.querySelectorAll('.btn-choice').forEach(b => {
      b.disabled = true;
    });
  }

  const q = state.battle.questions[state.battle.currentIndex];
  const w = state.battle.wordMap[q.word_id];
  let isCorrect = false;

  if (choiceIdx !== null && w && elapsedMs < 6000) {
    const correctText = q.dir === 'en2ja' ? w.ja : w.en;
    isCorrect = (q.choices[choiceIdx] === correctText);
  }

  if (isCorrect) {
    if (clickedBtn) clickedBtn.classList.add('choice-correct');
    playSfx('correct');
    state.battle.combo++;
    const milestone = checkComboMilestone(state.battle.combo);
    if (milestone.isMilestone) {
      playSfx('combo');
    }
  } else {
    if (clickedBtn) clickedBtn.classList.add('choice-wrong');
    playSfx('wrong');
    state.battle.combo = 0;
  }

  // 回答後 0.35 秒だけ見せてから次へ
  setTimeout(() => {
    state.battle.answers.push({ choice: choiceIdx, ms: elapsedMs });
    startQuestion(state.battle.currentIndex + 1);
  }, 350);
}

/**
 * 10問終了後の採点と結果表示
 */
async function finishMatch() {
  cleanBattleTimers();
  const area = document.getElementById('battle-area');
  if (area) {
    area.innerHTML = `
      <div class="card" style="text-align: center; padding: 40px 16px;">
        <div style="font-size: 20px; font-weight: 700;">採点中...</div>
      </div>
    `;
  }

  try {
    const result = await submitMatch(state.battle.matchId, state.battle.answers);
    state.battle.resultData = result;

    const isWin = result.result === 'win';
    if (isWin) {
      playSfx('win');
      triggerConfetti();
    } else {
      playSfx('lose');
    }

    const mySec = (result.total_ms / 1000).toFixed(1);
    const oppSec = (result.opponent.total_ms / 1000).toFixed(1);

    const questionsReview = result.questions.map((q, idx) => {
      const userAns = result.answers[idx];
      const correctIdx = q.answer_index;
      const isCorrect =
        userAns.choice !== null &&
        userAns.choice === correctIdx &&
        userAns.ms < 6000;
      const userText = userAns.choice !== null ? q.choices[userAns.choice] : '時間切れ';
      const correctText = q.choices[correctIdx];

      return `
        <div class="review-item ${isCorrect ? 'correct' : 'wrong'}">
          <div>
            <div style="font-weight: 700;">${escapeHtml(q.prompt)}</div>
            <div style="font-size: 13px; color: var(--text-muted);">
              正解: ${escapeHtml(correctText)} ${!isCorrect ? `(あなた: ${escapeHtml(userText)})` : ''}
            </div>
          </div>
          <div class="review-mark ${isCorrect ? 'correct' : 'wrong'}" aria-label="${isCorrect ? '正解' : '不正解'}">${isCorrect ? '○' : '×'}</div>
        </div>
      `;
    }).join('');

    // 木の実の獲得 (claim_match_nuts)
    let nutGainHtml = '';
    try {
      const nutRes = await claimMatchNuts(state.battle.matchId);
      playSfx('nutGet');
      state.nuts.balance = nutRes.balance;

      const cappedNotice = (nutRes.capped || nutRes.remaining_cap === 0)
        ? '<div style="font-size:13px; color:#F2C200; font-weight:700; margin-top:4px;">今日の上限 到達</div>'
        : `<div style="font-size:12px; color:var(--text-muted); margin-top:4px;">今日あと ${nutRes.remaining_cap} 🌰</div>`;

      nutGainHtml = `
        <div class="card" style="text-align: center; padding: 18px 16px; margin-top: 14px; border: 2px solid var(--primary); background: rgba(242, 194, 0, 0.1);">
          <div style="font-size: 13px; color: var(--text-muted);">木の実</div>
          <div style="font-size: 28px; font-weight: 900; color: var(--primary); margin: 4px 0;">🌰 +${nutRes.earned}</div>
          <div style="font-size: 14px;">現在の残高: <strong>${nutRes.balance} 🌰</strong></div>
          ${cappedNotice}
          <div style="margin-top: 12px;">
            <button class="btn-primary" id="btn-match-to-gacha" style="min-height: 52px; font-size: 17px; width: 100%;">
              ガチャへ
            </button>
          </div>
        </div>
      `;
    } catch (err) {
      console.error('claim_match_nuts error:', err);
    }

    if (!area) return;

    area.innerHTML = `
      <div class="result-banner ${isWin ? 'win' : 'lose'}">
        <div class="result-symbol" aria-hidden="true">${isWin ? '✦' : '✓'}</div><div class="result-text result-en">${isWin ? 'WIN' : 'LOSE'}</div>
        <div class="result-sub">あなた ${result.correct}問 ${mySec}秒</div>
        <div class="result-sub">${escapeHtml(result.opponent.nickname)} ${result.opponent.correct}問 ${oppSec}秒</div>
      </div>

      <div class="points-grid">
        <div class="point-box">
          <div class="point-label">学習ポイント</div>
          <div class="point-val">+${result.learn_points}</div>
        </div>
        <div class="point-box">
          <div class="point-label">コミットポイント</div>
          <div class="point-val">+${result.commit_points}</div>
        </div>
      </div>

      ${nutGainHtml}

      <div class="card-title" style="margin-top: 20px;">振り返り</div>
      <div class="review-list">
        ${questionsReview}
      </div>

      <button class="btn-secondary" id="btn-match-finish-home" style="margin-top: 14px;">ホーム</button>
    `;

    document.getElementById('btn-match-finish-home').addEventListener('click', async () => {
      await checkEvolutionAfterMatch();
      window.location.hash = '#/home';
    });

    document.getElementById('btn-match-to-gacha')?.addEventListener('click', async () => {
      await checkEvolutionAfterMatch();
      window.location.hash = '#/gacha';
    });
  } catch (err) {
    if (area) {
      area.innerHTML = `
        <div class="alert alert-error">${escapeHtml(err.message)}</div>
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
      `;
    }
  }
}

/**
 * カードパック開封モーダルとアニメーション演出
 */
async function handleOpenPackModal(matchId) {
  try {
    const card = await openPack(matchId);
    const rInfo = rarityInfo(card.rarity);

    // モーダル生成
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'pack-modal';

    modal.innerHTML = `
      <div class="pack-box-container">
        <div class="pack-anim-wrapper" id="pack-anim">
          <div class="pack-card-frame shake">
            <img src="assets/miacis-logo.png" alt="" style="width: 50px; height: 50px; object-fit: contain; margin-bottom: 8px;">
            <div style="font-size: 16px; font-weight: 800; color: #F2C200;">MIACIS PACK</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    playSfx('packShake');

    // 0.45秒後にカード公開
    setTimeout(() => {
      const animBox = document.getElementById('pack-anim');
      if (!animBox) return;

      playSfx('cardReveal', { rarity: card.rarity });
      if (card.rarity >= 3) {
        triggerConfetti();
      }

      animBox.innerHTML = `
        <div class="card-revealed-frame rarity-${card.rarity}">
          ${card.is_new ? '<span class="card-flag-badge">NEW!</span>' : `<span class="card-flag-badge" style="background:#3b82f6;">×${card.count}</span>`}
          <span class="card-rarity-tag" style="background: ${rInfo.badgeBg}; color: ${rInfo.color}; border: 1px solid ${rInfo.borderColor};">
            ${rInfo.label} (${rInfo.code})
          </span>
          <div class="card-word-en">${escapeHtml(card.en)}</div>
          <div class="card-word-ja">${escapeHtml(card.ja)}</div>
          <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">段${card.band}の単語</div>
          <button class="btn-primary" id="btn-pack-close" style="min-height: 48px; font-size: 16px;">OK</button>
        </div>
      `;

      document.getElementById('btn-pack-close').addEventListener('click', async () => {
        modal.remove();
        // パック開封ボタンを非表示化
        const packBtn = document.getElementById('btn-open-pack');
        if (packBtn && packBtn.parentElement) {
          packBtn.parentElement.innerHTML = `<div style="font-size: 15px; color: var(--text-muted);">本日のカードを獲得しました（残り: ${card.remaining}回）</div>`;
        }
        await checkEvolutionAfterMatch();
      });
    }, 450);

  } catch (err) {
    alert(err.message);
    const packBtn = document.getElementById('btn-open-pack');
    if (packBtn) {
      packBtn.disabled = false;
      packBtn.textContent = 'カードパックを開ける';
    }
  }
}

/**
 * 対戦終了後の進化チェック
 */
async function checkEvolutionAfterMatch() {
  if (!state.battle.prevProgress) return;
  try {
    const newProg = await getMyProgress();
    if (newProg.stage > state.battle.prevProgress.stage) {
      await showEvolutionModal(state.battle.prevProgress, newProg);
    }
  } catch {}
}

/**
 * 進化全画面演出モーダル
 */
function showEvolutionModal(prevProg, newProg) {
  return new Promise(resolve => {
    playSfx('evolution');
    triggerConfetti(3500);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'evolution-modal';

    const routeClass = newProg.route || 'none';
    let routeNotice = '';
    if (!prevProg.route && newProg.route) {
      routeNotice = newProg.route === 'grass'
        ? '<div style="font-size: 16px; color: #bef264; font-weight: 800; margin: 10px 0;">🌾 草原へ！ イヌ科への道を歩み始めた！</div>'
        : '<div style="font-size: 16px; color: #6ee7b7; font-weight: 800; margin: 10px 0;">🌳 木の上へ！ ネコ科への道を歩み始めた！</div>';
    }

    modal.innerHTML = `
      <div class="screenshot-modal-card" style="border-color: #F2C200; box-shadow: 0 0 50px rgba(242, 194, 0, 0.4);">
        <div style="font-size: 32px; font-weight: 900; color: #F2C200; margin-bottom: 8px;">🎉 進化！！</div>
        <div style="font-size: 18px; font-weight: 800; margin-bottom: 12px;">
          ${escapeHtml(prevProg.stage_name)} → <span style="color: var(--miacis-pink);">${escapeHtml(newProg.stage_name)}</span>
        </div>
        ${routeNotice}
        <div class="avatar-wrapper stage-${newProg.stage} route-${routeClass}" style="margin: 20px 0;">
          <div class="avatar-aura"></div>
          <img src="assets/miacis-logo.png" class="miacis-avatar" alt="ミアキス">
        </div>
        <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 20px;">
          累計 ${newProg.total_points} 点に到達！ ミアキスが新たな姿に進化しました。
        </div>
        <button class="btn-primary" id="btn-evolution-ok" style="font-size: 20px;">やった！</button>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('btn-evolution-ok').addEventListener('click', () => {
      modal.remove();
      resolve();
    });
  });
}

/**
 * 単語図鑑画面 (#/zukan)
 */
async function renderZukan() {
  const muteIcon = isMuted() ? '🔇' : '🔊';

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">単語図鑑</h1>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn-mute" id="btn-mute-toggle" aria-label="効果音ミュート切り替え">${muteIcon}</button>
        <button class="btn-logout" id="btn-back-home">戻る</button>
      </div>
    </header>

    <div class="tab-bar">
      <button class="tab-btn ${state.zukanTab === 1 ? 'active' : ''}" data-band="1">段1</button>
      <button class="tab-btn ${state.zukanTab === 2 ? 'active' : ''}" data-band="2">段2</button>
      <button class="tab-btn ${state.zukanTab === 3 ? 'active' : ''}" data-band="3">段3</button>
      <button class="tab-btn ${state.zukanTab === 4 ? 'active' : ''}" data-band="4">段4</button>
      <button class="tab-btn ${state.zukanTab === 5 ? 'active' : ''}" data-band="5">段5</button>
    </div>

    <div id="zukan-content">読み込み中...</div>
  `;

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    const nextMuted = toggleMute();
    document.getElementById('btn-mute-toggle').textContent = nextMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-back-home').addEventListener('click', () => {
    window.location.hash = '#/home';
  });

  const tabBtns = document.querySelectorAll('.tab-btn[data-band]');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      state.zukanTab = parseInt(btn.dataset.band, 10);
      renderZukan();
    });
  });

  try {
    const wordsData = await getMyWords();
    const contentEl = document.getElementById('zukan-content');
    if (!contentEl) return;

    const bandStat = wordsData.bands?.find(b => b.band === state.zukanTab) || { total: 0, collected: 0 };
    const percent = bandStat.total > 0 ? Math.round((bandStat.collected / bandStat.total) * 100) : 0;
    const bandWords = wordsData.words?.filter(w => w.band === state.zukanTab) || [];

    let cardsHtml = '';
    if (bandWords.length === 0) {
      cardsHtml = `<div class="card" style="text-align: center; color: var(--text-muted); padding: 30px 16px;">この段で正解した単語はまだありません。<br>対戦で正解して単語を覚えよう！</div>`;
    } else {
      const itemsHtml = bandWords.map(w => `
        <div class="zukan-card-item" data-word="${escapeHtml(w.en + ' ' + w.ja)}" style="border-left: 4px solid var(--primary); padding: 10px 12px; margin-bottom: 8px;">
          <div class="zukan-item-en" style="font-size: 17px; font-weight: 800;">${escapeHtml(w.en)}</div>
          <div class="zukan-item-ja" style="font-size: 14px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(w.ja)}</div>
        </div>
      `).join('');

      cardsHtml = `<div style="display:flex; flex-direction:column; gap:8px;">${itemsHtml}</div>`;
    }

    const uncollectedCount = Math.max(0, bandStat.total - bandStat.collected);

    contentEl.innerHTML = `
      <div class="zukan-progress-card">
        <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; margin-bottom: 6px;">
          <span>段${state.zukanTab} 覚えた数</span>
          <span>${bandStat.collected} / ${bandStat.total} 語 (${percent}%)</span>
        </div>
        <div class="evolution-bar-bg">
          <div class="evolution-bar-fill" style="width: ${percent}%;"></div>
        </div>
      </div>

      ${bandWords.length ? '<div class="zukan-tools"><label for="word-search" class="form-label">集めた単語を探す</label><input id="word-search" type="search" class="form-input" placeholder="英語・日本語で検索"><button class="btn-sub" id="toggle-meanings" aria-pressed="false">意味を隠して思い出す</button><p id="word-search-status" role="status"></p></div>' : ''}
      ${cardsHtml}

      ${uncollectedCount > 0 ? `
        <div class="card" style="text-align: center; color: var(--text-muted); font-size: 14px; padding: 12px; margin-top: 12px;">
          ？ あと ${uncollectedCount} 語が未マスター
        </div>
      ` : ''}

      <div class="notice-line" style="margin-top: 16px;">対戦で正解した単語がここに記録されます</div>
    `;
    const search = document.getElementById('word-search');
    search?.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase();
      let found = 0;
      contentEl.querySelectorAll('.zukan-card-item').forEach(card => {
        card.hidden = !card.dataset.word.toLocaleLowerCase().includes(query);
        if (!card.hidden) found++;
      });
      document.getElementById('word-search-status').textContent = found ? `${found}語 見つかりました` : '該当する単語はありません';
    });
    document.getElementById('toggle-meanings')?.addEventListener('click', event => {
      const hidden = contentEl.classList.toggle('meanings-hidden');
      event.currentTarget.setAttribute('aria-pressed', String(hidden));
      event.currentTarget.textContent = hidden ? '意味を表示して答え合わせ' : '意味を隠して思い出す';
    });
  } catch (err) {
    const contentEl = document.getElementById('zukan-content');
    if (contentEl) {
      contentEl.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }
}

/**
 * 今週の英語画面 (#/content)
 */
async function renderContent() {
  const muteIcon = isMuted() ? '🔇' : '🔊';

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">今週の英語</h1>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn-mute" id="btn-mute-toggle" aria-label="効果音ミュート切り替え">${muteIcon}</button>
        <button class="btn-logout" id="btn-back-home">戻る</button>
      </div>
    </header>
    <div id="content-area">読み込み中...</div>
  `;

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    const nextMuted = toggleMute();
    document.getElementById('btn-mute-toggle').textContent = nextMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-back-home').addEventListener('click', () => {
    window.location.hash = '#/home';
  });

  try {
    const contents = await getApprovedContents();
    const area = document.getElementById('content-area');
    if (!area) return;

    if (contents.length === 0) {
      area.innerHTML = `
        <div class="card" style="text-align: center; padding: 32px 16px;">
          <p style="margin-bottom: 20px;">今週の英語はまだありません。お楽しみに！</p>
          <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
        </div>
      `;
      return;
    }

    const currentContent = contents[0]; // 最新の承認コンテンツ
    // コンテンツを開いた記録
    await openContent(currentContent.id);

    const opens = await getMyContentOpens();
    const quizAnswers = await getMyQuizAnswers();
    const writings = await getMyWritings();

    const myQuizAns = quizAnswers.find(q => q.content_id === currentContent.id);
    const myWriting = writings.find(w => w.content_id === currentContent.id);

    const ytId = extractYouTubeId(currentContent.url);
    const videoHtml = ytId
      ? `
      <div class="video-wrapper">
        <iframe src="https://www.youtube-nocookie.com/embed/${ytId}" allowfullscreen></iframe>
      </div>
    `
      : '';

    // クイズ表示部
    let quizHtml = '';
    const quizItems = Array.isArray(currentContent.quiz) ? currentContent.quiz : [];
    if (myQuizAns) {
      quizHtml = `
        <div class="alert alert-success">
          クイズ回答済み（正解: ${myQuizAns.correct_count}問）
        </div>
      `;
    } else if (quizItems.length > 0) {
      const qInputs = quizItems.map((item, idx) => {
        if (item.type === 'cloze') {
          return `
            <div class="form-group">
              <label class="form-label">${idx + 1}. ${escapeHtml(item.prompt)}</label>
              <input class="form-input quiz-input" data-index="${idx}" type="text" placeholder="英単語を入力">
            </div>
          `;
        } else {
          const choices = item.choices || [];
          const opts = choices.map(c => `
            <label style="display: block; margin-bottom: 6px; font-size: 16px;">
              <input type="radio" name="quiz_opt_${idx}" value="${escapeHtml(c)}" class="quiz-choice" data-index="${idx}"> ${escapeHtml(c)}
            </label>
          `).join('');
          return `
            <div class="form-group">
              <label class="form-label">${idx + 1}. ${escapeHtml(item.prompt)}</label>
              <div style="padding: 6px 0;">${opts}</div>
            </div>
          `;
        }
      }).join('');

      quizHtml = `
        <div class="card">
          <div class="card-title">クイズに挑戦</div>
          <form id="quiz-form">
            ${qInputs}
            <button type="submit" class="btn-primary" style="margin-top: 10px;">クイズの答えを送る</button>
          </form>
        </div>
      `;
    }

    // 一言表示部
    let writingHtml = '';
    const prompt = currentContent.writing_prompt || {};
    let promptGuide = '';
    if (prompt.type === 'use_word') {
      promptGuide = `この単語のどれかを使って1文: <strong>${escapeHtml((prompt.words || []).join(', '))}</strong>`;
    } else if (prompt.type === 'three_words') {
      promptGuide = '3語で感想を書いてね';
    } else if (prompt.type === 'what_would_you_do') {
      promptGuide = '5語以上で、自分ならどうする？';
    }

    if (myWriting) {
      const stampText = myWriting.stamp ? `スタッフからのスタンプ: ${escapeHtml(myWriting.stamp)}` : 'スタッフ確認中';
      writingHtml = `
        <div class="card">
          <div class="card-title">今週の一言</div>
          <p style="font-size: 16px; margin-bottom: 10px;">${escapeHtml(myWriting.text)}</p>
          <div class="alert alert-info">${stampText}</div>
        </div>
      `;
    } else {
      writingHtml = `
        <div class="card">
          <div class="card-title">今週の一言</div>
          <div class="form-help" style="margin-bottom: 10px; font-weight: 600;">${promptGuide}</div>
          <div class="notice-line" style="text-align: left; margin-bottom: 8px;">名前・学校・住所・連絡先は書かないでね</div>
          <div id="writing-alert"></div>
          <form id="writing-form">
            <textarea class="form-textarea" id="writing-text" placeholder="英語で書いてね"></textarea>
            <button type="submit" class="btn-primary" id="btn-submit-writing" style="margin-top: 12px;">一言を送る</button>
          </form>
        </div>
      `;
    }

    // ピッカー用提案部
    let pickerHtml = '';
    if (state.player.is_picker) {
      pickerHtml = `
        <div class="card" style="border-color: var(--primary);">
          <div class="card-title">今週の英語を出す（ピッカー専用）</div>
          <div class="form-help" style="margin-bottom: 12px;">スタッフが見てから公開されます</div>
          <div id="propose-alert"></div>
          <form id="propose-form">
            <div class="form-group">
              <label class="form-label" for="prop-title">題名</label>
              <input class="form-input" id="prop-title" type="text" placeholder="例: 面白い動物の動画" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="prop-url">URL</label>
              <input class="form-input" id="prop-url" type="url" placeholder="https://..." required>
            </div>
            <div class="form-group">
              <label class="form-label">クイズの出題（1問）</label>
              <input class="form-input" id="prop-quiz-prompt" type="text" placeholder="問題文" required style="margin-bottom: 8px;">
              <input class="form-input" id="prop-quiz-answer" type="text" placeholder="正解の英単語" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="prop-prompt-type">一言の形</label>
              <select class="form-select" id="prop-prompt-type">
                <option value="three_words">3語で感想</option>
                <option value="what_would_you_do">5語以上で、自分ならどうする？</option>
                <option value="use_word">指定単語を使って1文</option>
              </select>
            </div>
            <div class="form-group" id="prop-words-group" style="display: none;">
              <label class="form-label" for="prop-words">指定単語（カンマ区切り）</label>
              <input class="form-input" id="prop-words" type="text" placeholder="例: like, want, good">
            </div>
            <button type="submit" class="btn-primary" id="btn-submit-propose">提案する</button>
          </form>
        </div>
      `;
    }

    area.innerHTML = `
      <div class="card">
        <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 12px;">${escapeHtml(currentContent.title)}</h2>
        ${videoHtml}
        <a href="${escapeHtml(currentContent.url)}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="margin-top: 8px;">
          動画・記事を見る（新しいタブ）
        </a>
      </div>

      ${quizHtml}
      ${writingHtml}
      ${pickerHtml}

      <div style="margin-top: 20px;">
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
      </div>
    `;

    // クイズ送信処理
    const quizForm = document.getElementById('quiz-form');
    if (quizForm) {
      quizForm.addEventListener('submit', async e => {
        e.preventDefault();
        const answers = [];
        quizItems.forEach((item, idx) => {
          if (item.type === 'cloze') {
            const input = quizForm.querySelector(`.quiz-input[data-index="${idx}"]`);
            answers.push(input ? input.value.trim() : '');
          } else {
            const checked = quizForm.querySelector(`input[name="quiz_opt_${idx}"]:checked`);
            answers.push(checked ? checked.value : '');
          }
        });

        try {
          await answerContentQuiz(currentContent.id, answers);
          renderContent();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    // 一言送信処理
    const writingForm = document.getElementById('writing-form');
    if (writingForm) {
      writingForm.addEventListener('submit', async e => {
        e.preventDefault();
        const text = document.getElementById('writing-text').value;
        const alertBox = document.getElementById('writing-alert');
        alertBox.innerHTML = '';

        const pastTexts = writings.map(w => w.text);
        const check = validateWriting(text, currentContent.writing_prompt, pastTexts);
        if (!check.valid) {
          alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(check.error)}</div>`;
          return;
        }

        try {
          await submitWriting(currentContent.id, text);
          renderContent();
        } catch (err) {
          alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
        }
      });
    }

    // 提案フォーム処理
    if (state.player.is_picker) {
      const typeSelect = document.getElementById('prop-prompt-type');
      const wordsGroup = document.getElementById('prop-words-group');
      if (typeSelect && wordsGroup) {
        typeSelect.addEventListener('change', () => {
          wordsGroup.style.display = typeSelect.value === 'use_word' ? 'block' : 'none';
        });
      }

      const propForm = document.getElementById('propose-form');
      if (propForm) {
        propForm.addEventListener('submit', async e => {
          e.preventDefault();
          const propAlert = document.getElementById('propose-alert');
          propAlert.innerHTML = '';

          const title = document.getElementById('prop-title').value.trim();
          const url = document.getElementById('prop-url').value.trim();
          const qPrompt = document.getElementById('prop-quiz-prompt').value.trim();
          const qAns = document.getElementById('prop-quiz-answer').value.trim();
          const promptType = document.getElementById('prop-prompt-type').value;

          const quiz = [
            {
              type: 'cloze',
              prompt: qPrompt,
              answer: qAns
            }
          ];

          let writingPrompt = { type: promptType };
          if (promptType === 'use_word') {
            const rawWords = document.getElementById('prop-words').value;
            const words = rawWords.split(',').map(w => w.trim()).filter(Boolean);
            if (words.length === 0) {
              propAlert.innerHTML = '<div class="alert alert-error">指定単語を入力してください</div>';
              return;
            }
            writingPrompt.words = words;
          }

          try {
            await proposeContent(title, url, quiz, writingPrompt);
            propAlert.innerHTML = '<div class="alert alert-success">提案しました！スタッフが確認したあと公開されます</div>';
            propForm.reset();
          } catch (err) {
            propAlert.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
          }
        });
      }
    }
  } catch (err) {
    const area = document.getElementById('content-area');
    if (area) {
      area.innerHTML = `
        <div class="alert alert-error">${escapeHtml(err.message)}</div>
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
      `;
    }
  }
}

/**
 * ランキング画面 (#/ranking)
 */
async function renderRanking() {
  const muteIcon = isMuted() ? '🔇' : '🔊';

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">ランキング</h1>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn-mute" id="btn-mute-toggle" aria-label="効果音ミュート切り替え">${muteIcon}</button>
        <button class="btn-logout" id="btn-back-home">戻る</button>
      </div>
    </header>

    <div class="tab-bar">
      ${state.flags.rank_mode_enabled ? `<button id="tab-learn" class="tab-btn ${state.rankingTab === 'learn' ? 'active' : ''}">学習（自分の段）</button>` : ''}
      <button id="tab-commit" class="tab-btn ${state.rankingTab === 'commit' ? 'active' : ''}">コミット（全員）</button>
      <button id="tab-streak" class="tab-btn ${state.rankingTab === 'streak' ? 'active' : ''}">連続記録</button>
      <button id="tab-knock" class="tab-btn ${state.rankingTab === 'knock' ? 'active' : ''}">100本ノック</button>
    </div>

    <div class="notice-line" id="ranking-notice"></div>

    <div id="ranking-reward"></div>
    <div id="ranking-container">読み込み中...</div>

    <div style="margin-top: 16px;">
      <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
    </div>
  `;

  getWeeklyRewardRules().then(rules => {
    const target = document.getElementById('ranking-reward');
    if (target && rules.ranking) target.innerHTML = `<div class="card"><strong>週間コミット1位に、選べる無料券</strong><p>${escapeHtml(rules.ranking.description)}</p><p class="notice-line">生徒全体で週1枚。月曜0:05に前週分を確定。1点以上が対象で、同点はニックネーム順。スタッフは対象外です。</p></div>`;
  }).catch(() => {});

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    const nextMuted = toggleMute();
    document.getElementById('btn-mute-toggle').textContent = nextMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-back-home').addEventListener('click', () => {
    window.location.hash = '#/home';
  });

  if (!state.flags.rank_mode_enabled && state.rankingTab === 'learn') state.rankingTab = 'streak';
  for (const tab of ['learn', 'commit', 'streak', 'knock']) {
    document.getElementById(`tab-${tab}`)?.addEventListener('click', () => {
      state.rankingTab = tab;
      document.querySelectorAll('.tab-bar .tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-${tab}`));
      loadRankingData();
    });
  }

  await loadRankingData();
}

async function loadRankingData() {
  const container = document.getElementById('ranking-container');
  if (!container) return;
  container.innerHTML = '読み込み中...';

  const tab = state.rankingTab;
  const notices = {
    learn: 'コミットポイントは1日10点まで。毎日ちょっとずつが強い',
    commit: 'コミットポイントは1日10点まで。毎日ちょっとずつが強い',
    streak: state.streakScope === 'all'
      ? 'これまでの最高記録。同じ記録なら、かかった時間が短い人が上'
      : '今週の自己ベスト。月曜にリセット。同じ記録なら、かかった時間が短い人が上',
    knock: `${state.flags.rank_mode_enabled ? tierToLabel(state.player.tier) + 'の' : '同じレベルの単語での'}今週の自己ベスト（100問やり切った回）。同じ数なら速い人が上`
  };
  const notice = document.getElementById('ranking-notice');
  if (notice) {
    notice.innerHTML = tab === 'streak'
      ? `${notices.streak} <button class="btn-inline" id="btn-streak-scope">${state.streakScope === 'all' ? '今週を見る' : '歴代を見る'}</button>`
      : notices[tab];
    document.getElementById('btn-streak-scope')?.addEventListener('click', () => {
      state.streakScope = state.streakScope === 'all' ? 'week' : 'all';
      loadRankingData();
    });
  }
  const reward = document.getElementById('ranking-reward');
  if (reward) reward.hidden = tab === 'streak' || tab === 'knock';

  const fetchRows = {
    learn: () => getRankingLearn(state.player.tier),
    commit: () => getRankingCommit(),
    streak: () => getRankingStreak(state.streakScope),
    knock: () => getRankingKnock(state.player.tier)
  }[tab];

  try {
    const [rows, publicLooks] = await Promise.all([
      fetchRows(),
      getPublicLooks().catch(() => [])
    ]);
    if (state.rankingTab !== tab) return;

    if (rows.length === 0) {
      container.innerHTML = '<div class="card" style="text-align: center;">まだランキングデータがありません</div>';
      return;
    }

    const looksMap = Object.fromEntries((publicLooks || []).map(p => [p.nickname, p.looks]));

    const itemsHtml = rows.map(r => {
      const myRow = isMyRow(r, state.player.nickname);
      const rankText = formatRank(r.rank);
      const pts = {
        learn: `${r.learn_points}点`,
        commit: `${r.commit_points}点`,
        streak: `${r.best_streak}連続`,
        knock: `${r.best_correct}/100`
      }[tab];
      const tierText = tierToLabel(r.tier);
      const look = looksMap[r.nickname] || null;
      const miacisAvatarHtml = renderMiacis(look, 36);
      const titleName = look?.title?.name ? escapeHtml(look.title.name) : '';

      return `
        <div class="ranking-item ${myRow ? 'is-me' : ''}">
          <div class="rank-col">${rankText}</div>
          <div class="ranking-avatar-col">${miacisAvatarHtml}</div>
          <div class="nick-col">
            <div style="font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(r.nickname)}</div>
            ${titleName ? `<div class="ranking-title-badge">👑 ${titleName}</div>` : ''}
          </div>
          ${state.flags.rank_mode_enabled ? `<div class="tier-col">${tierText}</div>` : ''}
          <div class="pts-col">${pts}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="ranking-list">
        ${itemsHtml}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

/**
 * 自分の記録画面 (#/me)
 */
async function renderMe() {
  const muteIcon = isMuted() ? '🔇' : '🔊';

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">自分の記録</h1>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn-mute" id="btn-mute-toggle" aria-label="効果音ミュート切り替え">${muteIcon}</button>
        <button class="btn-logout" id="btn-back-home">戻る</button>
      </div>
    </header>
    <div id="me-container">読み込み中...</div>
  `;

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    const nextMuted = toggleMute();
    document.getElementById('btn-mute-toggle').textContent = nextMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-back-home').addEventListener('click', () => {
    window.location.hash = '#/home';
  });

  try {
    const [weeklyResults, writings, tickets] = await Promise.all([
      getMyWeeklyResults().catch(() => []),
      getMyWritings().catch(() => []),
      getMyTickets().catch(() => [])
    ]);

    const container = document.getElementById('me-container');
    if (!container) return;

    // 館の景品 引換券
    const unusedTickets = tickets.filter(t => !t.redeemed_at);
    const usedTickets = tickets.filter(t => !!t.redeemed_at);

    let unusedTicketsHtml = '<div style="color: var(--text-muted); font-size: 14px;">未使用の引換券はありません</div>';
    if (unusedTickets.length > 0) {
      unusedTicketsHtml = unusedTickets.map(t => {
        const shortId = t.id ? t.id.slice(-8) : '';
        const wonDate = t.won_at ? new Date(t.won_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
        return `
          <div class="card prize-ticket-card" style="border: 2px solid var(--primary); background: rgba(242, 194, 0, 0.08); margin-bottom: 12px; padding: 14px 16px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 6px;">
              <div style="font-size: 18px; font-weight: 800; color: var(--primary);">🎁 ${escapeHtml(t.prize_name)}</div>
              <span style="background: var(--primary); color: var(--primary-text); font-weight: 800; padding: 2px 8px; border-radius: 9999px; font-size: 12px;">未使用</span>
            </div>
            ${t.prize_description ? `<div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">${escapeHtml(t.prize_description)}</div>` : ''}
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">当選日時: ${wonDate}</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">引換券番号: <code style="font-family: monospace; font-size: 14px; font-weight: 700; color: var(--text);">...${escapeHtml(shortId)}</code></div>
            <div class="alert alert-info" style="margin-bottom: 0; font-weight: 700; font-size: 13px; text-align: center;">
              🏛️ Miacis の館内でスタッフに見せてね
            </div>
          </div>
        `;
      }).join('');
    }

    let usedTicketsHtml = '';
    if (usedTickets.length > 0) {
      usedTicketsHtml = usedTickets.map(t => {
        const shortId = t.id ? t.id.slice(-8) : '';
        const redeemedDate = t.redeemed_at ? new Date(t.redeemed_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
        return `
          <div class="card" style="opacity: 0.7; padding: 12px 16px; margin-bottom: 8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
              <div style="font-size: 15px; font-weight: 700; text-decoration: line-through;">🎁 ${escapeHtml(t.prize_name)}</div>
              <span style="font-size: 12px; color: var(--text-muted);">引換済み</span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">引換日時: ${redeemedDate} (券番号: ...${escapeHtml(shortId)})</div>
          </div>
        `;
      }).join('');
    }

    let weeklyHtml = '<div style="color: var(--text-muted); font-size: 14px;">過去の週次記録はありません</div>';
    if (weeklyResults.length > 0) {
      weeklyHtml = weeklyResults.map(res => `
        <div class="card" style="padding: 12px 16px; margin-bottom: 10px;">
          <div style="font-weight: 700; margin-bottom: 4px;">${res.week_start} の週</div>
          <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 4px;">
            段位: 段${res.tier_before} → 段${res.tier_after}
          </div>
          <div style="font-size: 15px;">
            学習: ${res.learn_points}点 (${res.learn_rank_in_tier ? res.learn_rank_in_tier + '位' : '-'}) / 
            コミット: ${res.commit_points}点 (${res.commit_rank ? res.commit_rank + '位' : '-'})
          </div>
        </div>
      `).join('');
    }

    let writingsHtml = '<div style="color: var(--text-muted); font-size: 14px;">投稿した一言はありません</div>';
    if (writings.length > 0) {
      writingsHtml = writings.map(w => {
        const dateStr = new Date(w.created_at).toLocaleDateString('ja-JP');
        const stampStr = w.stamp ? `スタッフのスタンプ: ${escapeHtml(w.stamp)}` : 'スタッフ確認中';
        return `
          <div class="card" style="padding: 12px 16px; margin-bottom: 10px;">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">${dateStr}</div>
            <div style="font-size: 15px; margin-bottom: 6px;">${escapeHtml(w.text)}</div>
            <div style="font-size: 13px; color: var(--primary);">${stampStr}</div>
          </div>
        `;
      }).join('');
    }

    container.innerHTML = `
      <div class="card-title">館の景品 引換券</div>
      <div style="margin-bottom: 24px;">
        ${unusedTicketsHtml}
        ${usedTickets.length > 0 ? `
          <details style="margin-top: 12px;">
            <summary style="cursor: pointer; font-size: 13px; color: var(--text-muted); padding: 4px 0;">引き換え済みの券を見る (${usedTickets.length}件)</summary>
            <div style="margin-top: 8px;">
              ${usedTicketsHtml}
            </div>
          </details>
        ` : ''}
      </div>

      <div class="card-title">週ごとの記録</div>
      <div style="margin-bottom: 24px;">
        ${weeklyHtml}
      </div>

      <div class="card-title">書いた一言とスタッフのスタンプ</div>
      <div style="margin-bottom: 24px;">
        ${writingsHtml}
      </div>

      <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
    `;
  } catch (err) {
    const container = document.getElementById('me-container');
    if (container) {
      container.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }
}

/**
 * スタッフ画面 (#/staff)
 */
async function renderStaff() {
  if (!state.isStaff) {
    appEl.innerHTML = `
      <div class="card" style="text-align: center; padding: 32px 16px;">
        <div class="alert alert-error">スタッフ専用の画面です</div>
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
      </div>
    `;
    return;
  }

  const muteIcon = isMuted() ? '🔇' : '🔊';

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">スタッフ画面</h1>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn-mute" id="btn-mute-toggle" aria-label="効果音ミュート切り替え">${muteIcon}</button>
        <button class="btn-logout" id="btn-back-home">戻る</button>
      </div>
    </header>

    <div class="tab-bar">
      <button class="tab-btn ${state.staffTab === 'overview' ? 'active' : ''}" data-tab="overview">利用状況</button>
      <button class="tab-btn ${state.staffTab === 'tickets' ? 'active' : ''}" data-tab="tickets">引換券</button>
      <button class="tab-btn ${state.staffTab === 'prizes' ? 'active' : ''}" data-tab="prizes">景品</button>
      <button class="tab-btn ${state.staffTab === 'contents' ? 'active' : ''}" data-tab="contents">英語</button>
      <button class="tab-btn ${state.staffTab === 'writings' ? 'active' : ''}" data-tab="writings">一言</button>
    </div>

    <div id="staff-container">読み込み中...</div>
  `;

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    const nextMuted = toggleMute();
    document.getElementById('btn-mute-toggle').textContent = nextMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-back-home').addEventListener('click', () => {
    window.location.hash = '#/home';
  });

  appEl.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.staffTab = btn.dataset.tab;
      renderStaff();
    });
  });

  const container = document.getElementById('staff-container');
  if (!container) return;

  try {
    if (state.staffTab === 'overview') {
      const overview = await getStaffRewardOverview();
      const stats = overview.stats;
      container.innerHTML = `
        <div class="card"><div class="card-title">利用状況</div>
          <p class="notice-line">${escapeHtml(overview.week_start)}からの週／日本時間・月曜開始</p>
          <dl class="staff-metrics">
            <div><dt>生徒の登録数</dt><dd>${stats.students}人</dd></div>
            <div><dt>今週の利用者</dt><dd>${stats.weekly_active}人</dd></div>
            <div><dt>今週の抽選回数</dt><dd>${stats.weekly_pulls}回</dd></div>
            <div><dt>スタッフ</dt><dd>${stats.staff}人</dd></div>
          </dl><p class="notice-line">利用者・抽選回数にスタッフは含みません。まとめ引き（11連）は11回と数えます。</p>
        </div>
        <div class="card"><div class="card-title">週ごとの無料券</div>
          <p>ガチャ：今週 ${stats.gacha_issued} / 1枚 発行</p>
          <p>ランキング：先週分 ${stats.ranking_issued_last_week} / 1枚 発行</p>
          <p class="notice-line">ガチャの目安確率：残り枠がある間、1回 ${(overview.prize_rate * 100).toFixed(1)}%。当選後は次の週まで0%。繰り越しなし。</p>
          <p class="notice-line">ランキングは週間コミット1位（1点以上）。同点はニックネーム順で1名。月曜0:05に前週分を確定します。</p>
          ${overview.rewards.map(r => `<div class="weekly-reward-row"><strong>${escapeHtml(r.name)}</strong><span>${r.active ? '有効' : '停止中'}</span><p>${escapeHtml(r.description)}</p></div>`).join('')}
        </div>`;
    } else if (state.staffTab === 'tickets') {
      const tickets = await staffListTickets(false);
      const openTickets = tickets.filter(t => !t.redeemed_at);
      const doneTickets = tickets.filter(t => !!t.redeemed_at);

      let openTicketsHtml = '<div style="color: var(--text-muted); font-size: 14px; margin-bottom: 16px;">未引換の引換券はありません 🎉</div>';
      if (openTickets.length > 0) {
        openTicketsHtml = openTickets.map(t => {
          const shortId = t.id ? t.id.slice(-8) : '';
          const wonDate = t.won_at ? new Date(t.won_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
          return `
            <div class="card" style="border: 2px solid var(--primary); margin-bottom: 12px; padding: 14px 16px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                  <div style="font-size: 17px; font-weight: 800; color: var(--primary);">🎁 ${escapeHtml(t.prize_name)}</div>
                  <div style="font-size: 15px; font-weight: 700; margin-top: 2px;">プレイヤー: <strong>${escapeHtml(t.nickname)}</strong> さん</div>
                </div>
                <span style="background: var(--primary); color: var(--primary-text); font-weight: 800; padding: 2px 8px; border-radius: 9999px; font-size: 12px;">未引換</span>
              </div>
              ${t.prize_description ? `<div style="font-size: 13px; color: var(--text-muted); margin: 6px 0;">${escapeHtml(t.prize_description)}</div>` : ''}
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">当選: ${wonDate} / 券番号: <code>...${escapeHtml(shortId)}</code></div>
              <button class="btn-primary btn-redeem-ticket" data-id="${t.id}" data-nick="${escapeHtml(t.nickname)}" data-prize="${escapeHtml(t.prize_name)}" style="min-height: 48px; font-size: 16px; margin-top: 10px; width: 100%;">
                景品を渡した（引換完了にする）
              </button>
            </div>
          `;
        }).join('');
      }

      let doneTicketsHtml = '';
      if (doneTickets.length > 0) {
        doneTicketsHtml = doneTickets.map(t => {
          const shortId = t.id ? t.id.slice(-8) : '';
          const redeemedDate = t.redeemed_at ? new Date(t.redeemed_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
          return `
            <div class="card" style="opacity: 0.7; padding: 12px 14px; margin-bottom: 8px;">
              <div style="font-size: 14px; font-weight: 700;">🎁 ${escapeHtml(t.prize_name)} - ${escapeHtml(t.nickname)} さん</div>
              <div style="font-size: 11px; color: var(--text-muted);">引換日時: ${redeemedDate} (券番号: ...${escapeHtml(shortId)})</div>
            </div>
          `;
        }).join('');
      }

      container.innerHTML = `
        <div class="card-title">未引換のチケット一覧 (${openTickets.length}件)</div>
        <div style="margin-bottom: 20px;">
          ${openTicketsHtml}
        </div>

        ${doneTickets.length > 0 ? `
          <details style="margin-bottom: 20px;">
            <summary style="cursor: pointer; font-size: 14px; color: var(--text-muted); padding: 6px 0;">引換済みのチケット一覧 (${doneTickets.length}件)</summary>
            <div style="margin-top: 10px;">
              ${doneTicketsHtml}
            </div>
          </details>
        ` : ''}

        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
      `;

      container.querySelectorAll('.btn-redeem-ticket').forEach(btn => {
        btn.addEventListener('click', async () => {
          const nick = btn.dataset.nick;
          const prize = btn.dataset.prize;
          if (!confirm(`${nick} さんに「${prize}」を渡しましたか？\n引換済みにします。`)) return;

          btn.disabled = true;
          btn.textContent = '処理中...';
          try {
            await staffRedeemTicket(btn.dataset.id);
            alert('引換を完了しました！');
            renderStaff();
          } catch (err) {
            alert(err.message);
            btn.disabled = false;
            btn.textContent = '景品を渡した（引換完了にする）';
          }
        });
      });

    } else if (state.staffTab === 'prizes') {
      const rates = await getGachaRates();
      const prizeList = rates.prizes || [];

      let prizesHtml = '<div style="color: var(--text-muted); font-size: 14px;">登録されている景品はありません</div>';
      if (prizeList.length > 0) {
        prizesHtml = prizeList.map(p => `
          <div class="card" style="padding: 12px 14px; margin-bottom: 8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="font-size: 16px; font-weight: 700;">🎁 ${escapeHtml(p.name)}</div>
              <div style="font-size: 16px; font-weight: 800; color: var(--primary);">在庫: ${p.stock} 個</div>
            </div>
            ${p.description ? `<div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(p.description)}</div>` : ''}
          </div>
        `).join('');
      }

      container.innerHTML = `
        <div class="card">
          <div class="card-title">景品を新しく追加・補充</div>
          <form id="prize-upsert-form">
            <div class="form-group">
              <label class="form-label" for="prize-name">景品名</label>
              <input class="form-input" id="prize-name" type="text" placeholder="例: ミアキス特製ステッカー" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="prize-desc">説明（任意）</label>
              <input class="form-input" id="prize-desc" type="text" placeholder="例: ホログラム仕様の限定ステッカー">
            </div>
            <div class="form-group">
              <label class="form-label" for="prize-stock">在庫数</label>
              <input class="form-input" id="prize-stock" type="number" min="0" value="10" required>
            </div>
            <div class="form-group" style="display:flex; align-items:center; gap:8px;">
              <input type="checkbox" id="prize-active" checked style="width:20px; height:20px;">
              <label for="prize-active" style="font-size:15px; font-weight:700;">ガチャから排出する（有効）</label>
            </div>
            <button type="submit" class="btn-primary" id="btn-save-prize" style="margin-top: 10px;">景品を登録する</button>
          </form>
        </div>

        <div class="card-title">現在のガチャ排出景品一覧</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">現在の景品排出確率: ${(rates.prize_rate * 100).toFixed(1)}%</div>
        <div style="margin-bottom: 20px;">
          ${prizesHtml}
        </div>

        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
      `;

      document.getElementById('prize-upsert-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('prize-name').value.trim();
        const desc = document.getElementById('prize-desc').value.trim();
        const stock = parseInt(document.getElementById('prize-stock').value, 10);
        const active = document.getElementById('prize-active').checked;

        const saveBtn = document.getElementById('btn-save-prize');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        try {
          await staffUpsertPrize(null, name, desc, stock, active);
          alert('景品を保存しました！');
          renderStaff();
        } catch (err) {
          alert(err.message);
          saveBtn.disabled = false;
          saveBtn.textContent = '景品を登録する';
        }
      });

    } else if (state.staffTab === 'contents') {
      const unapproved = await getUnapprovedContents();
      let unapprovedHtml = '<div style="color: var(--text-muted); font-size: 14px; margin-bottom: 20px;">未承認の今週の英語はありません</div>';
      if (unapproved.length > 0) {
        unapprovedHtml = unapproved.map(item => `
          <div class="card">
            <div style="font-weight: 700; font-size: 17px; margin-bottom: 6px;">${escapeHtml(item.title)}</div>
            <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px; word-break: break-all;">
              URL: <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a>
            </div>
            <button class="btn-primary btn-approve" data-id="${item.id}" style="min-height: 48px;">公開する</button>
          </div>
        `).join('');
      }

      container.innerHTML = `
        <div class="card-title">未承認の今週の英語</div>
        <div style="margin-bottom: 24px;">
          ${unapprovedHtml}
        </div>
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
      `;

      container.querySelectorAll('.btn-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = '承認中...';
          try {
            await approveContent(btn.dataset.id);
            renderStaff();
          } catch (err) {
            alert(err.message);
            btn.disabled = false;
            btn.textContent = '公開する';
          }
        });
      });

    } else if (state.staffTab === 'writings') {
      const writings = await getRecentWritings();
      const stamps = ['👍', '✨', '😂', '🔥', '👀'];
      let writingsHtml = '<div style="color: var(--text-muted); font-size: 14px;">投稿された一言はありません</div>';
      if (writings.length > 0) {
        writingsHtml = writings.map(w => {
          const stampBtns = stamps.map(s => `
            <button class="stamp-btn" data-id="${w.id}" data-stamp="${s}">${s}</button>
          `).join('');

          const currentStamp = w.stamp ? `現在: ${escapeHtml(w.stamp)}` : '未スタンプ';

          return `
            <div class="card" style="margin-bottom: 12px;">
              <div style="font-size: 16px; margin-bottom: 6px;">${escapeHtml(w.text)}</div>
              <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">${currentStamp}</div>
              <div class="stamp-row">
                ${stampBtns}
              </div>
            </div>
          `;
        }).join('');
      }

      container.innerHTML = `
        <div class="card-title">今週の一言一覧（スタンプを押す）</div>
        <div style="margin-bottom: 24px;">
          ${writingsHtml}
        </div>
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホーム</button>
      `;

      container.querySelectorAll('.stamp-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await stampWriting(btn.dataset.id, btn.dataset.stamp);
            renderStaff();
          } catch (err) {
            alert(err.message);
          }
        });
      });
    }
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }
}

// 起動
init();
