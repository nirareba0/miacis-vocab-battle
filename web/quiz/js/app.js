/**
 * app.js - 遊ぶ画面。#/ ホーム ／ #/play/<id> 挑戦 ／ #/rank/<id> 結果とランキング
 *
 * 挑戦中（body.stage）は「生放送のクイズ番組」と、シンプルなゲームの作りを合わせる。
 *   番組から: 1〜4 の番号ボタン（キーパッド）、100分の1秒の時計、正解発表で「何番に何人」、早押しの順位
 *   シンプルなゲームから: 1画面1つ、大きな押しやすいボタン、上に進み具合、答えたら下から結果が出てボタン1つで次へ
 */
import { api } from './backend.js';
import {
  translateError, formatMs2, escapeHtml as h, rankSummary, timerRatio, normalizeNickname,
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

// 進み具合（問題の数だけの区切り）
const progress = (pos, total, done = false) => `<div class="g-progress" aria-label="${pos + 1} / ${total}">
  ${Array.from({ length: total }, (_, i) => `<span class="${i < pos || (done && i === pos) ? 'done' : i === pos ? 'now' : ''}"></span>`).join('')}
</div>`;

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
  const who = await api.me({ raw: true });
  let student = who?.is_student ?? null;
  render(`<section class="g-card g-name">
    <h1 class="g-title">はじめに</h1>
    <form id="name-form" class="stack">
      <p class="g-label">あなたは？</p>
      <div class="g-choice" role="radiogroup">
        <button type="button" class="g-pick ${student === true ? 'on' : ''}" data-s="1" role="radio" aria-checked="${student === true}">中高生</button>
        <button type="button" class="g-pick ${student === false ? 'on' : ''}" data-s="0" role="radio" aria-checked="${student === false}">それ以外</button>
      </div>
      <p class="hint" id="s-hint">${student === false ? 'それ以外の人も遊べる。ランキングと1位のプレゼントは中高生だけ' : 'ランキングと1位のプレゼントは中高生だけ'}</p>
      <p class="g-label">ランキングに出る名前</p>
      <input id="nick" name="nick" maxlength="12" autocomplete="nickname" required
        value="${h(who?.nickname ?? '')}" placeholder="例: そら" aria-describedby="nick-hint">
      <p id="nick-hint" class="hint">1〜12文字。LINE の名前は出ない。本名は書かない</p>
      <p class="err" id="name-err" role="alert"></p>
      <button class="g-btn" type="submit">決定</button>
    </form>
  </section>
  <a class="g-back" href="#/">ホーム</a>`, { stage: true });
  const input = document.getElementById('nick');
  document.querySelectorAll('.g-pick').forEach((b) => b.addEventListener('click', () => {
    student = b.dataset.s === '1';
    document.getElementById('name-err').textContent = '';
    document.querySelectorAll('.g-pick').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-checked', String(x === b));
    });
    document.getElementById('s-hint').textContent = student
      ? 'ランキングと1位のプレゼントは中高生だけ'
      : 'それ以外の人も遊べる。ランキングと1位のプレゼントは中高生だけ';
  }));
  document.getElementById('name-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('name-err');
    if (student === null) { err.textContent = '中高生か、それ以外かを選んでね'; return; }
    try {
      await api.register(normalizeNickname(input.value), student);
      // 挑戦から来たときは URL が同じなので hashchange が起きない
      if (location.hash === next) route(); else location.hash = next || '#/';
    } catch (e) {
      err.textContent = translateError(e);
    }
  });
}

// ---------------------------------------------------------------- 挑戦

async function play(quizId) {
  if (!(await api.me())) return nameScreen(`#/play/${quizId}`);
  const z = (await api.listQuizzes()).find((q) => q.id === quizId);
  if (!z) throw new Error('quiz_not_found');
  if (z.my_finished || z.status !== 'open') { location.hash = `#/rank/${quizId}`; return; }

  render(`<section class="g-card g-opening">
    <p class="g-kicker">MIACIS QUIZ</p>
    <h1 class="g-title">${h(z.title)}</h1>
    <div class="g-rules"><span>全${z.total}問</span><span>1問${z.time_limit_sec}秒</span><span>1回だけ</span></div>
    ${z.prize ? `<p class="g-prize">1位 🏆 ${h(z.prize)}</p>` : ''}
    ${deadlineLine(z)}
    <p class="hint">正解の数で勝負。同じ数なら速い人が上</p>
    <button class="g-btn" id="go">${z.my_started ? '続きから' : 'スタート'}</button>
  </section>
  <a class="g-back" href="#/">ホーム</a>`, { stage: true });
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
    const r = await playQuestion(s, q);
    if (r.break) await showBreak(r.break);
  }
}

/** 1問。押したら同じ画面で「何番に何人」と正解を出し、下から結果。「次へ」で戻る */
function playQuestion(s, q) {
  return new Promise((resolve, reject) => {
    const img = api.imageUrl(q.image_path);
    const speed = q.kind === 'speed';
    render(`<section class="g-play">
      ${progress(q.position, q.total)}
      <div class="g-head">
        <span class="g-qno">第${q.position + 1}問</span>
        ${speed ? '<span class="g-tag">早押し</span>' : ''}
        <span class="g-clock" id="clock">${(q.remaining_ms / 1000).toFixed(2)}</span>
      </div>
      <div class="g-timer"><div id="bar"></div></div>
      <div class="g-card g-q">
        <h1>${h(q.body)}</h1>
        ${img ? `<img src="${h(img)}" alt="">` : ''}
      </div>
      ${speed ? '<p class="g-note">どれを押してもOK。速さで勝負</p>' : ''}
      <div class="g-keys">
        ${q.choices.map((c, i) => `<button class="g-key k${i}" data-i="${i}">
          <span class="g-num">${NUMS[i]}</span><span class="g-txt">${h(c)}</span>
          <span class="g-votes" aria-hidden="true"></span><span class="g-count"></span>
        </button>`).join('')}
      </div>
      <div id="sheet"></div>
    </section>`, { stage: true });

    const started = performance.now();
    const bar = document.getElementById('bar');
    const clock = document.getElementById('clock');
    const keys = [...document.querySelectorAll('.g-key')];
    let sent = false;

    const reveal = (r) => {
      // 発表のときは画像をたたみ、正解のボタンが結果の上に見えるようにする
      document.querySelector('.g-play').classList.add('revealed');
      window.scrollTo(0, 0);
      const total = Math.max(1, (r.votes ?? []).reduce((x, y) => x + y, 0));
      keys.forEach((k, i) => {
        const n = r.votes?.[i] ?? 0;
        k.querySelector('.g-votes').style.width = `${Math.round((100 * n) / total)}%`;
        k.querySelector('.g-count').textContent = `${n}人`;
        k.classList.add('shown');
        if (!speed && i === r.answer) k.classList.add('right');
        if (!speed && i === r.choice && !r.correct) k.classList.add('wrong');
      });
      const verdict = speed
        ? (r.correct ? ['ok', '押した！'] : ['to', '時間切れ'])
        : r.correct ? ['ok', '正解！'] : r.timed_out ? ['to', '時間切れ'] : ['ng', 'ざんねん'];
      const top = (r.board?.fastest ?? []).slice(0, 3).map((f, i) => `<li class="${f.is_me ? 'is-me' : ''}">
        <b>${i + 1}</b><span>${h(f.nickname)}</span><em>${formatMs2(f.ms)}</em></li>`).join('');
      document.getElementById('sheet').innerHTML = `<div class="g-sheet ${verdict[0]}" role="status">
        <div class="g-verdict">
          <strong>${verdict[1]}</strong>
          <span>${r.correct ? formatMs2(r.elapsed_ms) : speed ? '' : `正解は ${NUMS[r.answer]}`}</span>
        </div>
        <p class="g-sub">${speed ? `${r.board?.answered ?? 0}人が回答` : `正解率 ${r.board?.correct_rate ?? 0}%`} · この問題の早押し</p>
        ${top ? `<ol class="g-top">${top}</ol>` : ''}
        <button class="g-btn" id="next">${r.done ? '結果を見る' : '次へ'}</button>
      </div>`;
      document.getElementById('next').addEventListener('click', () => resolve(r));
    };

    const send = async (choice) => {
      if (sent) return;
      sent = true;
      stopTimers();
      keys.forEach((b, i) => {
        b.disabled = true;
        b.classList.toggle('locked', i === choice);
        b.classList.toggle('dim', i !== choice);
      });
      try {
        const r = await api.answer(s.attempt_id, choice);
        clock.textContent = (r.elapsed_ms / 1000).toFixed(2);
        clock.classList.add('stop');
        reveal({ ...r, choice });
      } catch (e) { reject(e); }
    };

    keys.forEach((b) => b.addEventListener('click', () => send(Number(b.dataset.i))));

    const tick = () => {
      const left = q.remaining_ms - (performance.now() - started);
      bar.style.transform = `scaleX(${timerRatio(left, q.time_limit_sec)})`;
      clock.textContent = Math.max(0, left / 1000).toFixed(2);
      const hurry = left < 3000;
      clock.classList.toggle('hurry', hurry);
      bar.classList.toggle('hurry', hurry);
      if (left <= 0) { send(null); return; }
      timerHandle = requestAnimationFrame(tick);
    };
    timerHandle = requestAnimationFrame(tick);
  });
}

/** お知らせ（CM）。決めた秒数は見てもらってから「つづき」 */
function showBreak(b) {
  return new Promise((resolve) => {
    const img = api.imageUrl(b.image_path);
    let left = b.seconds;
    render(`<section class="g-card g-cm">
      <p class="g-cm-head"><span class="g-cm-mark">CM</span>ここで お知らせ</p>
      ${img ? `<img src="${h(img)}" alt="">` : ''}
      <h1 class="g-title">${h(b.title)}</h1>
      ${b.body ? `<p class="g-cm-body">${h(b.body)}</p>` : ''}
      ${b.link_url ? `<a class="g-link" href="${h(b.link_url)}" target="_blank" rel="noopener">くわしく</a>` : ''}
      <button class="g-btn" id="resume" disabled>つづきまで <span id="cm-left">${left}</span></button>
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

const rankingList = (rows) => rows.length ? `<ol class="g-ranking">${rows.map((r) => `
  <li class="${r.is_me ? 'is-me' : ''}">
    <b>${r.rank === 1 ? '👑' : r.rank}</b>
    <span>${h(r.nickname)}</span>
    <strong>${r.correct}問</strong>
    <em>${formatMs2(r.total_ms)}</em>
  </li>`).join('')}</ol>` : '<p class="empty">まだだれも終えていない</p>';

/** 結果の画面の最後のお知らせ（例: あしたの BINGO 大会） */
const finale = (z) => {
  if (!z.end_title && !z.end_body) return '';
  const img = api.imageUrl(z.end_image_path);
  return `<section class="g-card g-finale">
    <p class="g-finale-kicker">お知らせ</p>
    ${img ? `<img src="${h(img)}" alt="">` : ''}
    ${z.end_title ? `<h2>${h(z.end_title)}</h2>` : ''}
    ${z.end_body ? `<p>${h(z.end_body)}</p>` : ''}
    ${z.end_link_url ? `<a class="g-link" href="${h(z.end_link_url)}" target="_blank" rel="noopener">くわしく</a>` : ''}
  </section>`;
};

async function rank(quizId, just) {
  const [list, students, adults, who] = await Promise.all([
    api.listQuizzes(), api.ranking(quizId, true), api.ranking(quizId, false), api.me({ raw: true })
  ]);
  const z = list.find((q) => q.id === quizId);
  if (!z) throw new Error('quiz_not_found');
  const answers = z.my_started ? await api.myAnswers(quizId) : [];
  const guest = who?.is_student === false;
  const rows = guest ? adults : students;
  const sum = rankSummary(rows);
  const mine = rows.find((r) => r.is_me);
  const open = z.status === 'open';

  const record = answers.length ? `<div class="g-record">
      ${answers.map((a) => `<div class="${a.correct ? 'ok' : a.timed_out ? 'to' : 'ng'}">
        <b>Q${a.position + 1}</b><span>${a.correct ? '○' : '×'}</span><em>${a.correct ? formatMs2(a.ms) : a.timed_out ? '時間切れ' : '—'}</em>
      </div>`).join('')}
    </div>` : '';

  const head = mine ? `<section class="g-card g-result">
      <p class="g-badge">${!just ? 'きみの記録' : mine.correct === z.total ? 'PERFECT' : 'FINISH'}</p>
      <p class="g-score"><strong>${mine.correct}</strong><span>/ ${z.total}</span></p>
      <p class="g-total">合計 ${formatMs2(mine.total_ms)}</p>
      <p class="g-rank">${guest ? 'おとなの部 ' : open ? 'いま ' : ''}<strong>${sum.rank}位</strong> / ${sum.total}人</p>
      ${record}
      ${guest ? '<p class="hint">プレゼントは中高生ランキングの1位だけ。参加ありがとう！</p>'
        : open && z.prize ? `<p class="hint">${z.closes_at ? `${h(formatDeadline(z.closes_at))} の締め切りで` : '締め切りで'}1位なら 🏆 ${h(z.prize)}</p>` : ''}
      ${!open && !guest && sum.rank === 1 ? '<p class="g-win">1位！ クーポンはホームに届いている</p>' : ''}
    </section>` : '';

  render(`
    ${head}
    ${finale(z)}
    <section class="g-card g-board">
      <h2>${h(z.title)}</h2>
      ${deadlineLine(z)}
      <div class="g-tabs" role="tablist">
        <button role="tab" data-t="s" aria-selected="${!guest}">中高生 ${students.length}人</button>
        <button role="tab" data-t="a" aria-selected="${guest}">おとな ${adults.length}人</button>
      </div>
      <div id="rank-s" ${guest ? 'hidden' : ''}>${rankingList(students)}</div>
      <div id="rank-a" ${guest ? '' : 'hidden'}>
        <p class="hint">おとなの部は参考の記録。プレゼントは中高生ランキングの1位だけ</p>
        ${rankingList(adults)}
      </div>
    </section>
    ${open && !z.my_finished ? `<a class="g-btn" href="#/play/${z.id}">挑戦</a>` : ''}
    <a class="g-back" href="#/">ホーム</a>
  `, { stage: true });

  document.querySelectorAll('.g-tabs [data-t]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.g-tabs [data-t]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.getElementById('rank-s').hidden = b.dataset.t !== 's';
    document.getElementById('rank-a').hidden = b.dataset.t !== 'a';
  }));
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
