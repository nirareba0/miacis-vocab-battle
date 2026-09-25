/**
 * app.js - 画面遷移・状態管理・UIイベントハンドリング
 */
import {
  isConfigured,
  signUpPlayer,
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
  openPack,
  getPackStatus,
  getMyCollection,
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
  stampWriting
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

// グローバル状態
const state = {
  session: null,
  player: null,
  isStaff: false,
  progress: null,
  packStatus: null,
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
  rankingTab: 'learn', // 'learn' | 'commit'
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
  if (!isConfigured()) {
    renderPreparation();
    return;
  }

  if (!state.session || !state.player) {
    renderAuth();
    return;
  }

  const hash = state.currentHash;

  if (hash === '#/battle') {
    renderBattle();
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
    <div style="text-align: center; margin-bottom: 20px;">
      <img src="assets/miacis-logo.png" alt="Miacis Logo" style="width: 76px; height: 76px; object-fit: contain; margin-bottom: 8px;">
      <h1 class="app-title" style="justify-content: center; font-size: 22px;">英単語バトル</h1>
      <div style="font-size: 14px; color: var(--miacis-pink); font-weight: 700; margin-top: 4px;">
        ミアキスに来ている人だけの英単語バトル
      </div>
    </div>

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
          <input class="form-input" id="auth-pass" type="password" placeholder="6文字以上" required autocomplete="current-password">
          <button type="button" class="password-toggle" id="pass-toggle">表示</button>
        </div>
      </div>

      ${
        mode === 'register'
          ? `
        <div class="form-group">
          <label class="form-label">学年</label>
          <div class="grade-grid">
            <button type="button" class="grade-btn" data-grade="1">中1</button>
            <button type="button" class="grade-btn" data-grade="2">中2</button>
            <button type="button" class="grade-btn" data-grade="3">中3</button>
            <button type="button" class="grade-btn" data-grade="4">高1</button>
            <button type="button" class="grade-btn" data-grade="5">高2</button>
            <button type="button" class="grade-btn" data-grade="6">高3</button>
          </div>
          <input type="hidden" id="auth-grade" value="">
        </div>

        <div class="form-group">
          <label class="form-label" for="auth-invite">ミアキスの合言葉（館内に貼ってあるよ）</label>
          <input class="form-input" id="auth-invite" type="text" placeholder="館内ポスターを見てね" required autocomplete="off">
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
        gradeBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        gradeInput.value = btn.dataset.grade;
      });
    });
  }

  const form = document.getElementById('auth-form');
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
        const inviteVal = document.getElementById('auth-invite').value.trim();
        if (!inviteVal) {
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
 * ホーム画面 (#/home)
 */
async function renderHome() {
  const muteIcon = isMuted() ? '🔇' : '🔊';

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">
        <img src="assets/miacis-logo.png" alt="" style="width: 28px; height: 28px; object-fit: contain;">
        <span>英単語バトル</span>
      </h1>
      <div class="header-user">
        <button class="btn-mute" id="btn-mute-toggle" aria-label="効果音ミュート切り替え">${muteIcon}</button>
        <span>${escapeHtml(state.player.nickname)} さん</span>
        <button class="btn-logout" id="btn-logout">ログアウト</button>
      </div>
    </header>
    <div id="home-content">読み込み中...</div>
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
    // 1日1回のアクセス記録
    await touchToday();
    const [summary, progress, packStatus] = await Promise.all([
      getMySummary(),
      getMyProgress(),
      getPackStatus()
    ]);
    state.progress = progress;
    state.packStatus = packStatus;

    const learnRankStr = summary.learn_rank_in_tier ? `${summary.learn_rank_in_tier}位` : '集計中';
    const commitRankStr = summary.commit_rank ? `${summary.commit_rank}位` : '集計中';

    let lastWeekDiff = '先週のデータなし';
    if (summary.last_week) {
      const lw = summary.last_week;
      lastWeekDiff = `先週: 段${lw.tier_before} → 段${lw.tier_after}（${lw.learn_points}点）`;
    }

    const homeContent = document.getElementById('home-content');
    if (!homeContent) return;

    const routeClass = progress.route || 'none';
    let routeBadgeHtml = '';
    if (progress.route === 'grass') {
      routeBadgeHtml = '<span class="route-badge grass">🌾 草原ルート（イヌ科）</span>';
    } else if (progress.route === 'tree') {
      routeBadgeHtml = '<span class="route-badge tree">🌳 木の上ルート（ネコ科）</span>';
    } else {
      routeBadgeHtml = '<span class="route-badge none">❓ どっちに進化する？（累計80点）</span>';
    }

    const stageProg = calcStageProgress(progress.total_points);
    let evolutionLabel = '';
    if (progress.stage < 7) {
      evolutionLabel = `<span>次の進化まで: あと <strong>${progress.points_to_next}点</strong></span><span>累計 ${progress.total_points} / ${progress.next_threshold}点</span>`;
    } else {
      evolutionLabel = `<span>最高段階！ 草原と森の主</span><span>累計 ${progress.total_points}点</span>`;
    }

    homeContent.innerHTML = `
      <div class="notice-line" style="color: var(--miacis-pink); font-weight: 700; margin-top: -6px; margin-bottom: 12px;">
        ミアキスに来ている人だけの対戦です
      </div>

      <div class="miacis-stage-card route-${routeClass}">
        <div class="miacis-stage-name">${escapeHtml(progress.stage_name)}</div>
        ${routeBadgeHtml}
        <div class="avatar-wrapper stage-${progress.stage}">
          <div class="avatar-aura"></div>
          <img src="assets/miacis-logo.png" class="miacis-avatar" alt="ミアキス">
        </div>
        <div class="evolution-progress-box">
          <div class="evolution-label">${evolutionLabel}</div>
          <div class="evolution-bar-bg">
            <div class="evolution-bar-fill" style="width: ${stageProg.percent}%;"></div>
          </div>
        </div>
        <div class="stats-chips">
          <div class="chip">🔥 <strong>${progress.streak_days}</strong> 日連続</div>
          <div class="chip">🎴 カード: あと <strong>${packStatus.remaining}</strong> 回</div>
        </div>
      </div>

      <div class="tier-box">
        <div>
          <div class="tier-title">${tierToLabel(summary.tier)}</div>
          <div style="font-size: 14px; color: var(--text-muted);">${gradeToLabel(summary.grade)}</div>
        </div>
        <div class="tier-detail">
          <div>段内順位: <strong>${learnRankStr}</strong></div>
          <div>コミット順位: <strong>${commitRankStr}</strong></div>
          <div style="font-size: 12px; margin-top: 4px;">${lastWeekDiff}</div>
        </div>
      </div>

      <div class="points-grid">
        <div class="point-box">
          <div class="point-label">今週の学習</div>
          <div class="point-val">${summary.learn_points}</div>
        </div>
        <div class="point-box">
          <div class="point-label">今週のコミット</div>
          <div class="point-val">${summary.commit_points}</div>
        </div>
      </div>

      <div class="notice-line">毎週月曜に0からスタート</div>

      <div style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px;">
        <button class="btn-primary" id="go-battle" style="font-size: 20px; min-height: 60px;">対戦する</button>
        <button class="btn-secondary" id="go-content">今週の英語</button>
        <button class="btn-secondary" id="go-ranking">ランキング</button>
        <button class="btn-pink" id="go-zukan">単語図鑑（カード集め）</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <button class="btn-sub" id="go-me">自分の記録</button>
        ${state.isStaff ? '<button class="btn-sub" id="go-staff" style="border-color: var(--primary);">スタッフ画面</button>' : ''}
      </div>

      <footer class="app-footer">
        <p><a href="credits.html">単語データの出典（クレジット）</a></p>
      </footer>
    `;

    document.getElementById('go-battle').addEventListener('click', () => {
      window.location.hash = '#/battle';
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

    const area = document.getElementById('battle-area');
    area.innerHTML = `
      <div class="card" style="text-align: center; padding: 32px 16px;">
        <div style="font-size: 22px; font-weight: 800; margin-bottom: 8px;">${escapeHtml(oppName)}</div>
        <div style="font-size: 15px; color: var(--text-muted); margin-bottom: 24px;">10問・各問6秒</div>
        <button class="btn-primary" id="btn-start-countdown" style="font-size: 20px;">スタート！</button>
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
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
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
    <button class="btn-choice" data-choice="${idx}">${escapeHtml(choice)}</button>
  `
    )
    .join('');

  const comboHtml = state.battle.combo >= 3
    ? `<div class="combo-container"><div class="combo-badge">🔥 ${state.battle.combo} COMBO!</div></div>`
    : `<div class="combo-container"></div>`;

  area.innerHTML = `
    <div class="battle-header">
      <span class="q-counter">第 ${qIndex + 1} / 10 問</span>
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

    // 今日のカードパック残り状況を取得
    let packRemaining = 0;
    try {
      const ps = await getPackStatus();
      packRemaining = ps.remaining;
    } catch {}

    const isPerfect = result.correct === 10;
    let packSectionHtml = '';

    if (packRemaining > 0) {
      packSectionHtml = `
        <div class="card" style="text-align: center; padding: 20px 16px; margin-top: 14px; border: 2px solid var(--miacis-yellow);">
          ${isPerfect ? '<div style="font-size: 16px; font-weight: 900; color: var(--miacis-yellow); margin-bottom: 8px;">✨ パーフェクト！ SR以上確定！</div>' : ''}
          <div style="font-size: 15px; margin-bottom: 12px;">対戦おつかれさま！ 今日のカードパックを引けるよ</div>
          <button class="btn-primary" id="btn-open-pack" style="font-size: 19px; min-height: 56px;">
            🎴 カードパックを開ける (本日あと${packRemaining}回)
          </button>
        </div>
      `;
    }

    if (!area) return;

    area.innerHTML = `
      <div class="result-banner ${isWin ? 'win' : 'lose'}">
        <div class="result-text">${isWin ? 'かち！' : 'まけ'}</div>
        <div class="result-sub">あなた: ${result.correct}問正解 (${mySec}秒)</div>
        <div class="result-sub">${escapeHtml(result.opponent.nickname)}: ${result.opponent.correct}問正解 (${oppSec}秒)</div>
      </div>

      <div class="points-grid">
        <div class="point-box">
          <div class="point-label">獲得学習ポイント</div>
          <div class="point-val">+${result.learn_points}</div>
        </div>
        <div class="point-box">
          <div class="point-label">獲得コミットポイント</div>
          <div class="point-val">+${result.commit_points}</div>
        </div>
      </div>

      ${packSectionHtml}

      <div class="card-title" style="margin-top: 20px;">問題の振り返り</div>
      <div class="review-list">
        ${questionsReview}
      </div>

      <button class="btn-secondary" id="btn-match-finish-home" style="margin-top: 14px;">ホームへ戻る</button>
    `;

    document.getElementById('btn-match-finish-home').addEventListener('click', async () => {
      await checkEvolutionAfterMatch();
      window.location.hash = '#/home';
    });

    const openPackBtn = document.getElementById('btn-open-pack');
    if (openPackBtn) {
      openPackBtn.addEventListener('click', async () => {
        openPackBtn.disabled = true;
        openPackBtn.textContent = '開封中...';
        await handleOpenPackModal(result.match_id);
      });
    }
  } catch (err) {
    if (area) {
      area.innerHTML = `
        <div class="alert alert-error">${escapeHtml(err.message)}</div>
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
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
    const collection = await getMyCollection();
    const contentEl = document.getElementById('zukan-content');
    if (!contentEl) return;

    const bandStat = collection.bands.find(b => b.band === state.zukanTab) || { total: 0, collected: 0 };
    const percent = bandStat.total > 0 ? Math.round((bandStat.collected / bandStat.total) * 100) : 0;
    const bandCards = collection.cards.filter(c => c.band === state.zukanTab);

    let cardsHtml = '';
    if (bandCards.length === 0) {
      cardsHtml = `<div class="card" style="text-align: center; color: var(--text-muted); padding: 30px 16px;">この段のカードはまだ持っていません。<br>対戦後のカードパックで手に入れよう！</div>`;
    } else {
      const itemsHtml = bandCards.map(c => {
        const rInfo = rarityInfo(c.rarity);
        return `
          <div class="zukan-card-item rarity-${c.rarity}">
            <div class="zukan-item-en">${escapeHtml(c.en)}</div>
            <div class="zukan-item-ja">${escapeHtml(c.ja)}</div>
            <div class="zukan-item-footer">
              <span style="font-weight: 800; color: ${rInfo.color};">${rInfo.code}</span>
              ${c.count > 1 ? `<span style="font-weight: 700; color: var(--text-muted);">×${c.count}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');

      cardsHtml = `<div class="zukan-grid">${itemsHtml}</div>`;
    }

    const uncollectedCount = Math.max(0, bandStat.total - bandStat.collected);

    contentEl.innerHTML = `
      <div class="zukan-progress-card">
        <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; margin-bottom: 6px;">
          <span>段${state.zukanTab} 収集率</span>
          <span>${bandStat.collected} / ${bandStat.total} 語 (${percent}%)</span>
        </div>
        <div class="evolution-bar-bg">
          <div class="evolution-bar-fill" style="width: ${percent}%;"></div>
        </div>
      </div>

      ${cardsHtml}

      ${uncollectedCount > 0 ? `
        <div class="card" style="text-align: center; color: var(--text-muted); font-size: 14px; padding: 12px;">
          ？ 残り ${uncollectedCount} 語が未発見
        </div>
      ` : ''}

      <div class="zukan-prob-card">
        <div style="font-weight: 800; color: var(--text); margin-bottom: 4px;">🎴 カードパック出現確率</div>
        <div>・通常: N 70% / R 22% / SR 7% / UR 1%</div>
        <div>・全問正解時: SR 88% / UR 12%（SR以上確定！）</div>
        <div style="margin-top: 6px; font-size: 12px;">※カードは1日3回まで対戦後に引くことができます。</div>
      </div>
    `;
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
          <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
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
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
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
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
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
      <button id="tab-learn" class="tab-btn ${state.rankingTab === 'learn' ? 'active' : ''}">学習（自分の段）</button>
      <button id="tab-commit" class="tab-btn ${state.rankingTab === 'commit' ? 'active' : ''}">コミット（全員）</button>
    </div>

    <div class="notice-line">コミットポイントは1日10点まで。毎日ちょっとずつが強い</div>

    <div id="ranking-container">読み込み中...</div>

    <div style="margin-top: 16px;">
      <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
    </div>
  `;

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    const nextMuted = toggleMute();
    document.getElementById('btn-mute-toggle').textContent = nextMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-back-home').addEventListener('click', () => {
    window.location.hash = '#/home';
  });

  const tabLearn = document.getElementById('tab-learn');
  const tabCommit = document.getElementById('tab-commit');

  tabLearn.addEventListener('click', () => {
    state.rankingTab = 'learn';
    tabLearn.classList.add('active');
    tabCommit.classList.remove('active');
    loadRankingData();
  });

  tabCommit.addEventListener('click', () => {
    state.rankingTab = 'commit';
    tabCommit.classList.add('active');
    tabLearn.classList.remove('active');
    loadRankingData();
  });

  await loadRankingData();
}

async function loadRankingData() {
  const container = document.getElementById('ranking-container');
  if (!container) return;
  container.innerHTML = '読み込み中...';

  try {
    let rows = [];
    if (state.rankingTab === 'learn') {
      rows = await getRankingLearn(state.player.tier);
    } else {
      rows = await getRankingCommit();
    }

    if (rows.length === 0) {
      container.innerHTML = '<div class="card" style="text-align: center;">まだランキングデータがありません</div>';
      return;
    }

    const itemsHtml = rows.map(r => {
      const myRow = isMyRow(r, state.player.nickname);
      const rankText = formatRank(r.rank);
      const pts = state.rankingTab === 'learn' ? r.learn_points : r.commit_points;
      const tierText = tierToLabel(r.tier);

      return `
        <div class="ranking-item ${myRow ? 'is-me' : ''}">
          <div class="rank-col">${rankText}</div>
          <div class="nick-col">${escapeHtml(r.nickname)}</div>
          <div class="tier-col">${tierText}</div>
          <div class="pts-col">${pts}点</div>
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
    const weeklyResults = await getMyWeeklyResults();
    const writings = await getMyWritings();

    const container = document.getElementById('me-container');
    if (!container) return;

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
      <div class="card-title">週ごとの記録</div>
      <div style="margin-bottom: 24px;">
        ${weeklyHtml}
      </div>

      <div class="card-title">書いた一言とスタッフのスタンプ</div>
      <div style="margin-bottom: 24px;">
        ${writingsHtml}
      </div>

      <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
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
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
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
    <div id="staff-container">読み込み中...</div>
  `;

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    const nextMuted = toggleMute();
    document.getElementById('btn-mute-toggle').textContent = nextMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-back-home').addEventListener('click', () => {
    window.location.hash = '#/home';
  });

  try {
    const unapproved = await getUnapprovedContents();
    const writings = await getRecentWritings();

    const container = document.getElementById('staff-container');
    if (!container) return;

    // 未承認コンテンツ
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

    // 生徒の一言
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
      <div class="card-title">未承認の今週の英語</div>
      <div style="margin-bottom: 24px;">
        ${unapprovedHtml}
      </div>

      <div class="card-title">今週の一言一覧（スタンプを押す）</div>
      <div style="margin-bottom: 24px;">
        ${writingsHtml}
      </div>

      <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
    `;

    // 承認イベント
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

    // スタンプイベント
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
  } catch (err) {
    const container = document.getElementById('staff-container');
    if (container) {
      container.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }
}

// 起動
init();
