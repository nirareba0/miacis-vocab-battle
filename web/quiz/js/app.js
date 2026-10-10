/**
 * app.js - 遊ぶ画面。#/ ホーム ／ #/play/<id> 挑戦 ／ #/rank/<id> 結果とランキング
 * 挑戦中は「生放送のクイズ番組」風（body.stage）: 第◯問・4枚のタイル・答えるたびに正解と早押しトップ5（秒）・お知らせ（CM）
 */
import { api } from './backend.js';
import {
  translateError, formatMs, formatMs2, escapeHtml as h, rankSummary, timerRatio, normalizeNickname,
  formatDeadline, remainingLabel
} from './logic.js';

const app = document.getElementById('app');
const NUMS = ['1', '2', '3', '4'];
let timerHandle = null;
let waitHandle = null;

function stopTimers() {
  if (timerHandle) cancelAnimationFrame(timerHandle);
  if (waitHandle) clearInterval(waitHandle);
  timerHandle = null;
  waitHandle = null;
}

function render(html, { stage = false } = {}) {
  stopTimers();
  document.body.classList.toggle('stage', stage);
  app.innerHTML = (api.isDemo ? '<p class="demo-bar">お試しモード — この端末の中だけで動いています</p>' : '') + html;
  window.scrollTo(0, 0);
}

function showError(e) {
  render(`<section class="card center"><p class="err">${h(translateError(e))}</p>
    <a class="btn" href="#/">ホーム</a></section>`);
}

const deadlineLine = (z) => {
  if (!z.closes_at) return '';
  const left = z.status === 'open' ? remainingLabel(z.closes_at) : null;
  return `<p class="deadline">${h(formatDeadline(z.closes_at))} 締め切り${left ? ` · <strong>${left}</strong>` : ''}</p>`;
};

// ---------------------------------------------------------------- ホーム

function couponCard(c) {
  const open = !c.used_at && /^https:\/\//.test(c.coupon_url || '')
    ? `<a class="btn coupon-open" href="${h(c.coupon_url)}">公式LINEのクーポンを開く</a>` : '';
  return `<article class="coupon ${c.used_at ? 'used' : ''}">
    <p class="coupon-label">🏆 1位のごほうび</p>
    <p class="coupon-prize">${h(c.prize || 'クーポン')}</p>
    ${open}
    <p class="coupon-code" aria-label="確認コード">${h(c.code)}</p>
    <p class="coupon-note">${c.used_at ? '使用ずみ' : '購買で この画面を見せよう'}</p>
    <p class="coupon-quiz">${h(c.quiz_title)}</p>
  </article>`;
}

function quizCard(z) {
  const open = z.status === 'open' && !(z.closes_at && !remainingLabel(z.closes_at));
  const action = open && !z.my_finished
    ? `<a class="btn primary" href="#/play/${z.id}">${z.my_started ? '続き' : '挑戦'}</a>`
    : `<a class="btn" href="#/rank/${z.id}">結果</a>`;
  const mine = z.my_finished ? `<p class="mine">きみの記録 ${z.my_correct} / ${z.total}</p>` : '';
  return `<article class="quiz-card">
    <div class="quiz-head">
      <span class="chip ${open ? 'on' : ''}">${open ? '受付中' : '締め切り'}</span>
      <span class="meta">${z.total}問 · 1問${z.time_limit_sec}秒 · ${z.players}人</span>
    </div>
    <h2>${h(z.title)}</h2>
    ${z.prize ? `<p class="prize">1位 🏆 ${h(z.prize)}</p>` : ''}
    ${deadlineLine(z)}
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
    ${open.length ? open.map(quizCard).join('') : '<p class="empty">いま受付中のクイズはない</p>'}
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

  render(`<section class="opening">
    <p class="opening-kicker">MIACIS QUIZ</p>
    <h1 class="opening-title">${h(z.title)}</h1>
    <p class="opening-rule">全${z.total}問 · 1問${z.time_limit_sec}秒 · 1回だけ</p>
    ${z.prize ? `<p class="opening-prize">1位 🏆 ${h(z.prize)}</p>` : ''}
    ${deadlineLine(z)}
    <p class="opening-hint">正解の数で勝負。同じ数なら速い人が上</p>
    <button class="btn gold big" id="go">${z.my_started ? '続きから' : 'スタート'}</button>
    <a class="back" href="#/">ホーム</a>
  </section>`, { stage: true });
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
    const r = await showQuestion(s, q);
    await showReveal(q, r);
    if (r.break) await showBreak(r.break);
  }
}

function showQuestion(s, q) {
  return new Promise((resolve, reject) => {
    const img = api.imageUrl(q.image_path);
    render(`<section class="show">
      <div class="show-head">
        <span class="q-no">第<strong>${q.position + 1}</strong>問</span>
        <span class="q-of">${q.position + 1} / ${q.total}</span>
        <span class="clock" id="secs" aria-label="残り秒数">${(q.remaining_ms / 1000).toFixed(1)}</span>
      </div>
      <div class="timer" aria-hidden="true"><div class="timer-fill" id="bar"></div></div>
      <div class="q-panel"><h1 class="question">${h(q.body)}</h1></div>
      ${q.kind === 'speed' ? '<p class="speed-banner">早押し！ どれを押してもOK</p>' : ''}
      ${img ? `<img class="q-img" src="${h(img)}" alt="">` : ''}
      <div class="tiles">
        ${q.choices.map((c, i) => `<button class="tile t${i}" data-i="${i}"><span class="num">${NUMS[i]}</span><span class="txt">${h(c)}</span></button>`).join('')}
      </div>
    </section>`, { stage: true });

    const started = performance.now();
    const bar = document.getElementById('bar');
    const secs = document.getElementById('secs');
    let sent = false;

    const send = async (choice) => {
      if (sent) return;
      sent = true;
      stopTimers();
      document.querySelectorAll('.tile').forEach((b, i) => {
        b.disabled = true;
        b.classList.toggle('locked', i === choice);
        b.classList.toggle('dim', i !== choice);
      });
      try {
        const r = await api.answer(s.attempt_id, choice);
        resolve({ ...r, choice });
      } catch (e) { reject(e); }
    };

    document.querySelectorAll('.tile').forEach((b) => {
      b.addEventListener('click', () => send(Number(b.dataset.i)));
    });

    const tick = () => {
      const left = q.remaining_ms - (performance.now() - started);
      bar.style.transform = `scaleX(${timerRatio(left, q.time_limit_sec)})`;
      secs.textContent = Math.max(0, left / 1000).toFixed(1);
      secs.classList.toggle('hurry', left < 3000);
      bar.classList.toggle('hurry', left < 3000);
      if (left <= 0) { send(null); return; }
      timerHandle = requestAnimationFrame(tick);
    };
    timerHandle = requestAnimationFrame(tick);
  });
}

/** 正解の発表と、この問題の早押しトップ5。早押し（正解なし）は「みんなの答え」 */
function showReveal(q, r) {
  return new Promise((resolve) => {
    const speed = r.kind === 'speed';
    const verdict = speed
      ? (r.correct ? '<p class="verdict ok">押した！</p>' : '<p class="verdict ng">時間切れ</p>')
      : r.correct ? '<p class="verdict ok">正解！</p>' : r.timed_out
        ? '<p class="verdict ng">時間切れ</p>' : '<p class="verdict ng">ざんねん</p>';
    const top = (r.board?.fastest ?? []).map((f, i) => `<li class="${f.is_me ? 'is-me' : ''}">
      <span class="pos">${i + 1}</span><span class="name">${h(f.nickname)}</span><span class="ms">${formatMs2(f.ms)}</span></li>`).join('');
    const votes = r.votes ?? [0, 0, 0, 0];
    const sum = Math.max(1, votes.reduce((x, y) => x + y, 0));
    const head = speed
      ? `<p class="answer-label">みんなの答え</p>
        <div class="votes">${q.choices.map((c, i) => `<div class="vote t${i} ${r.choice === i ? 'mine' : ''}">
          <span class="vote-bar" style="width:${Math.round(100 * votes[i] / sum)}%"></span>
          <span class="vote-txt">${h(c)}</span><span class="vote-n">${Math.round(100 * votes[i] / sum)}%</span></div>`).join('')}</div>`
      : `<p class="answer-label">正解は</p>
        <div class="answer-tile t${r.answer}"><span class="num">${NUMS[r.answer]}</span><span class="txt">${h(q.choices[r.answer])}</span></div>`;
    render(`<section class="show reveal">
      <div class="show-head">
        <span class="q-no">第<strong>${q.position + 1}</strong>問</span>
        <span class="q-of">${q.position + 1} / ${q.total}</span>
      </div>
      ${head}
      ${verdict}
      <p class="my-time">${r.correct ? `あなた <strong>${formatMs2(r.elapsed_ms)}</strong>` : '記録なし'}</p>
      <div class="board">
        <div class="board-head"><span>早押しトップ5</span><span>${speed ? `${r.board?.answered ?? 0}人` : `正解率 ${r.board?.correct_rate ?? 0}%`}</span></div>
        ${top ? `<ol class="fastest">${top}</ol>` : '<p class="empty small">まだだれもいない</p>'}
      </div>
      <button class="btn gold big" id="next">${r.done ? '結果へ' : '次の問題'}</button>
    </section>`, { stage: true });
    const go = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(go, 6000);
    document.getElementById('next').addEventListener('click', go);
  });
}

/** お知らせ（CM）。決めた秒数は見てもらってから「つづき」 */
function showBreak(b) {
  return new Promise((resolve) => {
    const img = api.imageUrl(b.image_path);
    let left = b.seconds;
    render(`<section class="cm">
      <p class="cm-kicker">ここで お知らせ</p>
      ${img ? `<img class="cm-img" src="${h(img)}" alt="">` : ''}
      <h1 class="cm-title">${h(b.title)}</h1>
      ${b.body ? `<p class="cm-body">${h(b.body)}</p>` : ''}
      ${b.link_url ? `<a class="btn cm-link" href="${h(b.link_url)}" target="_blank" rel="noopener">くわしく</a>` : ''}
      <button class="btn gold big" id="resume" disabled>つづきまで <span id="cm-left">${left}</span></button>
    </section>`, { stage: true });
    const btn = document.getElementById('resume');
    waitHandle = setInterval(() => {
      left -= 1;
      if (left > 0) { document.getElementById('cm-left').textContent = String(left); return; }
      clearInterval(waitHandle);
      waitHandle = null;
      btn.disabled = false;
      btn.textContent = 'つづき';
    }, 1000);
    btn.addEventListener('click', () => resolve());
  });
}

// ---------------------------------------------------------------- 結果・ランキング

async function rank(quizId, just) {
  const [list, rows] = await Promise.all([api.listQuizzes(), api.ranking(quizId)]);
  const z = list.find((q) => q.id === quizId);
  if (!z) throw new Error('quiz_not_found');
  const answers = z.my_started ? await api.myAnswers(quizId) : [];
  const sum = rankSummary(rows);
  const mine = rows.find((r) => r.is_me);
  const open = z.status === 'open';

  const record = answers.length ? `<div class="record" aria-label="1問ごとの記録">
      ${answers.map((a) => `<div class="rec ${a.correct ? 'ok' : a.timed_out ? 'to' : 'ng'}">
        <span class="rec-no">第${a.position + 1}問</span>
        <span class="rec-mark">${a.correct ? '○' : '×'}</span>
        <span class="rec-ms">${a.correct ? formatMs2(a.ms) : a.timed_out ? '時間切れ' : '—'}</span>
      </div>`).join('')}
    </div>` : '';

  const head = mine ? `<section class="card center result">
      <p class="meta">${!just ? 'きみの記録' : mine.correct === z.total ? 'PERFECT' : 'FINISH'}</p>
      <p class="score"><strong>${mine.correct}</strong> / ${z.total}</p>
      <p class="time">合計 ${formatMs(mine.total_ms)}</p>
      <p class="rank-line">${open ? 'いま' : ''} <strong>${sum.rank}位</strong> / ${sum.total}人${sum.beaten > 0 ? ` · ${sum.beaten}人を上回った` : ''}</p>
      ${open && z.prize ? `<p class="hint">${z.closes_at ? `${h(formatDeadline(z.closes_at))} の締め切りで` : '締め切りで'}1位なら 🏆 ${h(z.prize)}。公式LINE に届く</p>` : ''}
      ${!open && sum.rank === 1 ? '<p class="win">1位！ クーポンはホームと公式LINE に届いている</p>' : ''}
      ${record}
    </section>` : '';

  render(`
    <header class="top"><a class="back" href="#/">← ホーム</a></header>
    ${head}
    <section class="card">
      <h2 class="title">${h(z.title)}</h2>
      ${deadlineLine(z)}
      <p class="meta">${open ? '受付中 · 締め切りの時点の1位にクーポン' : '締め切り'}</p>
      ${rows.length ? `<ol class="ranking">${rows.map((r) => `
        <li class="${r.is_me ? 'is-me' : ''} ${r.rank === 1 ? 'first' : ''}">
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
