/**
 * challenge.js - 連続チャレンジ（#/streak）と 100本ノック（#/knock）
 *
 * 対戦と違い、1問ずつサーバーに答えを送り、正誤と次の問題を受け取る。
 * 正解・制限時間・記録はサーバーが持つ（ここでは表示と時間の計測だけ）。
 */
import { startRun, answerRun, reviveRun, endRun, getMyRunBests, getRankingStreak, getRankingKnock, pickCard, useFifty, skipQuestion, getMyMeta, getMyStages } from './api.js';
import { renderMiacis } from './look.js';
import {
  escapeHtml,
  streakStage,
  streakPressureLabel,
  formatSeconds,
  knockGrade,
  liveRank,
  passedPlayers,
  withStaffTag,
  KNOCK_LEVELS,
  savedKnockBand,
  saveKnockBand,
  CARDS,
  START_STAGES,
  startStageUnlocked,
  nextMetaUnlock,
  savedStreakBand,
  saveStreakBand,
  tierLabel
} from './logic.js';
import { playSfx, triggerConfetti, isMuted, toggleMute, vibrate } from './game.js';

const REVIVE_SECONDS = 5;
const KNOCK_TOTAL = 100;

const MODES = {
  streak: {
    title: '連続チャレンジ',
    lead: '間違えたら終わり。',
    rules: ['1問 7秒から', '10問ごと 時間↓', '選択肢がどんどん細かく', '❤️ 復活 1回']
  },
  knock: {
    title: '100本ノック',
    lead: '100問 ノンストップ。',
    rules: ['1問 6秒', '間違えても止まらない', '記録は 100本完走で', 'レベルごとに順位']
  }
};

// 進行中の回（画面を離れたら stopChallenge で止める）
const run = {
  mode: null,
  id: null,
  q: null,
  score: 0,
  answered: 0,
  reviveUsed: false,
  best: null,
  weekBest: null,
  board: [],          // 自分以外の今週ベスト（いまの順位の計算用）
  nickname: '',
  rankUp: null,       // 次の問題の画面で見せる「◯位に浮上」
  milestone: null,    // 100本ノックの 10本ごとの区切り
  look: null,         // 相棒の着せ替え（HUD の小さなミアキス用）
  depth: 0,           // 到達 = スタート地点のぶん + 連続（記録とランキングはこれ）
  startStage: 1,
  inv: { shields: 0, fifties: 0, skips: 0, time_bonus_ms: 0, coin_mult: 1, cards: [] },
  meta: null,         // 系統樹（始めたときの値。リザルトで差分を見せる）
  pendingStage: null, // カードを選ぶ画面に出す STAGE
  mood: '',           // 相棒の表情: happy / ouch / wow
  startedAt: 0,
  timers: [],
  busy: false,
  callbacks: {}
};

function later(fn, ms) {
  run.timers.push(setTimeout(fn, ms));
}

function clearTimers() {
  run.timers.forEach(t => clearTimeout(t));
  run.timers.forEach(t => clearInterval(t));
  run.timers = [];
}

/**
 * 画面を離れるときに呼ぶ。やりかけの回はサーバーが次の開始時に締める
 */
export function stopChallenge() {
  clearTimers();
  run.id = null;
  run.q = null;
  run.busy = false;
}

function area() {
  return document.getElementById('challenge-area');
}

// 不正解・時間切れの一撃（桜井: 画面振動・ヒットストップ）。reduced-motion では揺らさない
function shake(el) {
  if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

/**
 * @param {HTMLElement} containerEl
 * @param {'streak'|'knock'} mode
 * @param {{onGoHome?: Function, onGoRanking?: Function, onNuts?: Function, nickname?: string}} callbacks
 */
export async function renderChallengeView(containerEl, mode, callbacks = {}) {
  stopChallenge();
  run.mode = mode;
  run.callbacks = callbacks;
  run.nickname = callbacks.nickname || '';
  run.look = callbacks.look || null;
  const conf = MODES[mode];

  containerEl.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">${conf.title}</h1>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn-mute" id="btn-mute-toggle" aria-label="効果音ミュート切り替え">${isMuted() ? '🔇' : '🔊'}</button>
        <button class="btn-logout" id="btn-challenge-back">戻る</button>
      </div>
    </header>
    <div id="challenge-area" class="challenge-${mode}">読み込み中...</div>
  `;

  document.getElementById('btn-mute-toggle').addEventListener('click', () => {
    document.getElementById('btn-mute-toggle').textContent = toggleMute() ? '🔇' : '🔊';
  });
  document.getElementById('btn-challenge-back').addEventListener('click', () => {
    const id = run.id;
    stopChallenge();
    if (id) endRun(id).catch(() => {});
    callbacks.onGoHome?.();
  });

  let bests = null;
  let meta = null;
  try {
    [bests, meta] = await Promise.all([getMyRunBests(), mode === 'streak' ? getMyStages() : Promise.resolve(null)]);
  } catch {
    bests = bests || null;
  }
  run.meta = meta;
  const a = area();
  if (!a || run.mode !== mode) return;

  const best = bests?.[mode];
  const weekBest = bests?.[`${mode}_week`];
  const bestText = (b) => {
    if (!b) return '—';
    return mode === 'streak' ? `${b.correct}連続` : `${b.correct} / ${KNOCK_TOTAL}`;
  };

  a.innerHTML = `
    <div class="card challenge-intro">
      <span class="eyebrow">${conf.lead}</span>
      <div class="challenge-rules">${conf.rules.map(r => `<span>${r}</span>`).join('')}</div>
      ${mode === 'knock' ? `<div class="tab-bar knock-levels" role="group" aria-label="レベル">${KNOCK_LEVELS.map(l => `<button class="tab-btn ${l.band === savedKnockBand() ? 'active' : ''}" data-band="${l.band}" aria-pressed="${l.band === savedKnockBand()}">${l.label}<small style="display:block; font-size:10px; font-weight:500;">${l.sub}</small></button>`).join('')}</div>` : ''}
      ${mode === 'streak' && meta ? stageGatesHtml(meta) : ''}
      ${mode === 'streak' ? '' : `<div class="challenge-bests">`}
      ${mode === 'streak' ? '' : `<div><span>今週ベスト</span><strong>${bestText(weekBest)}</strong></div>
        <div><span>自己ベスト</span><strong>${bestText(best)}</strong></div>
      </div>`}
      <button class="btn-primary" id="btn-challenge-start" style="font-size: 20px;">スタート</button>
    </div>
  `;
  document.getElementById('btn-challenge-start').addEventListener('click', () => begin(mode));
  a.querySelectorAll('.stage-gate[data-band]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.disabled) return;
    saveStreakBand(parseInt(btn.dataset.band, 10));
    a.querySelectorAll('.stage-gate[data-band]').forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
  }));
  a.querySelectorAll('.knock-levels [data-band]').forEach(btn => btn.addEventListener('click', () => {
    saveKnockBand(parseInt(btn.dataset.band, 10));
    a.querySelectorAll('.knock-levels [data-band]').forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
  }));

  if (/[?&]debug/.test(window.location.search)) {
    const panel = document.createElement('div');
    panel.className = 'debug-panel';
    panel.innerHTML = '<button data-d="rankup">浮上</button><button data-d="stage">STAGE</button><button data-d="shake">揺れ</button><button data-d="title">称号</button>';
    a.append(panel);
    panel.addEventListener('click', e => {
      const d = e.target.dataset.d;
      if (!d) return;
      const q = { no: 6, stage: 2, range: 2, limit_ms: 6600, prompt: 'debug', choices: ['a', 'b', 'c', 'd'] };
      run.score = 7; run.board = [{ nickname: 'テスト', score: 6 }];
      if (d === 'rankup') { run.rankUp = { rank: 2, passed: ['テスト'] }; playSfx('rankUp'); showQuestion(q); }
      if (d === 'stage') showStageUp(q);
      if (d === 'shake') { showQuestion(q); shake(area()); vibrate('wrong'); }
      if (d === 'title') { run.id = null; showResult({ mode, correct: 10, answered: 11, end_reason: 'wrong', learn_points: 10, nuts: 4, nuts_raw: 4, missed: [], best: { correct: 10 }, week_best: { correct: 10 }, new_best: true, week_rank: 1, new_titles: [{ id: 'title_streak10', name: '10連続サバイバー' }] }); }
    });
  }
}

async function begin(mode) {
  const a = area();
  if (!a) return;
  a.innerHTML = '<div class="card" style="text-align:center; padding:32px 16px;">用意中…</div>';
  try {
    const res = await startRun(mode, mode === 'knock' ? savedKnockBand() : savedStreakBand());
    if (run.mode !== mode || !area()) return;
    run.id = res.run_id;
    run.score = 0;
    run.answered = 0;
    run.reviveUsed = false;
    run.best = res.best ? res.best.correct : null;
    run.weekBest = res.week_best ? res.week_best.correct : null;
    run.depth = res.depth || 0;
    run.startStage = 1;
    run.band = res.band || 1;
    run.inv = res.inventory || run.inv;
    run.startedAt = performance.now();
    run.rankUp = null;
    run.board = [];
    if (res.offer) {
      run.pendingStage = run.startStage;
      showCards(res.offer, true);
    } else {
      showQuestion(res.question);
    }
    // 他の人の今週ベスト（いまの順位の計算用）。遅れて届いても次の問題から効く
    const fetchBoard = mode === 'streak' ? getRankingStreak('week', res.band) : getRankingKnock(res.band);
    fetchBoard.then(rows => {
      if (run.id !== res.run_id) return;
      run.board = (rows || [])
        .filter(r => r.nickname !== run.nickname)
        .map(r => ({ nickname: withStaffTag(r.nickname, r.is_staff), score: mode === 'streak' ? r.best_streak : r.best_correct }));
    }).catch(() => {});
  } catch (err) {
    showError(err);
  }
}

// いまやめたときの記録（今週ベストは残るので、それより下には落ちない）
function effectiveScore() {
  return Math.max(run.score, run.weekBest || 0);
}

function rankPillHtml() {
  if (!run.board.length && !run.weekBest && run.score === 0) return '';
  const lr = liveRank(effectiveScore(), run.board);
  return `<span class="rank-pill" aria-label="いまやめたら今週 ${lr.rank} 位">いま <strong>${lr.rank}</strong>位</span>`;
}

function chaseLabel() {
  // すぐ上の人まで3問以内なら、そちらを先に言う（自己ベストより人のほうが燃える）
  const lr = liveRank(effectiveScore(), run.board);
  if (lr.next && lr.next.gap <= 3) {
    return lr.next.gap === 1
      ? `あと1問で ${escapeHtml(lr.next.nickname)} を抜く`
      : `${escapeHtml(lr.next.nickname)} まで あと${lr.next.gap}問`;
  }
  if (run.mode === 'streak') return streakPressureLabel(run.score, run.best);
  return '';
}

function headerHtml(q) {
  if (run.mode === 'streak') {
    const st = streakStage(run.depth);
    const pressure = chaseLabel();
    return `
      <div class="streak-hud">
        <div class="streak-count"><span class="hud-miacis mood-${run.mood}" aria-hidden="true">${renderMiacis(run.look, 48)}<i class="mood-mark"></i></span><span>連続</span><strong>${run.score}</strong>${rankPillHtml()}</div>
        <div class="streak-meta">
          <span class="stage-pill">${STAGE_NAMES[run.band] || ''}</span>
          <span class="stage-steps" aria-label="次のペースまであと${10 - (run.score % 10)}問">${Array.from({ length: 10 }, (_, i) => `<i class="${i < run.score % 10 ? 'done' : ''}"></i>`).join('')}</span>
          <span class="revive-life" aria-label="${run.reviveUsed ? '復活は使用済み' : '復活が1回残っている'}">${run.reviveUsed ? '🖤' : '❤️'}</span>
        </div>
      </div>
      ${invHtml()}
      <div class="pressure-line" aria-live="polite">${pressure}</div>
    `;
  }
  return `
    <div class="battle-header">
      <span class="q-counter">${q.no} / ${KNOCK_TOTAL}</span>
      <span class="knock-score">正解 <strong>${run.score}</strong> ${rankPillHtml()}</span>
    </div>
    <div class="pressure-line" aria-live="polite">${chaseLabel()}</div>
    <div class="knock-progress" aria-hidden="true"><i style="width:${(run.answered / KNOCK_TOTAL) * 100}%"></i></div>
  `;
}

function showQuestion(q) {
  clearTimers();
  run.q = q;
  run.busy = false;
  const a = area();
  if (!a) return;

  a.innerHTML = `
    ${headerHtml(q)}
    <div class="timer-bar-bg"><div id="timer-bar" class="timer-bar-fill"></div></div>
    <div class="timer-label"><span id="timer-sec">${(q.limit_ms / 1000).toFixed(1)}</span> 秒</div>
    ${q.tier ? `<div class="tier-tag tier-${q.tier}">${tierLabel(q.tier)}</div>` : ''}
    <div class="word-prompt">${escapeHtml(q.prompt)}</div>
    <div class="choices-list">
      ${q.choices.map((c, i) => `<button class="btn-choice" data-choice="${i}"><span class="choice-number" aria-hidden="true">${i + 1}</span><span>${escapeHtml(c)}</span></button>`).join('')}
    </div>
    ${run.mode === 'knock' ? '<button class="btn-sub" id="btn-knock-quit" style="margin-top:14px;">やめる <small>記録は残らない</small></button>' : ''}
  `;

  if (run.shieldToast) {
    run.shieldToast = false;
    const toast = document.createElement('div');
    toast.className = 'rank-up-toast milestone';
    toast.setAttribute('role', 'status');
    toast.innerHTML = '<strong>🛡 たてで守った！</strong><span>連続はそのまま</span>';
    a.prepend(toast);
    later(() => toast.remove(), 1300);
  }

  if (run.milestone) {
    const n = run.milestone;
    run.milestone = null;
    const toast = document.createElement('div');
    toast.className = 'rank-up-toast milestone';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<strong><em>${n}</em>本！</strong><span>正解 ${run.score}</span>`;
    a.prepend(toast);
    later(() => toast.remove(), 1100);
  }

  if (run.rankUp) {
    const { rank, passed } = run.rankUp;
    run.rankUp = null;
    const toast = document.createElement('div');
    toast.className = 'rank-up-toast';
    toast.setAttribute('role', 'status');
    const who = passed.length ? `${escapeHtml(passed[0])}${passed.length > 1 ? ` ほか${passed.length - 1}人` : ''} を抜いた` : '';
    toast.innerHTML = `<strong><em>${rank}</em>位に浮上！</strong><span>${who}</span>`;
    a.prepend(toast);
    later(() => toast.remove(), 1400);
  }

  const started = performance.now();
  const limit = q.limit_ms;
  const bar = document.getElementById('timer-bar');
  const sec = document.getElementById('timer-sec');

  run.timers.push(setInterval(() => {
    const left = Math.max(0, limit - (performance.now() - started));
    if (bar) {
      bar.style.width = `${(left / limit) * 100}%`;
      bar.classList.toggle('danger', left / limit < 0.3);
    }
    if (sec) sec.textContent = (left / 1000).toFixed(1);
  }, 50));

  later(() => submit(null, limit, null), limit);

  a.querySelector('#btn-use-fifty')?.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    try {
      const res = await useFifty(run.id);
      run.inv = res.inventory;
      (res.hidden || []).forEach(i => { const b = a.querySelector(`.btn-choice[data-choice="${i}"]`); if (b) { b.disabled = true; b.classList.add('cut'); } });
      playSfx('combo');
    } catch (err) { e.currentTarget.disabled = false; }
  });
  a.querySelector('#btn-use-skip')?.addEventListener('click', async e => {
    if (run.busy) return;
    run.busy = true;
    clearTimers();
    try {
      const res = await skipQuestion(run.id);
      run.inv = res.inventory;
      showQuestion(res.question);
    } catch (err) { showError(err); }
  });

  a.querySelectorAll('.btn-choice').forEach(btn => {
    // 判定（通信）より先に「押した」を返す（桜井: かまえは瞬時に極端に）
    btn.addEventListener('pointerdown', () => btn.classList.add('pressed'), { passive: true });
    btn.addEventListener('click', () => {
      const ms = Math.min(limit, Math.round(performance.now() - started));
      submit(parseInt(btn.dataset.choice, 10), ms, btn);
    });
  });

  document.getElementById('btn-knock-quit')?.addEventListener('click', () => finish(null));
}

async function submit(choice, ms, btn) {
  if (run.busy || !run.id) return;
  run.busy = true;
  clearTimers();
  const a = area();
  a?.querySelectorAll('.btn-choice').forEach(b => { b.disabled = true; });
  const prevStage = run.q?.stage;

  let res;
  try {
    res = await answerRun(run.id, choice, choice === null ? null : ms);
  } catch (err) {
    showError(err);
    return;
  }
  if (!area()) return;

  const buttons = a ? [...a.querySelectorAll('.btn-choice')] : [];
  run.mood = res.correct ? 'happy' : 'ouch';
  a?.querySelector('.hud-miacis')?.setAttribute('class', `hud-miacis mood-${run.mood}`);
  if (res.correct) {
    btn?.classList.add('choice-correct');
    playSfx('correct');
  } else {
    btn?.classList.add('choice-wrong');
    buttons[res.answer_index]?.classList.add('correct');
    playSfx('wrong');
    vibrate(res.timeout ? 'timeout' : 'wrong');
    shake(a);
  }

  const prevEff = effectiveScore();
  run.score = res.score;
  run.answered = res.answered;
  run.reviveUsed = res.revive_used;
  if (typeof res.depth === 'number') run.depth = res.depth;
  if (res.inventory) run.inv = res.inventory;
  if (res.shield_used) {
    run.mood = 'wow';
    run.shieldToast = true;
  }

  // 100本ノック: 10本ごとの小さな区切り（桜井: 喜びのスパンは短く）
  if (run.mode === 'knock' && res.state === 'next' && run.answered % 10 === 0) {
    run.milestone = run.answered;
    playSfx('combo');
  }

  // 順位が上がった？（今週ベストを越えて、誰かの記録を追い抜いたとき）
  if (res.correct && run.board.length) {
    const passed = passedPlayers(prevEff, effectiveScore(), run.board);
    if (passed.length) {
      run.rankUp = { rank: liveRank(effectiveScore(), run.board).rank, passed };
      playSfx('rankUp');
      vibrate('stageUp');
    }
  }

  if (res.state === 'finished') {
    later(() => showResult(res.result), res.correct ? 400 : 1100);
  } else if (res.state === 'revive_offer') {
    later(() => showRevive(), 600);
  } else if (res.state === 'card_offer') {
    run.mood = 'wow';
    playSfx('combo');
    vibrate('stageUp');
    run.pendingStage = Math.floor(run.depth / 5) + 1;
    later(() => showCards(res.offer, false), 400);
  } else if (run.mode === 'streak' && res.question.stage > prevStage) {
    run.mood = 'wow';
    playSfx('combo');
    vibrate('stageUp');
    later(() => showStageUp(res.question), 400);
  } else {
    later(() => showQuestion(res.question), res.correct ? 350 : 900);
  }
}

function invHtml() {
  const v = run.inv || {};
  const chips = [];
  if (v.shields > 0) chips.push(`<span class="inv-chip">🛡×${v.shields}</span>`);
  if (v.time_bonus_ms > 0) chips.push(`<span class="inv-chip">⏱+${v.time_bonus_ms / 1000}</span>`);
  if (v.coin_mult > 1) chips.push(`<span class="inv-chip">Mi×${v.coin_mult}</span>`);
  const fifty = v.fifties > 0 ? `<button class="inv-btn" id="btn-use-fifty">✂ 50:50 ×${v.fifties}</button>` : '';
  const skip = v.skips > 0 ? `<button class="inv-btn" id="btn-use-skip">↷ スキップ ×${v.skips}</button>` : '';
  if (!chips.length && !fifty && !skip) return '';
  return `<div class="inv-row">${chips.join('')}${fifty}${skip}</div>`;
}

function showCards(offer, atStart) {
  clearTimers();
  const a = area();
  if (!a) return;
  run.busy = true;
  a.innerHTML = `
    <div class="card-pick" role="dialog" aria-labelledby="card-pick-title">
      <span class="eyebrow">${atStart ? `STAGE ${run.startStage} から` : `到達 ${run.depth}`}</span>
      <h2 id="card-pick-title">${atStart ? '最初のカード' : `STAGE ${run.pendingStage}`}</h2>
      <p>${atStart ? '1枚選んでスタート' : '1枚選べ。この回だけ効く'}</p>
      <div class="card-options">
        ${offer.map(k => { const c = CARDS[k] || { icon: '?', name: k, desc: '' }; return `<button class="card-option" data-card="${k}"><span class="card-icon" aria-hidden="true">${c.icon}</span><strong>${c.name}</strong><small>${c.desc}</small></button>`; }).join('')}
      </div>
    </div>
  `;
  a.querySelectorAll('.card-option').forEach(btn => btn.addEventListener('click', async () => {
    a.querySelectorAll('.card-option').forEach(b => { b.disabled = true; });
    btn.classList.add('picked');
    playSfx('correct');
    try {
      const res = await pickCard(run.id, btn.dataset.card);
      run.inv = res.inventory;
      later(() => showQuestion(res.question), 350);
    } catch (err) {
      showError(err);
    }
  }));
}

function startStagesHtml(meta) {
  let saved = 1;
  try { saved = parseInt(localStorage.getItem('miacis_start_stage'), 10) || 1; } catch {}
  const maxDepth = meta?.max_depth || 0;
  if (!startStageUnlocked(saved, maxDepth)) saved = 1;
  run.startStage = saved;
  return `<div class="start-stages" role="group" aria-label="スタート地点">
    <span class="eyebrow">スタート</span>
    <div class="tab-bar">${START_STAGES.map(s => {
      const open = startStageUnlocked(s.stage, maxDepth);
      return `<button class="tab-btn ${s.stage === saved ? 'active' : ''}" data-stage="${s.stage}" ${open ? '' : 'disabled'} aria-pressed="${s.stage === saved}" title="${open ? '' : `STAGE ${s.stage} にたどり着くと開く`}">${open ? '' : '🔒'}STAGE ${s.stage}<small style="display:block; font-size:10px; font-weight:500;">${s.label}</small></button>`;
    }).join('')}</div>
  </div>`;
}

function metaHtml(meta) {
  const next = nextMetaUnlock(meta.level);
  const pct = next ? Math.min(100, Math.round(((meta.total_correct - (META_AT[meta.level] || 0)) / (next.at - (META_AT[meta.level] || 0))) * 100)) : 100;
  return `<div class="meta-tree">
    <div><span class="eyebrow">系統樹</span><strong>Lv ${meta.level}</strong><small>累計正解 ${meta.total_correct}</small></div>
    <div class="meta-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    <p>${next ? `あと <em class="num">${next.at - meta.total_correct}</em> 正解で「${next.unlock}」` : 'すべて解放した'}</p>
  </div>`;
}
const META_AT = { 1: 0, 2: 50, 3: 150, 4: 300, 5: 600 };
const META_UNLOCK = { 2: 'スキップのカード', 3: 'Mi×2 のカード', 4: '最初の1問の前にカード', 5: 'カードの候補が4枚に' };

const STAGE_NAMES = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: '最難関' };
const STAGE_SUBS = { 1: '中学前半', 2: '中学', 3: '高校', 4: '大学受験', 5: '学術語' };

function stageGatesHtml(stages) {
  let saved = savedStreakBand();
  const open = (stages || []).filter(s => s.unlocked).map(s => s.band);
  if (!open.includes(saved)) saved = 1;
  saveStreakBand(saved);
  return `<div class="stage-gates" role="group" aria-label="ステージ">
    ${(stages || []).map(s => {
      const best = s.best ? s.best.correct : null;
      const lock = s.unlocked ? '' : `<small class="lock">🔒 ${STAGE_NAMES[s.band - 1]}で${s.need}連続で開く</small>`;
      return `<button class="stage-gate ${s.band === saved ? 'active' : ''} ${s.completed ? 'done' : ''}" data-band="${s.band}" ${s.unlocked ? '' : 'disabled'} aria-pressed="${s.band === saved}">
        <strong>${STAGE_NAMES[s.band]}</strong><span>${STAGE_SUBS[s.band]} ・ ${s.words}語</span>
        ${s.unlocked ? `<em>${s.completed ? 'コンプリート済み' : best !== null ? `自己ベスト ${best}連続` : 'まだ挑戦していない'}</em>` : lock}
      </button>`;
    }).join('')}
  </div>`;
}

function showStageUp(q) {
  const a = area();
  if (!a) return;
  a.innerHTML = `
    <div class="stage-up" role="status">
      <span class="eyebrow">${run.score}連続</span>
      <strong>ペース ${q.stage}</strong>
      <p>1問 ${(q.limit_ms / 1000).toFixed(1)}秒${q.tier ? ` ・ ${tierLabel(q.tier)}` : ''}</p>
    </div>
  `;
  later(() => showQuestion(q), 1300);
}

function showRevive() {
  clearTimers();
  const a = area();
  if (!a) return;
  a.innerHTML = `
    <div class="card revive-card" role="alertdialog" aria-labelledby="revive-title">
      <span class="eyebrow">時間切れ ・ ${run.score}連続</span>
      <h2 id="revive-title">まだ、いける？</h2>
      <p>❤️ を使って次の問題へ。これが最後の1回</p>
      <div class="revive-count" aria-live="assertive"><strong id="revive-sec">${REVIVE_SECONDS}</strong></div>
      <div class="timer-bar-bg"><div id="revive-bar" class="timer-bar-fill danger"></div></div>
      <button class="btn-primary" id="btn-revive">❤️ 復活</button>
      <button class="btn-sub" id="btn-revive-no">やめる</button>
    </div>
  `;
  const started = performance.now();
  const total = REVIVE_SECONDS * 1000;
  run.timers.push(setInterval(() => {
    const left = Math.max(0, total - (performance.now() - started));
    const bar = document.getElementById('revive-bar');
    const sec = document.getElementById('revive-sec');
    if (bar) bar.style.width = `${(left / total) * 100}%`;
    if (sec) sec.textContent = String(Math.ceil(left / 1000));
  }, 50));
  later(() => finish(null), total);

  document.getElementById('btn-revive').addEventListener('click', async () => {
    if (run.busy === 'revive') return;
    run.busy = 'revive';
    clearTimers();
    try {
      const res = await reviveRun(run.id);
      if (res.state === 'finished') {
        showResult(res.result);
        return;
      }
      run.reviveUsed = true;
      playSfx('evolution');
      showQuestion(res.question);
    } catch (err) {
      showError(err);
    }
  });
  document.getElementById('btn-revive-no').addEventListener('click', () => finish(null));
}

async function finish() {
  if (!run.id) return;
  clearTimers();
  const id = run.id;
  try {
    const result = await endRun(id);
    showResult(result);
  } catch (err) {
    showError(err);
  }
}

function missedHtml(missed) {
  if (!missed || missed.length === 0) return '';
  return `
    <div class="card-title" style="margin-top: 20px;">${run.mode === 'streak' ? 'つまずいた単語' : '間違えた単語'}</div>
    <div class="review-list">
      ${missed.map(m => `
        <div class="review-item wrong">
          <div>
            <div style="font-weight: 700;">${escapeHtml(m.prompt)}</div>
            <div style="font-size: 13px; color: var(--text-muted);">正解 ${escapeHtml(m.correct_text)}${m.timeout ? ' ・ 時間切れ' : ` ・ あなた ${escapeHtml(m.your_text ?? '')}`}</div>
          </div>
          <div class="review-mark wrong" aria-label="不正解">×</div>
        </div>
      `).join('')}
    </div>
  `;
}

function showResult(result) {
  clearTimers();
  run.id = null;
  const a = area();
  if (!a || !result) return;
  const mode = run.mode;
  const isNewBest = Boolean(result.new_best);
  const isWeekBest = Boolean(result.new_week_best);
  const complete = result.end_reason === 'complete';

  if (isNewBest || isWeekBest || (mode === 'knock' && complete && result.correct >= 90)) {
    playSfx('win');
    triggerConfetti();
    vibrate('record');
  } else {
    playSfx('lose');
  }
  if (result.nuts > 0) run.callbacks.onNuts?.();
  const titles = Array.isArray(result.new_titles) ? result.new_titles : [];
  if (titles.length) { playSfx('evolution'); vibrate('record'); }

  let headline;
  let sub;
  if (mode === 'streak') {
    const depth = result.correct;
    headline = result.end_reason === 'complete'
      ? `<div class="record-badge">コンプリート！</div><div class="result-big">${depth}<small>連続</small></div>`
      : `<div class="result-big">${depth}<small>連続</small></div>`;
    sub = result.end_reason === 'complete' ? `${STAGE_NAMES[run.band]} の単語を全部クリア` : result.end_reason === 'timeout' ? '時間切れ！ 次は速く' : result.end_reason === 'wrong' ? `おしい！ 次は <em class="num">${depth + 1}</em> を越えろ` : 'おつかれ';
  } else if (complete) {
    const g = knockGrade(result.correct);
    headline = `<div class="knock-grade big">${g.mark}</div><div class="result-big">${result.correct}<small> / ${KNOCK_TOTAL}</small></div>`;
    sub = `${g.label} ・ ${formatSeconds(result.total_ms)}`;
  } else {
    headline = `<div class="result-big">${result.answered}<small>本</small></div>`;
    sub = `正解 <em class="num">${result.correct}</em>。次は100本 走りきれ`;
  }

  // 今週の順位と、すぐ上の相手（次にやる理由）
  let rankHtml = '';
  if (result.week_rank) {
    const rival = result.rival;
    let chase = '';
    if (result.week_rank === 1) {
      chase = '今週1位。追われる側だ';
    } else if (rival) {
      const gap = rival.correct + 1 - (result.week_best?.depth ?? result.week_best?.correct ?? result.correct);
      chase = mode === 'streak'
        ? `${withStaffTag(rival.nickname, rival.is_staff)}・${rival.correct}連続 まで あと${gap}問`
        : `${withStaffTag(rival.nickname, rival.is_staff)}・${rival.correct}問 まで あと${gap}問`;
    }
    rankHtml = `<div class="rank-card"><div><span>今週</span><strong>${result.week_rank}<small>位</small></strong></div><p>${chase}</p></div>`;
  }

  const recordBadge = isNewBest
    ? '<div class="record-badge">自己ベスト更新！</div>'
    : isWeekBest ? '<div class="record-badge">今週ベスト更新！</div>' : '';
  const bestLine = (label, b) => b ? `<div><span>${label}</span><strong>${mode === 'streak' ? `${b.correct}連続` : `${b.correct} / ${KNOCK_TOTAL}`}</strong></div>` : `<div><span>${label}</span><strong>—</strong></div>`;
  // 系統樹の伸び（レベルが上がったら大きく知らせる）
  let metaGainHtml = '';
  if (false && mode === 'streak' && result.meta) {  // 系統樹は 0018 でやめた
    const before = run.meta?.level || result.meta.level;
    const up = result.meta.level > before;
    const next = nextMetaUnlock(result.meta.level);
    if (up) { playSfx('evolution'); vibrate('record'); }
    metaGainHtml = `<div class="meta-gain ${up ? 'up' : ''}"><span class="eyebrow">系統樹</span><strong>${up ? `Lv ${result.meta.level} に成長！` : `累計正解 +${result.correct}`}</strong><p>${up ? `解放: ${(META_UNLOCK[result.meta.level] || '')}` : next ? `Lv ${next.level} まで あと${next.at - result.meta.total_correct}` : 'すべて解放した'}</p></div>`;
    run.meta = result.meta;
  }

  a.innerHTML = `
    <div class="result-banner ${isNewBest || isWeekBest ? 'win' : 'lose'}">
      ${recordBadge}
      ${headline}
      <div class="result-sub">${sub}</div>
    </div>
    ${rankHtml}
    ${metaGainHtml}
    <div class="challenge-bests">${bestLine('今週ベスト', result.week_best)}${bestLine('自己ベスト', result.best)}</div>
    <div class="points-grid">
      <div class="point-box"><div class="point-label">学習ポイント</div><div class="point-val">+${result.learn_points}</div></div>
      <div class="point-box"><div class="point-label">Miコイン</div><div class="point-val"><span class="nut-drop" aria-hidden="true"><span class="mi-coin" aria-hidden="true">Mi</span></span> +${result.nuts}</div></div>
    </div>
    ${result.nuts_raw > result.nuts ? '<div class="notice-line">今日の上限 到達</div>' : ''}
    ${titles.length ? `<div class="title-award"><span class="eyebrow">称号 獲得！</span>${titles.map(t => `<strong>👑 ${escapeHtml(t.name)}</strong>`).join('')}<p>着せ替えで付けられる</p></div>` : ''}
    ${missedHtml(result.missed)}
    <button class="btn-primary" id="btn-challenge-again" style="margin-top: 16px;">もう一度</button>
    <button class="btn-secondary" id="btn-challenge-ranking" style="margin-top: 10px;">ランキング</button>
    <button class="btn-sub" id="btn-challenge-home" style="margin-top: 10px;">ホーム</button>
  `;

  document.getElementById('btn-challenge-again').addEventListener('click', () => begin(mode));
  document.getElementById('btn-challenge-ranking').addEventListener('click', () => run.callbacks.onGoRanking?.(mode));
  document.getElementById('btn-challenge-home').addEventListener('click', () => run.callbacks.onGoHome?.());
}

function showError(err) {
  clearTimers();
  run.busy = false;
  const a = area();
  if (!a) return;
  a.innerHTML = `
    <div class="alert alert-error">${escapeHtml(err?.message || 'うまくいかなかった。もう一度')}</div>
    <button class="btn-secondary" id="btn-challenge-err-home">ホーム</button>
  `;
  document.getElementById('btn-challenge-err-home').addEventListener('click', () => run.callbacks.onGoHome?.());
}
