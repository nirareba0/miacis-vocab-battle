// 単語データ（data/words_v2.csv → seed/words_v2.sql）の検査。2026-10-03 A1 の訳の見直し
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lines = fs.readFileSync(path.join(root, 'data', 'words_v2.csv'), 'utf8').trim().split(/\r?\n/);
const head = lines[0].split(',');
const rows = lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
const byEn = Object.fromEntries(rows.map(r => [r.en, r]));
const seed = fs.readFileSync(path.join(root, 'supabase', 'seed', 'words_v2.sql'), 'utf8');

// カタカナをひらがなに（「バラ、ばら」のような同じ意味の重ねを見つける）
const hira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

test('A1 は中学生が最初に覚える意味が先頭（2026-10-03 のプレイで見つけた語）', () => {
  const first = en => byEn[en].ja.split('、')[0];
  assert.equal(first('party'), 'パーティー');
  assert.equal(first('fan'), 'ファン');
  assert.equal(first('sentence'), '文');
  assert.equal(first('arm'), '腕');
  assert.match(first('saw'), /^見た/);
  assert.equal(byEn.rose.ja, 'バラ');
  assert.equal(byEn.island.ja, '島');
});

test('1つの語の訳に、同じ意味を2回書かない', () => {
  const dup = rows.filter(r => {
    const parts = r.ja.split('、').map(s => hira(s.trim()));
    return new Set(parts).size !== parts.length;
  }).map(r => `${r.en} ${r.ja}`);
  assert.deepEqual(dup, []);
});

test('月・曜日・敬称・略語は大文字。seed は前の版の小文字の行を id を保ったまま直す', () => {
  for (const en of ['January', 'March', 'July', 'December', 'Monday', 'Sunday', 'Mr.', 'Mrs.', 'Ms.', 'TV', 'OK', 'Olympics']) {
    assert.ok(byEn[en], `${en} が無い`);
  }
  assert.equal(byEn.March.ja, '3月');
  assert.equal(byEn.july, undefined);
  assert.match(seed, /update public\.words set en = 'July' where en = 'july';/);
  assert.match(seed, /update public\.words set en = 'Mr\.' where en = 'mr';/);
  // 直すのは active を落とす前（行が見つからないと新しい行になり、図鑑の記録と別の語になる）
  assert.ok(seed.indexOf("set en = 'July'") < seed.indexOf('update public.words set active = false'));
  // 大文字の語のつづりの罠も大文字で始める（小文字だけが罠だと見分けがついてしまう）
  assert.ok(byEn.July.misspellings.split('|').every(s => /^[A-Z]/.test(s)));
});

test('同じ語（大文字小文字・ピリオド違いを含む）が2回ない', () => {
  const keys = rows.map(r => r.en.toLowerCase().replace(/\./g, ''));
  assert.equal(new Set(keys).size, keys.length);
});
