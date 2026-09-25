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
  startMatch,
  submitMatch,
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
  tierToLabel
} from './logic.js';

// グローバル状態
const state = {
  session: null,
  player: null,
  isStaff: false,
  currentHash: window.location.hash || '#/home',
  battle: {
    matchId: null,
    opponent: null,
    questions: [],
    answers: [],
    currentIndex: 0,
    startTime: 0,
    timerId: null,
    timerIntervalId: null,
    resultData: null
  },
  rankingTab: 'learn' // 'learn' | 'commit'
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
    <header class="app-header" style="justify-content: center;">
      <h1 class="app-title">ミアキス 英単語バトル</h1>
    </header>

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
        await signUpPlayer(nick, pass, gradeVal);
      } else {
        await signInPlayer(nick, pass);
      }

      state.session = await getSession();
      state.player = await getMyPlayer();
      state.isStaff = await isStaffUser();
      window.location.hash = '#/home';
      render();
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'register' ? 'はじめる' : 'ログイン';
    }
  });
}

/**
 * ホーム画面 (#/home)
 */
async function renderHome() {
  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">英単語バトル</h1>
      <div class="header-user">
        <span>${state.player.nickname} さん</span>
        <button class="btn-logout" id="btn-logout">ログアウト</button>
      </div>
    </header>
    <div id="home-content">読み込み中...</div>
  `;

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
    const summary = await getMySummary();

    const learnRankStr = summary.learn_rank_in_tier ? `${summary.learn_rank_in_tier}位` : '集計中';
    const commitRankStr = summary.commit_rank ? `${summary.commit_rank}位` : '集計中';

    let lastWeekDiff = '先週のデータなし';
    if (summary.last_week) {
      const lw = summary.last_week;
      lastWeekDiff = `先週: 段${lw.tier_before} → 段${lw.tier_after}（${lw.learn_points}点）`;
    }

    const homeContent = document.getElementById('home-content');
    if (!homeContent) return;

    homeContent.innerHTML = `
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
        <button class="btn-primary" id="go-battle">対戦する</button>
        <button class="btn-secondary" id="go-content">今週の英語</button>
        <button class="btn-secondary" id="go-ranking">ランキング</button>
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
      homeContent.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  }
}

/**
 * 対戦画面 (#/battle)
 */
async function renderBattle() {
  cleanBattleTimers();

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">英単語バトル</h1>
      <button class="btn-logout" id="btn-back-home">戻る</button>
    </header>
    <div id="battle-area">マッチング中...</div>
  `;

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

    const oppName = matchData.opponent.is_practice
      ? '練習相手と勝負'
      : `${matchData.opponent.nickname} さんの記録と勝負`;

    const area = document.getElementById('battle-area');
    area.innerHTML = `
      <div class="card" style="text-align: center; padding: 32px 16px;">
        <div style="font-size: 22px; font-weight: 700; margin-bottom: 8px;">${oppName}</div>
        <div style="font-size: 15px; color: var(--text-muted); margin-bottom: 24px;">10問・各問6秒</div>
        <button class="btn-primary" id="btn-start-countdown">スタート！</button>
      </div>
    `;

    document.getElementById('btn-start-countdown').addEventListener('click', () => {
      startQuestion(0);
    });
  } catch (err) {
    const area = document.getElementById('battle-area');
    if (area) {
      area.innerHTML = `
        <div class="alert alert-error">${err.message}</div>
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
    <button class="btn-choice" data-choice="${idx}">${choice}</button>
  `
    )
    .join('');

  area.innerHTML = `
    <div class="battle-header">
      <span class="q-counter">第 ${qIndex + 1} / 10 問</span>
    </div>

    <div class="timer-bar-bg">
      <div id="timer-bar" class="timer-bar-fill"></div>
    </div>

    <div class="word-prompt">${q.prompt}</div>

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

  // 6秒タイマー
  state.battle.timerId = setTimeout(() => {
    recordAnswerAndNext(null, 6000);
  }, duration);

  const choiceBtns = area.querySelectorAll('.btn-choice');
  choiceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const choiceIdx = parseInt(btn.dataset.choice, 10);
      const elapsedMs = Math.min(6000, Math.round(performance.now() - state.battle.startTime));
      recordAnswerAndNext(choiceIdx, elapsedMs);
    });
  });
}

function recordAnswerAndNext(choice, ms) {
  cleanBattleTimers();
  state.battle.answers.push({ choice, ms });
  startQuestion(state.battle.currentIndex + 1);
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
            <div style="font-weight: 700;">${q.prompt}</div>
            <div style="font-size: 13px; color: var(--text-muted);">
              正解: ${correctText} ${!isCorrect ? `(あなた: ${userText})` : ''}
            </div>
          </div>
          <div class="review-mark ${isCorrect ? 'correct' : 'wrong'}" aria-label="${isCorrect ? '正解' : '不正解'}">${isCorrect ? '○' : '×'}</div>
        </div>
      `;
    }).join('');

    if (!area) return;

    area.innerHTML = `
      <div class="result-banner ${isWin ? 'win' : 'lose'}">
        <div class="result-text">${isWin ? 'かち！' : 'まけ'}</div>
        <div class="result-sub">あなた: ${result.correct}問正解 (${mySec}秒)</div>
        <div class="result-sub">${result.opponent.nickname}: ${result.opponent.correct}問正解 (${oppSec}秒)</div>
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

      <div class="card-title">10問の正解</div>
      <div class="review-list">
        ${questionsReview}
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px;">
        <button class="btn-primary" id="btn-replay">もう一度対戦する</button>
        <button class="btn-secondary" id="btn-result-home">ホームに戻る</button>
      </div>
    `;

    document.getElementById('btn-replay').addEventListener('click', () => {
      renderBattle();
    });
    document.getElementById('btn-result-home').addEventListener('click', () => {
      window.location.hash = '#/home';
    });
  } catch (err) {
    if (area) {
      area.innerHTML = `
        <div class="alert alert-error">${err.message}</div>
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
      `;
    }
  }
}

/**
 * 今週の英語画面 (#/content)
 */
async function renderContent() {
  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">今週の英語</h1>
      <button class="btn-logout" id="btn-back-home">戻る</button>
    </header>
    <div id="content-area">読み込み中...</div>
  `;

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
              <label class="form-label">${idx + 1}. ${item.prompt}</label>
              <input class="form-input quiz-input" data-index="${idx}" type="text" placeholder="英単語を入力">
            </div>
          `;
        } else {
          const choices = item.choices || [];
          const opts = choices.map(c => `
            <label style="display: block; margin-bottom: 6px; font-size: 16px;">
              <input type="radio" name="quiz_opt_${idx}" value="${c}" class="quiz-choice" data-index="${idx}"> ${c}
            </label>
          `).join('');
          return `
            <div class="form-group">
              <label class="form-label">${idx + 1}. ${item.prompt}</label>
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
      promptGuide = `この単語のどれかを使って1文: <strong>${(prompt.words || []).join(', ')}</strong>`;
    } else if (prompt.type === 'three_words') {
      promptGuide = '3語で感想を書いてね';
    } else if (prompt.type === 'what_would_you_do') {
      promptGuide = '5語以上で、自分ならどうする？';
    }

    if (myWriting) {
      const stampText = myWriting.stamp ? `スタッフからのスタンプ: ${myWriting.stamp}` : 'スタッフ確認中';
      writingHtml = `
        <div class="card">
          <div class="card-title">今週の一言</div>
          <p style="font-size: 16px; margin-bottom: 10px;">${myWriting.text}</p>
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
        <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 12px;">${currentContent.title}</h2>
        ${videoHtml}
        <a href="${currentContent.url}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="margin-top: 8px;">
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
          alertBox.innerHTML = `<div class="alert alert-error">${check.error}</div>`;
          return;
        }

        try {
          await submitWriting(currentContent.id, text);
          renderContent();
        } catch (err) {
          alertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
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
            propAlert.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
          }
        });
      }
    }
  } catch (err) {
    const area = document.getElementById('content-area');
    if (area) {
      area.innerHTML = `
        <div class="alert alert-error">${err.message}</div>
        <button class="btn-secondary" onclick="window.location.hash='#/home'">ホームへ戻る</button>
      `;
    }
  }
}

/**
 * ランキング画面 (#/ranking)
 */
async function renderRanking() {
  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">ランキング</h1>
      <button class="btn-logout" id="btn-back-home">戻る</button>
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
          <div class="nick-col">${r.nickname}</div>
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
    container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

/**
 * 自分の記録画面 (#/me)
 */
async function renderMe() {
  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">自分の記録</h1>
      <button class="btn-logout" id="btn-back-home">戻る</button>
    </header>
    <div id="me-container">読み込み中...</div>
  `;

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
        const stampStr = w.stamp ? `スタッフのスタンプ: ${w.stamp}` : 'スタッフ確認中';
        return `
          <div class="card" style="padding: 12px 16px; margin-bottom: 10px;">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">${dateStr}</div>
            <div style="font-size: 15px; margin-bottom: 6px;">${w.text}</div>
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
      container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
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

  appEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">スタッフ画面</h1>
      <button class="btn-logout" id="btn-back-home">戻る</button>
    </header>
    <div id="staff-container">読み込み中...</div>
  `;

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
          <div style="font-weight: 700; font-size: 17px; margin-bottom: 6px;">${item.title}</div>
          <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px; word-break: break-all;">
            URL: <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.url}</a>
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

        const currentStamp = w.stamp ? `現在: ${w.stamp}` : '未スタンプ';

        return `
          <div class="card" style="margin-bottom: 12px;">
            <div style="font-size: 16px; margin-bottom: 6px;">${w.text}</div>
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
      container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  }
}

// 起動
init();
