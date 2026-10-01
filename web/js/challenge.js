/**
 * challenge.js - 連続チャレンジ（#/streak）と 100本ノック（#/knock）
 *
 * 対戦と違い、1問ずつサーバーに答えを送り、正誤と次の問題を受け取る。
 * 正解・制限時間・記録はサーバーが持つ（ここでは表示と時間の計測だけ）。
 */
import { startRun, answerRun, reviveRun, endRun, getMyRunBests } from './api.js';
import {
  escapeHtml,
  streakStage,
  streakPressureLabel,
  formatSeconds,
  knockGrade
} from './logic.js';
import { playSfx, triggerConfetti, isMuted, toggleMute, vibrate } from './game.js';

const REVIVE_SECONDS = 5;
const KNOCK_TOTAL = 100;

const MODES = {
  streak: {
    title: '連続チャレンジ',
    lead: '間違えたら終わり。どこまで続けられる？',
    rules: [
      '5問ごとに出題範囲がレベルアップ。制限時間も短くなる',
      '1問でも間違えたら、そこで終わり',
      '時間切れは1回だけ復活できる（5秒以内に決める）',
      '今週のベストでランキング。月曜にリセット'
    ]
  },
  knock: {
    title: '100本ノック',
    lead: '100問、止まらずに打ち返せ。',
    rules: [
      '自分の段の単語から100問。1問6秒',
      '間違えても止まらない。正解はその場で見せる',
      '100問やり切った回が記録になる（途中でやめると記録なし）',
      '同じ正解数なら、速い人が上'
    ]
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

/**
 * @param {HTMLElement} containerEl
 * @param {'streak'|'knock'} mode
 * @param {{onGoHome?: Function, onGoRanking?: Function, onNuts?: Function}} callbacks
 */
export async function renderChallengeView(containerEl, mode, callbacks = {}) {
  stopChallenge();
  run.mode = mode;
  run.callbacks = callbacks;
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
  try {
    bests = await getMyRunBests();
  } catch {
    bests = null;
  }
  const a = area();
  if (!a || run.mode !== mode) return;

  const best = bests?.[mode];
  const weekBest = bests?.[`${mode}_week`];
  const bestText = (b) => {
    if (!b) return 'まだなし';
    return mode === 'streak' ? `${b.correct} 問連続` : `${b.correct} / ${KNOCK_TOTAL} 問`;
  };

  a.innerHTML = `
    <div class="card challenge-intro">
      <span class="eyebrow">${conf.lead}</span>
      <ul class="challenge-rules">${conf.rules.map(r => `<li>${r}</li>`).join('')}</ul>
      <div class="challenge-bests">
        <div><span>今週のベスト</span><strong>${bestText(weekBest)}</strong></div>
        <div><span>自己ベスト</span><strong>${bestText(best)}</strong></div>
      </div>
      <button class="btn-primary" id="btn-challenge-start" style="font-size: 20px;">スタート！</button>
    </div>
  `;
  document.getElementById('btn-challenge-start').addEventListener('click', () => begin(mode));
}

async function begin(mode) {
  const a = area();
  if (!a) return;
  a.innerHTML = '<div class="card" style="text-align:center; padding:32px 16px;">問題を用意しています…</div>';
  try {
    const res = await startRun(mode);
    if (run.mode !== mode || !area()) return;
    run.id = res.run_id;
    run.score = 0;
    run.answered = 0;
    run.reviveUsed = false;
    run.best = res.best ? res.best.correct : null;
    run.weekBest = res.week_best ? res.week_best.correct : null;
    run.startedAt = performance.now();
    showQuestion(res.question);
  } catch (err) {
    showError(err);
  }
}

function headerHtml(q) {
  if (run.mode === 'streak') {
    const st = streakStage(run.score);
    const pressure = streakPressureLabel(run.score, run.best);
    return `
      <div class="streak-hud">
        <div class="streak-count"><span>連続</span><strong>${run.score}</strong></div>
        <div class="streak-meta">
          <span class="stage-pill">STAGE ${q.stage}</span>
          <span class="stage-steps" aria-label="次のステージまであと${st.toNext}問">${Array.from({ length: 5 }, (_, i) => `<i class="${i < st.inStage ? 'done' : ''}"></i>`).join('')}</span>
          <span class="revive-life" aria-label="${run.reviveUsed ? '復活は使用済み' : '復活が1回残っている'}">${run.reviveUsed ? '🖤' : '❤️'}</span>
        </div>
      </div>
      <div class="pressure-line" aria-live="polite">${pressure}</div>
    `;
  }
  return `
    <div class="battle-header">
      <span class="q-counter">${q.no} / ${KNOCK_TOTAL} 本</span>
      <span class="knock-score">正解 <strong>${run.score}</strong></span>
    </div>
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
    <div class="word-prompt">${escapeHtml(q.prompt)}</div>
    <div class="choices-list">
      ${q.choices.map((c, i) => `<button class="btn-choice" data-choice="${i}"><span class="choice-number" aria-hidden="true">${i + 1}</span><span>${escapeHtml(c)}</span></button>`).join('')}
    </div>
    ${run.mode === 'knock' ? '<button class="btn-sub" id="btn-knock-quit" style="margin-top:14px;">ここでやめる（記録なし）</button>' : ''}
  `;

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

  a.querySelectorAll('.btn-choice').forEach(btn => {
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
  if (res.correct) {
    btn?.classList.add('choice-correct');
    playSfx('correct');
  } else {
    btn?.classList.add('choice-wrong');
    buttons[res.answer_index]?.classList.add('correct');
    playSfx('wrong');
    vibrate(res.timeout ? 'timeout' : 'wrong');
  }

  run.score = res.score;
  run.answered = res.answered;
  run.reviveUsed = res.revive_used;

  if (res.state === 'finished') {
    later(() => showResult(res.result), res.correct ? 400 : 1100);
  } else if (res.state === 'revive_offer') {
    later(() => showRevive(), 600);
  } else if (run.mode === 'streak' && res.question.stage > prevStage) {
    playSfx('combo');
    vibrate('stageUp');
    later(() => showStageUp(res.question), 400);
  } else {
    later(() => showQuestion(res.question), res.correct ? 350 : 900);
  }
}

function showStageUp(q) {
  const a = area();
  if (!a) return;
  a.innerHTML = `
    <div class="stage-up" role="status">
      <span class="eyebrow">${run.score} 問連続クリア</span>
      <strong>STAGE ${q.stage}</strong>
      <p>${q.range >= 10 ? '最難関の範囲' : '出題範囲がレベルアップ'}・制限時間 ${(q.limit_ms / 1000).toFixed(1)} 秒</p>
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
      <span class="eyebrow">時間切れ！ いまの記録 ${run.score} 問連続</span>
      <h2 id="revive-title">復活する？</h2>
      <p>復活は1回だけ。次の問題から続けられる。</p>
      <div class="revive-count" aria-live="assertive"><strong id="revive-sec">${REVIVE_SECONDS}</strong></div>
      <div class="timer-bar-bg"><div id="revive-bar" class="timer-bar-fill danger"></div></div>
      <button class="btn-primary" id="btn-revive">❤️ 復活する</button>
      <button class="btn-sub" id="btn-revive-no">ここでやめる</button>
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
            <div style="font-size: 13px; color: var(--text-muted);">正解: ${escapeHtml(m.correct_text)}（${m.timeout ? '時間切れ' : `あなた: ${escapeHtml(m.your_text ?? '')}`}）</div>
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

  let headline;
  let sub;
  if (mode === 'streak') {
    headline = `<div class="result-big">${result.correct}<small> 問連続</small></div>`;
    sub = result.end_reason === 'timeout' ? '時間切れで終了' : result.end_reason === 'wrong' ? '不正解で終了' : 'ここで終了';
  } else if (complete) {
    const g = knockGrade(result.correct);
    headline = `<div class="result-big">${result.correct}<small> / ${KNOCK_TOTAL} 問</small></div><div class="knock-grade">${g.mark}</div>`;
    sub = `${g.label}・正解した問題の時間 ${formatSeconds(result.total_ms)}`;
  } else {
    headline = `<div class="result-big">${result.correct}<small> 問正解</small></div>`;
    sub = `${result.answered} 本でストップ（記録はやり切った回だけ）`;
  }

  // 今週の順位と、すぐ上の相手（次にやる理由）
  let rankHtml = '';
  if (result.week_rank) {
    const rival = result.rival;
    let chase = '';
    if (result.week_rank === 1) {
      chase = '今週の1位。守りきれる？';
    } else if (rival) {
      const gap = rival.correct + 1 - (result.week_best?.correct ?? result.correct);
      chase = mode === 'streak'
        ? `${rival.nickname} さん（${rival.correct}連続）まで、あと ${gap} 問`
        : `${rival.nickname} さん（${rival.correct}問）まで、あと ${gap} 問`;
    }
    rankHtml = `<div class="rank-card"><div><span>今週の順位</span><strong>${result.week_rank}<small>位</small></strong></div><p>${chase}</p></div>`;
  }

  const recordBadge = isNewBest
    ? '<div class="record-badge">自己ベスト更新！</div>'
    : isWeekBest ? '<div class="record-badge">今週のベスト更新！</div>' : '';
  const bestLine = (label, b) => b ? `<div><span>${label}</span><strong>${b.correct}${mode === 'streak' ? ' 問連続' : ` / ${KNOCK_TOTAL}`}</strong></div>` : `<div><span>${label}</span><strong>まだなし</strong></div>`;

  a.innerHTML = `
    <div class="result-banner ${isNewBest || isWeekBest ? 'win' : 'lose'}">
      ${recordBadge}
      ${headline}
      <div class="result-sub">${sub}</div>
    </div>
    ${rankHtml}
    <div class="challenge-bests">${bestLine('今週のベスト', result.week_best)}${bestLine('自己ベスト', result.best)}</div>
    <div class="points-grid">
      <div class="point-box"><div class="point-label">学習ポイント</div><div class="point-val">+${result.learn_points}</div></div>
      <div class="point-box"><div class="point-label">木の実</div><div class="point-val">🌰 +${result.nuts}</div></div>
    </div>
    ${result.nuts_raw > result.nuts ? '<div class="notice-line">今日の木の実は上限まで集めた！</div>' : ''}
    ${missedHtml(result.missed)}
    <button class="btn-primary" id="btn-challenge-again" style="margin-top: 16px;">もう一度</button>
    <button class="btn-secondary" id="btn-challenge-ranking" style="margin-top: 10px;">ランキングを見る</button>
    <button class="btn-sub" id="btn-challenge-home" style="margin-top: 10px;">ホームへ戻る</button>
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
    <div class="alert alert-error">${escapeHtml(err?.message || 'エラーが発生しました')}</div>
    <button class="btn-secondary" id="btn-challenge-err-home">ホームへ戻る</button>
  `;
  document.getElementById('btn-challenge-err-home').addEventListener('click', () => run.callbacks.onGoHome?.());
}
