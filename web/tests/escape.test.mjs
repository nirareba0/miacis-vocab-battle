import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, escapeDeep } from '../js/logic.js';

test('escapeHtml は HTML の特殊文字をすべて無害にする', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('x')">&`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
  assert.equal(escapeHtml('ふつうの ニックネーム'), 'ふつうの ニックネーム');
});

test('escapeDeep は入れ子の文字列まで写しでエスケープし、元を変えない', () => {
  const src = { nickname: '<b>x</b>', n: 3, ok: true, none: null, list: [{ text: '<script>' }, 'a&b'] };
  const out = escapeDeep(src);
  assert.deepEqual(out, { nickname: '&lt;b&gt;x&lt;/b&gt;', n: 3, ok: true, none: null, list: [{ text: '&lt;script&gt;' }, 'a&amp;b'] });
  assert.equal(src.nickname, '<b>x</b>');
});
