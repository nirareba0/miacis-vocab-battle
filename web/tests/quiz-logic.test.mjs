import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBulk, buildQuestion, formatMs, rankSummary, translateError, escapeHtml, timerRatio } from '../quiz/js/logic.js';

test('まとめて貼り付け: カンマとタブ、6列目のタグ、行ごとのエラー', () => {
  const text = [
    '# 見出しは飛ばす',
    '1日は何時間？, 24時間, 12時間, 36時間, 48時間',
    '色は？\t赤\t青\t黄\t白\tくらし',
    '',
    '足りない, a, b, c',
    '重なり, a, a, b, c'
  ].join('\n');
  const { questions, errors } = parseBulk(text, '既定');
  assert.equal(questions.length, 2);
  assert.deepEqual(questions[0], { body: '1日は何時間？', choices: ['24時間', '12時間', '36時間', '48時間'], answer: 0, tag: '既定', image_path: null });
  assert.equal(questions[1].tag, 'くらし');
  assert.deepEqual(errors.map((e) => e.line), [5, 6]);
});

test('問題1つ: 空・重なり・長さ', () => {
  assert.throws(() => buildQuestion({ body: '', correct: 'a', wrong: ['b', 'c', 'd'] }), /問題文/);
  assert.throws(() => buildQuestion({ body: 'q', correct: 'a', wrong: ['b', '', 'd'] }), /3つ/);
  assert.throws(() => buildQuestion({ body: 'q', correct: 'a', wrong: ['a', 'c', 'd'] }), /重なって/);
  assert.throws(() => buildQuestion({ body: 'x'.repeat(301), correct: 'a', wrong: ['b', 'c', 'd'] }), /300/);
  assert.equal(buildQuestion({ body: ' q ', correct: 'a', wrong: ['b', 'c', 'd'], tag: ' ' }).tag, null);
});

test('表示の小物', () => {
  assert.equal(formatMs(12345), '12.3秒');
  assert.equal(formatMs(-5), '0.0秒');
  assert.equal(escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(timerRatio(7500, 15), 0.5);
  assert.equal(timerRatio(-1, 15), 0);
  assert.deepEqual(rankSummary([{ rank: 1 }, { rank: 2, is_me: true }, { rank: 3 }, { rank: 4 }]), { rank: 2, total: 4, beaten: 2 });
  assert.equal(rankSummary([{ rank: 1 }]), null);
  assert.equal(translateError(new Error('ERROR: nickname_taken')), 'その名前はもう使われている');
  assert.match(translateError(new Error('violates foreign key constraint')), /消せない/);
});
