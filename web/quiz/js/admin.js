/**
 * admin.js - 管理画面。問題のストック（画像つき・まとめて貼り付け）、クイズを組んで公開・締め切り（時刻で自動）、
 * お知らせ（CM）を挟む位置、クーポンの使用済み
 */
import { api } from './backend.js';
import {
  translateError, escapeHtml as h, buildQuestion, parseBulk, formatMs,
  formatDeadline, defaultDeadlineInput, deadlineInputToIso, isoToDeadlineInput
} from './logic.js';

const root = document.getElementById('admin');
const state = { tab: 'questions', questions: [], quizzes: [], editingQuestion: null, editingQuiz: null, editingBreaks: null, tagFilter: '' };

const playUrl = (quizId) => api.shareUrl(quizId);

function flash(msg, kind = 'ok') {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = msg;
  el.className = `flash ${kind}`;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.className = 'flash'; el.textContent = ''; }, 4000);
}
const fail = (e) => flash(translateError(e), 'ng');

/** 画像を長辺 1200px の JPEG に縮める（スマホの写真は 5MB を超えるため） */
async function shrinkImage(file, max = 1200) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', api.isDemo ? 0.7 : 0.85));
}

// ---------------------------------------------------------------- 全体

async function load() {
  [state.questions, state.quizzes] = await Promise.all([api.listQuestions(), api.listAdminQuizzes()]);
}

async function start() {
  try {
    if (!(await api.adminSession())) return loginScreen();
    await load();
    draw();
  } catch (e) {
    root.innerHTML = `<p class="err">${h(translateError(e))}</p>`;
  }
}

function loginScreen() {
  root.innerHTML = `<section class="card login">
    <h1 class="title">Miacis クイズ 管理</h1>
    <form id="login" class="stack">
      <p class="hint">英単語サバイバルのスタッフと同じニックネームとあいことば</p>
      <label>ニックネーム<input name="email" autocomplete="username" required></label>
      <label>あいことば<input type="password" name="password" autocomplete="current-password" required></label>
      <p class="err" id="login-err" role="alert"></p>
      <button class="btn primary big">ログイン</button>
    </form>
  </section>`;
  document.getElementById('login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      await api.adminSignIn(f.get('email'), f.get('password'));
      start();
    } catch (e) {
      document.getElementById('login-err').textContent = translateError(e);
    }
  });
}

function draw() {
  const tabs = [['questions', `問題ストック ${state.questions.length}`], ['quizzes', 'クイズ'], ['coupons', 'クーポン']];
  root.innerHTML = `
    ${api.isDemo ? '<p class="demo-bar">お試しモード — この端末の中だけ。<button class="linkish" id="reset">最初の状態に戻す</button></p>' : ''}
    <header class="top">
      <h1>クイズ管理</h1>
      <span>
        <a class="me" href="index.html" target="_blank" rel="noopener">遊ぶ画面</a>
        ${api.isDemo ? '' : '<button class="me" id="logout">ログアウト</button>'}
      </span>
    </header>
    <nav class="tabs" role="tablist">
      ${tabs.map(([k, label]) => `<button role="tab" aria-selected="${state.tab === k}" data-tab="${k}">${label}</button>`).join('')}
    </nav>
    <p id="flash" class="flash" role="status"></p>
    <div id="panel"></div>`;
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; draw(); }));
  document.getElementById('logout')?.addEventListener('click', async () => { await api.adminSignOut(); start(); });
  document.getElementById('reset')?.addEventListener('click', () => { api.resetDemo(); location.reload(); });
  ({ questions: drawQuestions, quizzes: drawQuizzes, coupons: drawCoupons })[state.tab]();
}

// ---------------------------------------------------------------- 問題ストック

function questionForm() {
  const q = state.editingQuestion;
  const img = q?.image_path ? api.imageUrl(q.image_path) : null;
  const c = q ? q.choices : ['', '', '', ''];
  const correct = q ? c[q.answer] : '';
  const wrong = q ? c.filter((_, i) => i !== q.answer) : ['', '', ''];
  return `<section class="card">
    <h2 class="title">${q ? '問題を直す' : '問題を足す'}</h2>
    <form id="q-form" class="stack">
      <label>問題文<textarea name="body" rows="2" maxlength="300" required>${h(q?.body ?? '')}</textarea></label>
      <div class="img-field">
        <label class="btn" for="q-img">画像を選ぶ</label>
        <input id="q-img" type="file" accept="image/*" hidden>
        <img id="q-preview" class="thumb ${img ? '' : 'hidden'}" src="${h(img ?? '')}" alt="">
        <button type="button" class="linkish ${img ? '' : 'hidden'}" id="q-img-clear">画像を外す</button>
      </div>
      <label class="check"><input type="checkbox" name="speed" id="q-speed" ${q?.kind === 'speed' ? 'checked' : ''}> 正解なし（早押しだけ。選択肢はこの順で出る）</label>
      <label class="ok-label"><span data-l="0">${q?.kind === 'speed' ? '選択肢 1' : '正解'}</span><input name="correct" maxlength="80" required value="${h(correct)}"></label>
      ${wrong.map((w, i) => `<label><span data-l="${i + 1}">${q?.kind === 'speed' ? `選択肢 ${i + 2}` : `まちがい ${i + 1}`}</span><input name="wrong${i}" maxlength="80" required value="${h(w)}"></label>`).join('')}
      <label>タグ（任意・あとで探す用）<input name="tag" maxlength="30" list="tags" value="${h(q?.tag ?? '')}"></label>
      <p class="hint">選択肢の並びは、遊ぶ人ごとにまぜて出す</p>
      <div class="row">
        <button class="btn primary">${q ? '直す' : 'ストックに入れる'}</button>
        ${q ? '<button type="button" class="btn" id="q-cancel">やめる</button>' : ''}
      </div>
    </form>
  </section>`;
}

function drawQuestions() {
  const tags = [...new Set(state.questions.map((q) => q.tag).filter(Boolean))];
  const list = state.questions.filter((q) => !state.tagFilter || q.tag === state.tagFilter);
  const used = new Set(state.quizzes.filter((z) => z.status !== 'draft').flatMap((z) => z.question_ids));
  document.getElementById('panel').innerHTML = `
    <datalist id="tags">${tags.map((t) => `<option value="${h(t)}">`).join('')}</datalist>
    ${questionForm()}
    <details class="card">
      <summary>まとめて貼り付け</summary>
      <p class="hint">1行1問。「問題, 正解, まちがい, まちがい, まちがい」。表計算ソフトの5列をそのままコピーしてもいい（6列目はタグ）</p>
      <textarea id="bulk" rows="6" placeholder="1日は何時間？, 24時間, 12時間, 36時間, 48時間"></textarea>
      <label>タグ（6列目が無い行に付ける）<input id="bulk-tag" maxlength="30" list="tags"></label>
      <p id="bulk-msg" class="hint"></p>
      <button class="btn primary" id="bulk-go">取り込む</button>
    </details>
    <div class="list-head">
      <h2 class="sub">ストック ${list.length}問</h2>
      <select id="tag-filter" aria-label="タグで絞る">
        <option value="">すべてのタグ</option>
        ${tags.map((t) => `<option ${t === state.tagFilter ? 'selected' : ''}>${h(t)}</option>`).join('')}
      </select>
    </div>
    <ul class="q-list">
      ${list.map((q) => `<li>
        ${q.image_path ? `<img class="thumb" src="${h(api.imageUrl(q.image_path))}" alt="">` : '<span class="thumb none"></span>'}
        <div class="q-text">
          <p class="q-body">${h(q.body)}</p>
          <p class="q-choices">${q.kind === 'speed'
            ? `<span class="chip on">早押し</span> ${q.choices.map((c, i) => `<span>${i + 1}. ${h(c)}</span>`).join(' ')}`
            : `<span class="ok-mark">○ ${h(q.choices[q.answer])}</span> ${q.choices.filter((_, i) => i !== q.answer).map((c) => `<span>× ${h(c)}</span>`).join(' ')}`}</p>
          ${q.tag ? `<span class="chip">${h(q.tag)}</span>` : ''}
        </div>
        <div class="q-actions">
          <button class="linkish" data-edit="${q.id}">直す</button>
          ${used.has(q.id) ? '' : `<button class="linkish danger" data-del="${q.id}">消す</button>`}
        </div>
      </li>`).join('') || '<p class="empty">まだ問題が無い</p>'}
    </ul>`;

  let imagePath = state.editingQuestion?.image_path ?? null;
  const preview = document.getElementById('q-preview');
  const clear = document.getElementById('q-img-clear');
  document.getElementById('q-img').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      flash('画像を送っている…');
      imagePath = await api.uploadImage(await shrinkImage(file));
      preview.src = api.imageUrl(imagePath);
      preview.classList.remove('hidden');
      clear.classList.remove('hidden');
      flash('画像を入れた');
    } catch (e) { fail(e); }
  });
  document.getElementById('q-speed').addEventListener('change', (ev) => {
    const sp = ev.target.checked;
    document.querySelectorAll('#q-form [data-l]').forEach((el) => {
      const n = Number(el.dataset.l);
      el.textContent = sp ? `選択肢 ${n + 1}` : n === 0 ? '正解' : `まちがい ${n}`;
    });
  });
  clear.addEventListener('click', () => { imagePath = null; preview.classList.add('hidden'); clear.classList.add('hidden'); });
  document.getElementById('q-cancel')?.addEventListener('click', () => { state.editingQuestion = null; draw(); });
  document.getElementById('q-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      const q = buildQuestion({
        body: f.get('body'), correct: f.get('correct'),
        wrong: [f.get('wrong0'), f.get('wrong1'), f.get('wrong2')], tag: f.get('tag'), image_path: imagePath,
        kind: f.get('speed') ? 'speed' : 'quiz'
      });
      const editing = state.editingQuestion;
      await api.saveQuestion({ ...q, id: editing?.id });
      state.editingQuestion = null;
      await load();
      draw();
      flash(editing ? '直した' : 'ストックに入れた');
    } catch (e) { fail(e); }
  });

  document.getElementById('bulk-go').addEventListener('click', async () => {
    const { questions, errors } = parseBulk(document.getElementById('bulk').value, document.getElementById('bulk-tag').value);
    const msg = document.getElementById('bulk-msg');
    if (errors.length) {
      msg.innerHTML = errors.map((e) => `<span class="err">${e.line}行目: ${h(e.message)}</span>`).join('<br>');
      return;
    }
    if (!questions.length) { msg.textContent = '取り込む行が無い'; return; }
    try {
      await api.saveQuestions(questions);
      await load();
      draw();
      flash(`${questions.length}問をストックに入れた`);
    } catch (e) { fail(e); }
  });

  document.getElementById('tag-filter').addEventListener('change', (ev) => { state.tagFilter = ev.target.value; draw(); });
  document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    state.editingQuestion = state.questions.find((q) => q.id === b.dataset.edit);
    draw();
    window.scrollTo(0, 0);
  }));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '本当に消す'; return; }
    try {
      await api.deleteQuestion(b.dataset.del);
      await load();
      draw();
      flash('消した');
    } catch (e) { fail(e); }
  }));
}

// ---------------------------------------------------------------- クイズ

function quizBuilder(z) {
  const chosen = [...z.question_ids];
  const pool = state.questions;
  return `<section class="card builder" data-builder="${z.id}">
    <h3 class="title">問題を選ぶ（選んだ順に出る）</h3>
    <p class="hint" id="b-count">${chosen.length}問 選択中</p>
    <ul class="pick">
      ${pool.map((q) => {
        const n = chosen.indexOf(q.id);
        return `<li><label>
          <input type="checkbox" value="${q.id}" ${n >= 0 ? 'checked' : ''}>
          <span class="order">${n >= 0 ? n + 1 : ''}</span>
          <span class="q-body">${h(q.body)}</span>
          ${q.tag ? `<span class="chip">${h(q.tag)}</span>` : ''}
        </label></li>`;
      }).join('')}
    </ul>
    <div class="row">
      <button class="btn primary" id="b-save">この問題で保存</button>
      <button class="btn" id="b-cancel">やめる</button>
    </div>
  </section>`;
}

function quizItem(z) {
  const status = { draft: '下書き', open: '公開中', closed: '締め切り' }[z.status];
  const editing = state.editingQuiz === z.id;
  return `<article class="quiz-card admin-quiz">
    <div class="quiz-head">
      <span class="chip ${z.status === 'open' ? 'on' : ''}">${status}</span>
      <span class="meta">${z.question_ids.length}問 · 1問${z.time_limit_sec}秒${z.prize ? ` · 1位 🏆 ${h(z.prize)}` : ''}${z.coupon_url ? ' · クーポン URL あり' : ' · クーポン URL なし'}</span>
    </div>
    <h2>${h(z.title)}</h2>
    ${z.status === 'closed' ? (z.closes_at ? `<p class="deadline">${h(formatDeadline(z.closes_at))} 締め切り</p>` : '') : `
    <form class="row deadline-form" data-deadline="${z.id}">
      <label class="grow">締め切り（この時刻に自動で閉じ、1位にクーポンと LINE）<input type="datetime-local" name="closes_at" value="${h(isoToDeadlineInput(z.closes_at))}"></label>
      <button class="btn">変える</button>
    </form>`}
    <div class="row wrap">
      ${z.status === 'draft' ? `
        <button class="btn" data-pick="${z.id}">問題を選ぶ</button>
        <button class="btn" data-breaks="${z.id}">お知らせ（CM）</button>
        <button class="btn primary" data-open="${z.id}" ${z.question_ids.length ? '' : 'disabled'}>公開</button>
        <button class="linkish danger" data-delquiz="${z.id}">消す</button>` : ''}
      ${z.status === 'open' ? `
        <button class="btn" data-copy="${z.id}">リンクをコピー</button>
        <button class="btn" data-rank="${z.id}">ランキング</button>
        <button class="btn" data-breaks="${z.id}">お知らせ（CM）</button>
        <button class="btn danger" data-close="${z.id}">締め切る</button>` : ''}
      ${z.status === 'closed' ? `<button class="btn" data-rank="${z.id}">結果</button>` : ''}
    </div>
    ${z.status === 'open' ? `<p class="hint url">${h(playUrl(z.id))}</p>` : ''}
    <div id="rank-${z.id}"></div>
    ${state.editingBreaks === z.id ? `<div class="card builder" id="breaks-${z.id}"><p class="empty">読み込み中…</p></div>` : ''}
    ${editing ? quizBuilder(z) : ''}
  </article>`;
}

function drawQuizzes() {
  document.getElementById('panel').innerHTML = `
    <section class="card">
      <h2 class="title">クイズを作る</h2>
      <form id="z-form" class="stack">
        <label>タイトル<input name="title" maxlength="60" required placeholder="例: 10月 地元クイズ"></label>
        <label>1問の制限時間（秒）<input name="limit" type="number" min="5" max="120" value="15" required></label>
        <label>1位のごほうび<input name="prize" maxlength="80" value="購買で使えるクーポン"></label>
        <label>公式LINEのクーポンの URL（1位の人にだけ見える・任意）<input name="coupon_url" type="url" maxlength="500" placeholder="https://"></label>
        <label>締め切り（この時刻までに終えた人で順位を決める）<input name="closes_at" type="datetime-local" value="${defaultDeadlineInput()}"></label>
        <button class="btn primary">下書きを作る</button>
      </form>
      <p class="hint">作ったら「問題を選ぶ」→「お知らせ（CM）」（任意）→「公開」。公開したらリンクを公式LINEで送る（開くと LINE でログインして参加）。締め切りの時刻に自動で閉じ、1位にクーポンが出て公式LINE で知らせる</p>
    </section>
    ${state.quizzes.map(quizItem).join('') || '<p class="empty">まだクイズが無い</p>'}`;

  document.getElementById('z-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      const url = f.get('coupon_url').trim();
      if (url && !/^https:\/\//.test(url)) throw new Error('クーポンの URL は https:// で始まるものだけ');
      const z = await api.saveQuiz({ title: f.get('title').trim(), time_limit_sec: Number(f.get('limit')), prize: f.get('prize').trim() || null,
        coupon_url: url || null, closes_at: deadlineInputToIso(f.get('closes_at')) });
      state.editingQuiz = z.id;
      await load();
      draw();
      flash('下書きを作った。次は問題を選ぶ');
    } catch (e) { fail(e); }
  });

  const on = (attr, fn) => document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => fn(b.dataset[attr], b)));
  on('pick', (id) => { state.editingQuiz = state.editingQuiz === id ? null : id; draw(); });
  on('open', async (id) => {
    try { await api.openQuiz(id); await load(); draw(); flash('公開した。リンクを公式LINEなどで送る'); } catch (e) { fail(e); }
  });
  on('delquiz', async (id, b) => {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '本当に消す'; return; }
    try { await api.deleteQuiz(id); await load(); draw(); flash('消した'); } catch (e) { fail(e); }
  });
  on('copy', async (id) => {
    try { await navigator.clipboard.writeText(playUrl(id)); flash('リンクをコピーした'); } catch { flash('コピーできなかった。下のリンクを長押しでコピー', 'ng'); }
  });
  on('rank', (id) => showRanking(id));
  on('breaks', (id) => { state.editingBreaks = state.editingBreaks === id ? null : id; draw(); });
  document.querySelectorAll('[data-deadline]').forEach((form) => form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const z = state.quizzes.find((q) => q.id === form.dataset.deadline);
    try {
      await api.saveQuiz({ ...z, closes_at: deadlineInputToIso(new FormData(form).get('closes_at')) });
      await load();
      draw();
      flash('締め切りを変えた');
    } catch (e) { fail(e); }
  }));
  if (state.editingBreaks) drawBreaks(state.quizzes.find((q) => q.id === state.editingBreaks));
  on('close', async (id, b) => {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '締め切って1位にクーポンを出す'; return; }
    try {
      const r = await api.closeQuiz(id);
      await load();
      draw();
      flash(r.winner ? `締め切った。1位 ${r.winner} にクーポン ${r.code}（${PUSH[r.push] ?? r.push ?? ''}）` : '締め切った。終えた人がいないのでクーポンは無し');
      showRanking(id);
    } catch (e) { fail(e); }
  });

  const builder = document.querySelector('[data-builder]');
  if (builder) {
    const quiz = state.quizzes.find((z) => z.id === builder.dataset.builder);
    const order = [...quiz.question_ids];
    const renumber = () => {
      builder.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        const n = order.indexOf(cb.value);
        cb.parentElement.querySelector('.order').textContent = n >= 0 ? n + 1 : '';
      });
      document.getElementById('b-count').textContent = `${order.length}問 選択中`;
    };
    builder.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
      const i = order.indexOf(cb.value);
      if (cb.checked && i < 0) order.push(cb.value);
      if (!cb.checked && i >= 0) order.splice(i, 1);
      renumber();
    }));
    document.getElementById('b-cancel').addEventListener('click', () => { state.editingQuiz = null; draw(); });
    document.getElementById('b-save').addEventListener('click', async () => {
      try {
        await api.setQuizQuestions(quiz.id, order);
        state.editingQuiz = null;
        await load();
        draw();
        flash(`${order.length}問で保存した`);
      } catch (e) { fail(e); }
    });
  }
}

const PUSH = { sent: 'LINE で送った', no_token: 'LINE は未設定', demo: 'お試し', error: 'LINE に送れず' };

// お知らせ（CM）: 「◯問目のあと」に告知を挟む。1問のあとに1つまで
async function drawBreaks(z) {
  const box = document.getElementById(`breaks-${z.id}`);
  if (!box) return;
  try {
    const list = await api.listBreaks(z.id);
    const n = Math.max(z.question_ids.length, 1);
    box.innerHTML = `
      <h3 class="title">お知らせ（CM）</h3>
      <p class="hint">「◯問目のあと」に告知を出す。決めた秒数は見てもらってから、つづきへ進む（制限時間は止まっている）</p>
      <ul class="q-list">${list.map((b) => `<li>
        ${b.image_path ? `<img class="thumb" src="${h(api.imageUrl(b.image_path))}" alt="">` : '<span class="thumb none"></span>'}
        <div class="q-text"><p class="q-body">${b.after_position}問目のあと · ${h(b.title)}</p>
          <p class="q-choices">${h(b.body ?? '')} · ${b.seconds}秒${b.link_url ? ' · リンクあり' : ''}</p></div>
        <div class="q-actions"><button class="linkish danger" data-delbreak="${b.id}">消す</button></div>
      </li>`).join('') || '<p class="empty">まだ無い</p>'}</ul>
      <form id="break-form" class="stack">
        <label>何問目のあと<select name="after">${Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${i + 1}問目のあと</option>`).join('')}</select></label>
        <label>見出し<input name="title" maxlength="40" required placeholder="例: 土曜はボードゲーム会"></label>
        <label>本文（任意）<textarea name="body" rows="2" maxlength="300"></textarea></label>
        <div class="img-field">
          <label class="btn" for="break-img">画像を選ぶ</label>
          <input id="break-img" type="file" accept="image/*" hidden>
          <img id="break-preview" class="thumb hidden" alt="">
        </div>
        <label>リンク（任意・https://）<input name="link" type="url" maxlength="500"></label>
        <label>見せる秒数<input name="seconds" type="number" min="3" max="30" value="6"></label>
        <button class="btn primary">お知らせを入れる</button>
      </form>`;
    let imagePath = null;
    document.getElementById('break-img').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        imagePath = await api.uploadImage(await shrinkImage(file));
        const img = document.getElementById('break-preview');
        img.src = api.imageUrl(imagePath);
        img.classList.remove('hidden');
      } catch (e) { fail(e); }
    });
    document.getElementById('break-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const link = f.get('link').trim();
      try {
        if (link && !/^https:\/\//.test(link)) throw new Error('リンクは https:// で始まるものだけ');
        await api.saveBreak({ quiz_id: z.id, after_position: Number(f.get('after')), title: f.get('title').trim(),
          body: f.get('body').trim() || null, image_path: imagePath, link_url: link || null, seconds: Number(f.get('seconds')) });
        flash('お知らせを入れた');
        drawBreaks(z);
      } catch (e) { fail(e); }
    });
    box.querySelectorAll('[data-delbreak]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '本当に消す'; return; }
      try { await api.deleteBreak(b.dataset.delbreak); drawBreaks(z); } catch (e) { fail(e); }
    }));
  } catch (e) { fail(e); }
}

async function showRanking(id) {
  const box = document.getElementById(`rank-${id}`);
  if (!box) return;
  try {
    const rows = await api.ranking(id);
    box.innerHTML = rows.length ? `<ol class="ranking">${rows.map((r) => `
      <li class="${r.rank === 1 ? 'first' : ''}"><span class="pos">${r.rank === 1 ? '👑' : r.rank}</span>
      <span class="name">${h(r.nickname)}</span><span class="pts">${r.correct}問</span><span class="ms">${formatMs(r.total_ms)}</span></li>`).join('')}</ol>`
      : '<p class="empty">まだだれも終えていない</p>';
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- クーポン

async function drawCoupons() {
  const panel = document.getElementById('panel');
  panel.innerHTML = `
    <section class="card">
      <h2 class="title">クーポンを使用済みにする</h2>
      <form id="use-form" class="row">
        <input name="code" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="6文字のコード" required aria-label="クーポンのコード">
        <button class="btn primary">使用済み</button>
      </form>
      <p id="use-msg" class="hint" role="status"></p>
    </section>
    <ul class="coupon-list" id="coupon-list"><li class="empty">読み込み中…</li></ul>`;
  document.getElementById('use-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = document.getElementById('use-msg');
    try {
      const r = await api.useCoupon(new FormData(ev.target).get('code'));
      msg.innerHTML = `<strong>${h(r.code)}</strong> ${h(r.nickname ?? '')} · ${h(r.prize ?? '')} を使用済みにした`;
      ev.target.reset();
      drawCouponList();
    } catch (e) { msg.innerHTML = `<span class="err">${h(translateError(e))}</span>`; }
  });
  drawCouponList();
}

async function drawCouponList() {
  try {
    const list = await api.adminCoupons();
    document.getElementById('coupon-list').innerHTML = list.map((c) => `<li class="${c.used_at ? 'used' : ''}">
      <span class="code">${h(c.code)}</span>
      <span>${h(c.nickname ?? '')}<br><small>${h(c.quiz_title ?? '')} · ${h(c.prize ?? '')}</small></span>
      <span class="chips"><span class="chip ${c.used_at ? '' : 'on'}">${c.used_at ? '使用済み' : '未使用'}</span>
        ${c.push_status ? `<span class="chip">${h(PUSH[c.push_status] ?? 'LINE に送れず')}</span>` : ''}</span>
    </li>`).join('') || '<li class="empty">まだクーポンは出ていない</li>';
  } catch (e) { fail(e); }
}

start();
