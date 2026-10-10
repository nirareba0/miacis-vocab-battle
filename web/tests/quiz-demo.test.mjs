// お試しモードが本番と同じ決まりで動くか（localStorage を差し替えて Node で動かす）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
const api = await import('../quiz/js/backend-demo.js');

beforeEach(() => store.clear());

async function playAll(quizId, { wrong = false } = {}) {
  const s = await api.startAttempt(quizId);
  for (;;) {
    const q = await api.nextQuestion(s.attempt_id);
    if (q.done) return q;
    // 見本の問題は正解が choices[0]。並びはまぜてあるので、答えを1回外して位置を知る方法は使えない。
    // デモの中身を読んで正解の位置を探す
    const state = JSON.parse(store.get('miacis-quiz-demo-v2'));
    const question = state.questions.find((x) => x.body === q.body);
    const right = q.choices.indexOf(question.choices[question.answer]);
    await api.answer(s.attempt_id, wrong ? (right + 1) % 4 : right);
  }
}

test('名前が無いと挑戦できない。見本の参加者と同じ名前は使えない', async () => {
  const [z] = await api.listQuizzes();
  await assert.rejects(api.startAttempt(z.id), /no_nickname/);
  await assert.rejects(api.register('みお', true), /nickname_taken/);
  await api.register('そら', true);
});

test('答える前に正解は渡らず、全問正解で1位。締め切るとクーポンが届き、使用済みにできる', async () => {
  await api.register('そら', true);
  const [z] = await api.listQuizzes();
  const q = await api.nextQuestion((await api.startAttempt(z.id)).attempt_id);
  assert.ok(!('answer' in q));
  store.clear();
  await api.register('そら', true);
  const [z2] = await api.listQuizzes();
  const done = await playAll(z2.id);
  assert.equal(done.correct, done.total);
  await assert.rejects(api.startAttempt(z2.id), /already_played/);
  const rank = await api.ranking(z2.id);
  assert.equal(rank[0].nickname, 'そら');
  assert.ok(rank[0].is_me);
  const closed = await api.closeQuiz(z2.id);
  assert.equal(closed.winner, 'そら');
  const [c] = await api.myCoupons();
  assert.equal(c.code, closed.code);
  await api.useCoupon(closed.code.toLowerCase());
  await assert.rejects(api.useCoupon(closed.code), /coupon_used/);
});

test('全部まちがえたら1位にならず、クーポンは見本の1位へ', async () => {
  await api.register('そら', true);
  const [z] = await api.listQuizzes();
  await playAll(z.id, { wrong: true });
  const r = await api.closeQuiz(z.id);
  assert.equal(r.winner, 'スタッフK');
  assert.equal((await api.myCoupons()).length, 0);
});

test('問題をストックして、クイズを組み、公開すると一覧に出る', async () => {
  const [q] = await api.saveQuestions([{ body: '新しい問題', choices: ['a', 'b', 'c', 'd'], answer: 0, tag: null, image_path: null }]);
  const z = await api.saveQuiz({ title: '新作', time_limit_sec: 10, prize: null });
  assert.ok(!(await api.listQuizzes()).some((x) => x.id === z.id));
  await assert.rejects(api.openQuiz(z.id), /quiz_empty/);
  await api.setQuizQuestions(z.id, [q.id]);
  await api.openQuiz(z.id);
  assert.ok((await api.listQuizzes()).some((x) => x.id === z.id));
  await assert.rejects(api.deleteQuestion(q.id), /foreign key/);
});
