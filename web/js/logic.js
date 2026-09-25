/**
 * logic.js - miacis-vocab-battle の純粋なロジック関数
 */

/**
 * ニックネームから Supabase Auth 用のメールアドレスを機械的に生成する
 * 規則:
 * 1. nickname を Unicode NFC 正規化
 * 2. UTF-8 バイト列に変換
 * 3. 16進数文字列に変換
 * 4. `v_<hex>@players.miacis-vocab.example` の形式
 *
 * @param {string} nickname
 * @returns {string}
 */
export function nicknameToEmail(nickname) {
  if (typeof nickname !== 'string') {
    throw new TypeError('ニックネームは文字列である必要があります');
  }
  const normalized = nickname.normalize('NFC');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(normalized);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `v_${hex}@players.miacis-vocab.example`;
}

/**
 * YouTube の URL から動画 ID (11文字) を抽出する
 * 対応形式:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube-nocookie.com/embed/VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 * - shorts や /v/ 形式
 *
 * @param {string} url
 * @returns {string|null}
 */
export function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }

    const validHosts = [
      'www.youtube.com',
      'youtube.com',
      'm.youtube.com',
      'www.youtube-nocookie.com'
    ];

    if (validHosts.includes(host)) {
      if (parsed.pathname === '/watch') {
        const v = parsed.searchParams.get('v');
        return v && /^[\w-]{11}$/.test(v) ? v : null;
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'embed' || parts[0] === 'v' || parts[0] === 'shorts')) {
        const id = parts[1];
        return id && /^[\w-]{11}$/.test(id) ? id : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 英語の一言（writing）のバリデーション
 * DB の submit_writing (0002_functions.sql) と同じ規則でクライアント側でも検査する
 *
 * @param {string} text - 入力された一言
 * @param {{ type: string, words?: string[] }} prompt - writing_prompt 設定
 * @param {string[]} [pastWritings=[]] - 過去の自分の投稿一覧（重複検知用）
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateWriting(text, prompt, pastWritings = []) {
  if (typeof text !== 'string') {
    return { valid: false, error: '一言を入力してください' };
  }

  // 1. 文字数: trim で 1 文字以上、全体で 300 文字以下
  const trimmedLen = text.trim().length;
  if (trimmedLen < 1) {
    return { valid: false, error: '1文字以上入力してください' };
  }
  if (text.length > 300) {
    return { valid: false, error: '300文字以内で入力してください' };
  }

  // 2. 同じ文字の6回以上連続を禁止
  if (/(.)\1{5}/i.test(text)) {
    return { valid: false, error: '同じ文字が連続しすぎています' };
  }

  // 3. 英語文字・空白・基本記号が全体の80%以上
  // [A-Za-z0-9\s.,!?''"\-~;:()\/]
  const validChars = text.replace(/[^A-Za-z0-9\s.,!?''"\-~;:()\/]/g, '');
  if (validChars.length / text.length < 0.8) {
    return { valid: false, error: '英語を中心に書いてください' };
  }

  // 4. 過去の自分の投稿と同一内容（大文字小文字・空白無視）の禁止
  const norm = text.toLowerCase().replace(/\s+/g, '');
  const hasDup = pastWritings.some(pw => {
    if (typeof pw !== 'string') return false;
    return pw.toLowerCase().replace(/\s+/g, '') === norm;
  });
  if (hasDup) {
    return { valid: false, error: '以前書いた一言と同じ内容は投稿できません' };
  }

  // 5. 英単語数のカウント: [A-Za-z]+('[A-Za-z]+)?
  const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
  const wordCount = words.length;

  if (!prompt || typeof prompt !== 'object' || !prompt.type) {
    return { valid: false, error: '出題形式が不明です' };
  }

  // 6. プロンプト種類ごとの検査
  if (prompt.type === 'use_word') {
    if (wordCount < 3) {
      return { valid: false, error: '英語を3語以上使ってください' };
    }
    const targetWords = Array.isArray(prompt.words) ? prompt.words : [];
    let matched = false;
    for (const w of targetWords) {
      if (typeof w !== 'string') continue;
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}(?:s|ed|ing)?\\b`, 'i');
      if (re.test(text)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      const listStr = targetWords.join(', ');
      return {
        valid: false,
        error: `指定された単語（${listStr}）のどれかを使ってください`
      };
    }
  } else if (prompt.type === 'three_words') {
    if (wordCount !== 3) {
      return {
        valid: false,
        error: `英語ちょうど3語で書いてください（現在: ${wordCount}語）`
      };
    }
  } else if (prompt.type === 'what_would_you_do') {
    if (wordCount < 5) {
      return {
        valid: false,
        error: `英語を5語以上使ってください（現在: ${wordCount}語）`
      };
    }
  } else {
    return { valid: false, error: '未知の出題形式です' };
  }

  return { valid: true };
}

/**
 * ランキングの行が自分自身のものかを判定する
 *
 * @param {{ nickname: string }} row
 * @param {string} myNickname
 * @returns {boolean}
 */
export function isMyRow(row, myNickname) {
  if (!row || !myNickname) return false;
  return row.nickname === myNickname;
}

/**
 * 順位の表示用テキスト（1〜3位にはメダル絵文字）
 *
 * @param {number} rank
 * @returns {string}
 */
export function formatRank(rank) {
  if (rank === 1) return '🥇 1位';
  if (rank === 2) return '🥈 2位';
  if (rank === 3) return '🥉 3位';
  return `${rank}位`;
}

/**
 * 学年番号（1〜6）を日本語表記に変換
 *
 * @param {number} grade
 * @returns {string}
 */
export function gradeToLabel(grade) {
  const map = {
    1: '中1',
    2: '中2',
    3: '中3',
    4: '高1',
    5: '高2',
    6: '高3'
  };
  return map[grade] || `学年${grade}`;
}

/**
 * 段位番号（1〜5）を日本語表記に変換
 *
 * @param {number} tier
 * @returns {string}
 */
export function tierToLabel(tier) {
  return `段${tier}`;
}

/**
 * Supabase や Postgres のエラーメッセージをわかりやすい日本語の一文に変換する
 *
 * @param {any} error
 * @returns {string}
 */
export function translateError(error) {
  if (!error) return 'エラーが発生しました';
  const msg = typeof error === 'string' ? error : error.message || '';

  if (msg.includes('nickname_taken')) {
    return 'そのニックネームはもう使われています';
  }
  if (msg.includes('invalid_nickname_length')) {
    return 'ニックネームは1〜10文字で入力してください';
  }
  if (msg.includes('invalid_nickname_control_chars')) {
    return 'ニックネームに使えない文字が含まれています';
  }
  if (msg.includes('invalid_grade')) {
    return '学年を正しく選択してください';
  }
  if (msg.includes('not_authenticated')) {
    return 'ログインしてください';
  }
  if (msg.includes('Invalid login credentials')) {
    return 'ニックネームまたはあいことばが違います';
  }
  if (msg.includes('User already registered')) {
    return 'そのニックネームはすでに登録されています';
  }
  if (msg.includes('Password should be at least 6 characters')) {
    return 'あいことばは6文字以上で入力してください';
  }
  if (msg.includes('too_fast')) {
    return '回答時間が短すぎます';
  }
  if (msg.includes('expired')) {
    return '制限時間を過ぎました';
  }
  if (msg.includes('already_submitted')) {
    return 'この対戦はすでに提出済みです';
  }
  if (msg.includes('already_opened')) {
    return '今週のこの英語はすでに開いています';
  }
  if (msg.includes('already_answered')) {
    return 'このクイズはすでに回答済みです';
  }
  if (msg.includes('content_not_available')) {
    return 'この英語は現在利用できません';
  }
  if (msg.includes('length must be 1..300 characters')) {
    return '一言は1〜300文字で入力してください';
  }
  if (msg.includes('identical characters repeated 6 or more times')) {
    return '同じ文字が連続しすぎています';
  }
  if (msg.includes('at least 80 percent english characters')) {
    return '英語を中心に書いてください';
  }
  if (msg.includes('duplicate of past writing')) {
    return '以前書いた一言と同じ内容は投稿できません';
  }
  if (msg.includes('must contain at least 3 english words')) {
    return '英語を3語以上使ってください';
  }
  if (msg.includes('must include at least one of the specified prompt words')) {
    return '指定された単語を1つ以上使ってください';
  }
  if (msg.includes('must contain exactly 3 english words')) {
    return '英語ちょうど3語で書いてください';
  }
  if (msg.includes('must contain at least 5 english words')) {
    return '英語を5語以上使ってください';
  }
  if (msg.includes('not_a_picker')) {
    return '今週の英語を提案する権限がありません';
  }
  if (msg.includes('not_a_staff')) {
    return 'スタッフ専用の操作です';
  }
  if (msg.includes('invalid_url')) {
    return 'URLは https:// から始まるものを入力してください';
  }
  if (msg.includes('content_not_found_or_already_approved')) {
    return '対象のコンテンツが見つからないか、すでに承認済みです';
  }
  if (msg.includes('writing_not_found')) {
    return '対象の一言が見つかりません';
  }
  if (msg.includes('invalid_stamp')) {
    return '無効なスタンプです';
  }
  if (msg.includes('invite_not_set')) {
    return '合言葉がまだ設定されていません。スタッフに確認してね';
  }
  if (msg.includes('invite_invalid')) {
    return '合言葉が違います（館内の掲示を見てね）';
  }
  if (msg.includes('pack_limit')) {
    return '今日のカードパックは上限（3回）に達しました。明日また引いてね';
  }
  if (msg.includes('already_drawn')) {
    return 'この対戦のカードパックはすでに開封済みです';
  }
  if (msg.includes('match_not_finished')) {
    return '対戦がまだ完了していません';
  }

  return 'エラーが発生しました。もう一度試してみてね';
}


/**
 * HTML に埋め込む文字をエスケープする。
 * 画面は innerHTML で組み立てているので、中高生が入力した文字（ニックネーム・英語の一言・
 * 今週の英語の題名など）をそのまま入れると、スタッフが読んだときにスクリプトが動いてしまう。
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * DB から受け取った値の中の文字列を、入れ子まで全部エスケープした写しを返す（元は変えない）。
 * api.js が返す手前で1回だけ通す。画面側でエスケープを忘れても安全側に倒れるようにするため。
 */
export function escapeDeep(v) {
  if (typeof v === 'string') return escapeHtml(v);
  if (Array.isArray(v)) return v.map(escapeDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = escapeDeep(x);
    return out;
  }
  return v;
}

/**
 * 合言葉の入力を正規化する
 * - 前後の半角/全角空白をトリム
 * - 小文字化
 */
export function normalizeInviteCode(code) {
  if (!code || typeof code !== 'string') return '';
  return code.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '').toLowerCase();
}

/**
 * 段階と次の進化までの進捗率を計算する
 * 境目: 1:0, 2:30, 3:80, 4:160, 5:300, 6:500, 7:800
 */
export function calcStageProgress(totalPoints) {
  const pts = Math.max(0, parseInt(totalPoints, 10) || 0);

  if (pts >= 800) {
    return {
      stage: 7,
      base: 800,
      nextThreshold: null,
      pointsToNext: 0,
      percent: 100
    };
  }

  const thresholds = [
    { stage: 1, base: 0, next: 30 },
    { stage: 2, base: 30, next: 80 },
    { stage: 3, base: 80, next: 160 },
    { stage: 4, base: 160, next: 300 },
    { stage: 5, base: 300, next: 500 },
    { stage: 6, base: 500, next: 800 }
  ];

  for (const t of thresholds) {
    if (pts < t.next) {
      const range = t.next - t.base;
      const progress = pts - t.base;
      const percent = Math.min(100, Math.max(0, Math.round((progress / range) * 100)));
      return {
        stage: t.stage,
        base: t.base,
        nextThreshold: t.next,
        pointsToNext: t.next - pts,
        percent
      };
    }
  }

  return {
    stage: 1,
    base: 0,
    nextThreshold: 30,
    pointsToNext: 30,
    percent: 0
  };
}

/**
 * レア度の表示情報
 * 1: N (ノーマル)
 * 2: R (レア)
 * 3: SR (スーパーレア)
 * 4: UR (ウルトラレア)
 */
export function rarityInfo(rarity) {
  const r = parseInt(rarity, 10);
  switch (r) {
    case 1:
      return {
        code: 'N',
        label: 'ノーマル',
        color: '#94a3b8',
        badgeBg: 'rgba(148, 163, 184, 0.2)',
        borderColor: '#94a3b8',
        isRainbow: false
      };
    case 2:
      return {
        code: 'R',
        label: 'レア',
        color: '#3b82f6',
        badgeBg: 'rgba(59, 130, 246, 0.2)',
        borderColor: '#3b82f6',
        isRainbow: false
      };
    case 3:
      return {
        code: 'SR',
        label: 'スーパーレア',
        color: '#F2C200',
        badgeBg: 'rgba(242, 194, 0, 0.2)',
        borderColor: '#F2C200',
        isRainbow: false
      };
    case 4:
      return {
        code: 'UR',
        label: 'ウルトラレア',
        color: '#ec4899',
        badgeBg: 'rgba(236, 72, 153, 0.2)',
        borderColor: '#ec4899',
        isRainbow: true
      };
    default:
      return {
        code: 'N',
        label: 'ノーマル',
        color: '#94a3b8',
        badgeBg: 'rgba(148, 163, 184, 0.2)',
        borderColor: '#94a3b8',
        isRainbow: false
      };
  }
}

/**
 * コンボのマイルストーン判定（3・5・7・10）
 */
export function checkComboMilestone(combo) {
  const c = parseInt(combo, 10) || 0;
  if ([3, 5, 7, 10].includes(c)) {
    return {
      isMilestone: true,
      count: c,
      label: `${c} COMBO!`
    };
  }
  return {
    isMilestone: false,
    count: c,
    label: null
  };
}

/**
 * 段階番号とルートから段階名を取得
 */
export function getStageName(stage, route) {
  const s = parseInt(stage, 10) || 1;
  const isGrass = route === 'grass';
  switch (s) {
    case 1:
      return 'ちびミアキス';
    case 2:
      return 'ミアキス';
    case 3:
      return isGrass ? '草原をめざすミアキス' : (route === 'tree' ? '木の上のミアキス' : 'ミアキス');
    case 4:
      return isGrass ? 'ハイイロギツネ級' : 'ヤマネコ級';
    case 5:
      return isGrass ? 'オオカミ級' : 'ヒョウ級';
    case 6:
      return isGrass ? 'ダイアウルフ級' : 'トラ級';
    case 7:
      return isGrass ? '草原の王' : '森の王';
    default:
      return 'ちびミアキス';
  }
}

