import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nicknameToEmail,
  extractYouTubeId,
  validateWriting,
  isMyRow,
  formatRank,
  gradeToLabel,
  tierToLabel,
  translateError
} from '../js/logic.js';


test('nicknameToEmail: メール生成の規則と一貫性', () => {
  // 基本的なASCIIニックネーム
  const email1 = nicknameToEmail('alice');
  assert.equal(email1, 'v_616c696365@players.miacis-vocab.example');

  // 同じニックネームは常に同じメールアドレスになる
  assert.equal(nicknameToEmail('alice'), email1);

  // 日本語ニックネーム (NFC)
  const emailJp = nicknameToEmail('たろう');
  const expectedHex = Buffer.from('たろう', 'utf8').toString('hex');
  assert.equal(emailJp, `v_${expectedHex}@players.miacis-vocab.example`);

  // NFC正規化の確認: 濁点結合文字 (NFD: か + ゛) と 合成済み (NFC: が)
  const nfdGa = '\u304B\u3099'; // か + combining dakuten
  const nfcGa = '\u304C'; // が
  assert.equal(nicknameToEmail(nfdGa), nicknameToEmail(nfcGa));

  // 全角/半角英数は NFC では統一されない（別人でよい）
  assert.notEqual(nicknameToEmail('Ａ'), nicknameToEmail('A'));

  // 不正な引数のチェック
  assert.throws(() => nicknameToEmail(123), TypeError);
  assert.throws(() => nicknameToEmail(null), TypeError);
});

test('extractYouTubeId: YouTube URL からの ID 抽出', () => {
  // 標準の watch URL
  assert.equal(
    extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  // クエリパラメータ付き (時間指定など)
  assert.equal(
    extractYouTubeId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s'),
    'dQw4w9WgXcQ'
  );
  // youtu.be 短縮 URL
  assert.equal(
    extractYouTubeId('https://youtu.be/dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  assert.equal(
    extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=10'),
    'dQw4w9WgXcQ'
  );
  // embed URL
  assert.equal(
    extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  // youtube-nocookie
  assert.equal(
    extractYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  // モバイル URL
  assert.equal(
    extractYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  // shorts
  assert.equal(
    extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );

  // 無効な URL や YouTube 以外の URL
  assert.equal(extractYouTubeId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractYouTubeId('not a url'), null);
  assert.equal(extractYouTubeId(''), null);
  assert.equal(extractYouTubeId(null), null);
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=short'), null);
});

test('validateWriting: 共通バリデーション (文字数・繰り返し・英語率・重複)', () => {
  const prompt = { type: 'three_words' };

  // 空文字・trim 後に 0 文字
  assert.equal(validateWriting('', prompt).valid, false);
  assert.equal(validateWriting('   ', prompt).valid, false);

  // 300文字超え
  const tooLong = 'a '.repeat(151); // 302 chars
  assert.equal(validateWriting(tooLong, prompt).valid, false);

  // 6文字以上の連続
  assert.equal(validateWriting('I loveeeeeee cat', prompt).valid, false);

  // 英語率が 80% 未満 (日本語が多すぎる)
  assert.equal(validateWriting('This is ねこ です', prompt).valid, false);

  // 過去の投稿との重複 (空白・大文字小文字無視)
  const past = ['I like cats'];
  assert.equal(validateWriting('i like cats', prompt, past).valid, false);
  assert.equal(validateWriting('I  LIKE   CATS', prompt, past).valid, false);
  assert.equal(validateWriting('I love cats', prompt, past).valid, true);
});

test('validateWriting: use_word プロンプトの検査', () => {
  const prompt = {
    type: 'use_word',
    words: ['play', 'sing']
  };

  // 通る例 (単語の原形を含む、3語以上)
  assert.equal(validateWriting('I play tennis', prompt).valid, true);

  // 通る例 (活用形: -s, -ed, -ing を含む)
  assert.equal(validateWriting('He plays soccer', prompt).valid, true);
  assert.equal(validateWriting('They played baseball', prompt).valid, true);
  assert.equal(validateWriting('We are playing soccer', prompt).valid, true);
  assert.equal(validateWriting('She is singing songs', prompt).valid, true);

  // 通らない例: 単語数が足りない (< 3語)
  assert.equal(validateWriting('I play', prompt).valid, false);

  // 通らない例: 指定された単語を含まない
  assert.equal(validateWriting('I eat delicious sushi', prompt).valid, false);

  // 通らない例: 単語の一部として含まれるが語境界ではない (例: display は play ではない)
  assert.equal(validateWriting('This is a great display', prompt).valid, false);
});

test('validateWriting: three_words プロンプトの検査', () => {
  const prompt = { type: 'three_words' };

  // 通る例 (ちょうど3語)
  assert.equal(validateWriting('I like cats', prompt).valid, true);
  assert.equal(validateWriting('It was cool!', prompt).valid, true);
  assert.equal(validateWriting("Don't give up", prompt).valid, true);

  // 通らない例: 2語
  assert.equal(validateWriting('Too short', prompt).valid, false);

  // 通らない例: 4語
  assert.equal(validateWriting('I really like cats', prompt).valid, false);
});

test('validateWriting: what_would_you_do プロンプトの検査', () => {
  const prompt = { type: 'what_would_you_do' };

  // 通る例 (5語以上)
  assert.equal(validateWriting('I would study very hard', prompt).valid, true);
  assert.equal(validateWriting('I will travel around the world', prompt).valid, true);

  // 通らない例: 4語以下
  assert.equal(validateWriting('I would study hard', prompt).valid, false);
  assert.equal(validateWriting('I will sleep now', prompt).valid, false);
});

test('isMyRow: ランキングの自分判定', () => {
  const myNick = 'たろう';
  assert.equal(isMyRow({ nickname: 'たろう', tier: 1 }, myNick), true);
  assert.equal(isMyRow({ nickname: 'はなこ', tier: 1 }, myNick), false);
  assert.equal(isMyRow(null, myNick), false);
  assert.equal(isMyRow({ nickname: 'たろう' }, ''), false);
});

test('formatRank / gradeToLabel / tierToLabel: 表示フォーマット', () => {
  assert.equal(formatRank(1), '🥇 1位');
  assert.equal(formatRank(2), '🥈 2位');
  assert.equal(formatRank(3), '🥉 3位');
  assert.equal(formatRank(4), '4位');

  assert.equal(gradeToLabel(1), '中1');
  assert.equal(gradeToLabel(3), '中3');
  assert.equal(gradeToLabel(4), '高1');
  assert.equal(gradeToLabel(6), '高3');

  assert.equal(tierToLabel(1), '段1');
  assert.equal(tierToLabel(5), '段5');
});

test('translateError: エラーメッセージの日本語変換', () => {
  assert.equal(translateError('nickname_taken'), 'その名前はもう使われている。自分の名前なら「ログイン」タブから');
  assert.equal(translateError('invalid_nickname_length'), 'ニックネームは1〜10文字で入力してください');
  assert.equal(translateError('invalid_grade'), '学年を正しく選択してください');
  assert.equal(translateError('too_fast'), '回答時間が短すぎます');
  assert.equal(translateError('writing_invalid: length must be 1..300 characters'), '一言は1〜300文字で入力してください');
  assert.equal(translateError(new Error('Password should be at least 6 characters')), 'パスワードは6文字以上で入力してください');
  assert.equal(translateError('unknown_error_xyz'), 'うまくいかなかった。もう一度');
  assert.equal(translateError(null), 'うまくいかなかった。もう一度');
});



test('normalizeNickname: 波線の種類と前後の空白をそろえる（端末ごとの打ち分けでログインできなくならない）', async () => {
  const { normalizeNickname, nicknameToEmail } = await import('../js/logic.js');
  for (const v of ['にしむ～', 'にしむ〜', 'にしむ~', ' にしむ～ ', 'にしむ∼']) {
    assert.equal(normalizeNickname(v), 'にしむ～', v);
    assert.equal(nicknameToEmail(v), nicknameToEmail('にしむ～'), v);
  }
  assert.equal(normalizeNickname('ひかり'), 'ひかり');
});
