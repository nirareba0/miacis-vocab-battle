/**
 * app.js - 遊ぶ人の画面。#/ ホーム ／ #/play/<id> 挑戦 ／ #/rank/<id> ランキング
 */
import { api } from './backend.js';
import { translateError, formatMs, escapeHtml as h, rankSummary, timerRatio, normalizeNickname } from './logic.js';

const app = document.getElementById('app');
const LETTERS = ['A', 'B', 'C', 'D'];
let timerHandle = null;

function stopTimer() {
  if (timerHandle) cancelAnimationFrame(timerHandle);
  timerHandle = null;
}

function render(html) {
  stopTimer();
  app.innerHTML = (api.isDemo ? '<p class="demo-bar">お試しモード — この端末の中だけで動いています</p>' : '') + html;
  window.scrollTo(0, 0);
}

function showError(e) {
  render(`<section class="card center"><p class="err">${h(translateError(e))}</p>
    <a class="btn" href="#/">ホーム</a></section>`);
}

// ---------------------------------------------------------------- ホーム

function couponCard(c) {
  const open = !c.used_at && /^https:\/\//.test(c.coupon_url || '')
    ? `<a class="btn coupon-open" href="${h(c.coupon_url)}">公式LINEのクーポンを開く</a>` : '';
  return `<article class="coupon ${c.used_at ? 'used' : ''}">
    <p class="coupon-label">🎟 1位のごほうび</p>
    <p class="coupon-prize">${h(c.prize || 'クーポン')}</p>
    ${open}
    <p class="coupon-code" aria-label="確認コード">${h(c.code)}</p>
    <p class="coupon-note">${c.used_at ? '使用ずみ' : '購買で この画面を見せよう'}</p>
    <p class="coupon-quiz">${h(c.quiz_title)}</p>
  </article>`;
}

function quizCard(z) {
  const open = z.status === 'open';
  const action = open && !z.my_finished
    ? `<a class="btn primary" href="#/play/${z.id}">${z.my_started ? '続き' : '挑戦'}</a>`
    : `<a class="btn" href="#/rank/${z.id}">結果</a>`;
  const mine = z.my_finished ? `<p class="mine">きみの記録 ${z.my_correct} / ${z.total}</p>` : '';
  return `<article class="quiz-card">
    <div class="quiz-head">
      <span class="chip ${open ? 'on' : ''}">${open ? '公開中' : '締め切り'}</span>
      <span class="meta">${z.total}問 · 1問${z.time_limit_sec}秒 · ${z.players}人</span>
    </div>
    <h2>${h(z.title)}</h2>
    ${z.prize ? `<p class="prize">1位 🎟 ${h(z.prize)}</p>` : ''}
    ${mine}
    <div class="actions">${action}</div>
  </article>`;
}

async function home() {
  const [list, coupons, who] = await Promise.all([api.listQuizzes(), api.myCoupons(), api.me()]);
  const open = list.filter((z) => z.status === 'open');
  const closed = list.filter((z) => z.status !== 'open');
  render(`
    <header class="top">
      <h1>Miacis クイズ</h1>
      ${who ? `<a class="me" href="#/name">${h(who.nickname)}</a>` : ''}
    </header>
    ${coupons.filter((c) => !c.used_at).map(couponCard).join('')}
    ${open.length ? open.map(quizCard).join('') : '<p class="empty">いま公開中のクイズはない</p>'}
    ${closed.length ? `<h3 class="sub">締め切ったクイズ</h3>${closed.map(quizCard).join('')}` : ''}
    ${coupons.some((c) => c.used_at) ? `<h3 class="sub">使ったクーポン</h3>${coupons.filter((c) => c.used_at).map(couponCard).join('')}` : ''}
  `);
}

// ---------------------------------------------------------------- 名前

async function nameScreen(next) {
  const who = await api.me();
  render(`<section class="card">
    <h1 class="title">ランキングに出る名前</h1>
    <form id="name-form" class="stack">
      <input id="nick" name="nick" maxlength="12" autocomplete="nickname" required
        value="${h(who?.nickname ?? '')}" placeholder="例: そら" aria-describedby="nick-hint">
      <p id="nick-hint" class="hint">1〜12文字。LINE の名前は出ない。本名は書かない</p>
      <p class="err" id="name-err" role="alert"></p>
      <button class="btn primary big" type="submit">決定</button>
    </form>
    <a class="back" href="#/">ホーム</a>
  </section>`);
  const input = document.getElementById('nick');
  input.focus();
  document.getElementById('name-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api.register(normalizeNickname(input.value));
      // 挑戦から来たときは URL が同じなので hashchange が起きない
      if (location.hash === next) route(); else location.hash = next || '#/';
    } catch (e) {
      document.getElementById('name-err').textContent = translateError(e);
    }
  });
}

// ---------------------------------------------------------------- 挑戦

async function play(quizId) {
  if (!(await api.me())) return nameScreen(`#/play/${quizId}`);
  const z = (await api.listQuizzes()).find((q) => q.id === quizId);
  if (!z) throw new Error('quiz_not_found');
  if (z.my_finished || z.status !== 'open') { location.hash = `#/rank/${quizId}`; return; }

  render(`<section class="card center ready">
    <p class="meta">${z.total}問 · 1問${z.time_limit_sec}秒 · 1回だけ</p>
    <h1 class="title">${h(z.title)}</h1>
    ${z.prize ? `<p class="prize big">1位 🎟 ${h(z.prize)}</p>` : ''}
    <p class="hint">正解の数で勝負。同じ数なら速い人が上</p>
    <button class="btn primary big" id="go">${z.my_started ? '続きから' : 'スタート'}</button>
    <a class="back" href="#/">ホーム</a>
  </section>`);
  document.getElementById('go').addEventListener('click', async () => {
    try {
      const s = await api.startAttempt(quizId);
      await runAttempt(quizId, s);
    } catch (e) { showError(e); }
  });
}

async function runAttempt(quizId, s) {
  for (;;) {
    const q = await api.nextQuestion(s.attempt_id);
    if (q.done) { location.hash = `#/rank/${quizId}?just=1`; return; }
    await showQuestion(s, q);
  }
}

function showQuestion(s, q) {
  return new Promise((resolve, reject) => {
    const img = api.imageUrl(q.image_path);
    render(`<section class="play">
      <div class="play-head">
        <span class="count">${q.position + 1} / ${q.total}</span>
        <span class="secs" id="secs">${Math.ceil(q.remaining_ms / 1000)}</span>
      </div>
      <div class="timer" aria-hidden="true"><div class="timer-fill" id="bar"></div></div>
      <h1 class="question">${h(q.body)}</h1>
      ${img ? `<img class="q-img" src="${h(img)}" alt="">` : ''}
      <div class="choices">
        ${q.choices.map((c, i) => `<button class="choice c${i}" data-i="${i}"><span class="letter">${LETTERS[i]}</span><span>${h(c)}</span></button>`).join('')}
      </div>
      <p class="feedback" id="fb" role="status"></p>
    </section>`);

    const started = performance.now();
    const bar = document.getElementById('bar');
    const secs = document.getElementById('secs');
    let sent = false;

    const send = async (choice) => {
      if (sent) return;
      sent = true;
      stopTimer();
      document.querySelectorAll('.choice').forEach((b) => { b.disabled = true; });
      try {
        const r = await api.answer(s.attempt_id, choice);
        const buttons = document.querySelectorAll('.choice');
        buttons[r.answer]?.classList.add('right');
        if (choice !== null && !r.correct) buttons[choice]?.classList.add('wrong');
        const fb = document.getElementById('fb');
        fb.className = `feedback ${r.correct ? 'ok' : 'ng'}`;
        fb.textContent = r.correct ? `正解！ ${formatMs(r.elapsed_ms)}`
          : r.timed_out ? `時間切れ 正解は ${LETTERS[r.answer]}` : `おしい 正解は ${LETTERS[r.answer]}`;
        setTimeout(resolve, r.correct ? 900 : 1600);
      } catch (e) { reject(e); }
    };

    document.querySelectorAll('.choice').forEach((b) => {
      b.addEventListener('click', () => send(Number(b.dataset.i)));
    });

    const tick = () => {
      const left = q.remaining_ms - (performance.now() - started);
      bar.style.transform = `scaleX(${timerRatio(left, q.time_limit_sec)})`;
      secs.textContent = String(Math.max(0, Math.ceil(left / 1000)));
      bar.classList.toggle('hurry', left < 3000);
      if (left <= 0) { send(null); return; }
      timerHandle = requestAnimationFrame(tick);
    };
    timerHandle = requestAnimationFrame(tick);
  });
}

// ---------------------------------------------------------------- 結果・ランキング

async function rank(quizId, just) {
  const [list, rows] = await Promise.all([api.listQuizzes(), api.ranking(quizId)]);
  const z = list.find((q) => q.id === quizId);
  if (!z) throw new Error('quiz_not_found');
  const sum = rankSummary(rows);
  const mine = rows.find((r) => r.is_me);
  const open = z.status === 'open';

  const head = mine ? `<section class="card center result">
      <p class="meta">${!just ? 'きみの記録' : mine.correct === z.total ? 'PERFECT' : 'FINISH'}</p>
      <p class="score"><strong>${mine.correct}</strong> / ${z.total}</p>
      <p class="time">合計 ${formatMs(mine.total_ms)}</p>
      <p class="rank-line">${open ? 'いま' : ''} <strong>${sum.rank}位</strong> / ${sum.total}人${sum.beaten > 0 ? ` · ${sum.beaten}人を上回った` : ''}</p>
      ${open && z.prize ? `<p class="hint">締め切りで1位なら 🎟 ${h(z.prize)}</p>` : ''}
      ${!open && sum.rank === 1 ? '<p class="win">1位！ クーポンはホームに届いている</p>' : ''}
    </section>` : '';

  render(`
    <header class="top"><a class="back" href="#/">← ホーム</a></header>
    ${head}
    <section class="card">
      <h2 class="title">${h(z.title)}</h2>
      <p class="meta">${open ? '公開中 · 締め切りで1位にクーポン' : '締め切り'}</p>
      ${rows.length ? `<ol class="ranking">${rows.map((r) => `
        <li class="${r.is_me ? 'me' : ''} ${r.rank === 1 ? 'first' : ''}">
          <span class="pos">${r.rank === 1 ? '👑' : r.rank}</span>
          <span class="name">${h(r.nickname)}</span>
          <span class="pts">${r.correct}問</span>
          <span class="ms">${formatMs(r.total_ms)}</span>
        </li>`).join('')}</ol>` : '<p class="empty">まだだれも終えていない</p>'}
    </section>
    ${open && !z.my_finished ? `<a class="btn primary big" href="#/play/${z.id}">挑戦</a>` : ''}
  `);
}

// ---------------------------------------------------------------- ルーター

async function route() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  try {
    await api.ensureSession();
    // 公式LINE で送ったリンク（?quiz=<id>）から来たら、そのクイズへ（1回だけ）
    const linked = new URLSearchParams(location.search).get('quiz');
    if (linked && !sessionStorage.getItem(`quiz-linked-${linked}`)) {
      sessionStorage.setItem(`quiz-linked-${linked}`, '1');
      location.hash = `#/play/${linked}`;
      return;
    }
    if (parts[0] === 'play' && parts[1]) return await play(parts[1]);
    if (parts[0] === 'rank' && parts[1]) return await rank(parts[1], new URLSearchParams(query).has('just'));
    if (parts[0] === 'name') return await nameScreen('#/');
    return await home();
  } catch (e) {
    showError(e);
  }
}

window.addEventListener('hashchange', route);
route();
