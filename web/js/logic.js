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
/**
 * ニックネームの表記ゆれをそろえる（前後の空白、NFC、波線）。
 * 波線は端末で打ち出される文字が違う（Windows は「～」U+FF5E、iPhone・Mac は「〜」U+301C、半角「~」など）ので、
 * 全部「～」U+FF5E にそろえる。既存の登録名はすべて U+FF5E（2026-10-02 確認）
 */
export function normalizeNickname(nickname) {
  return String(nickname ?? '')
    .normalize('NFC')
    .trim()
    .replace(/[~〜∼⁓～]/g, '～');
}

export function nicknameToEmail(nickname) {
  if (typeof nickname !== 'string') {
    throw new TypeError('ニックネームは文字列である必要があります');
  }
  const normalized = normalizeNickname(nickname);
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
  if (!error) return 'うまくいかなかった。もう一度';
  const msg = typeof error === 'string' ? error : error.message || '';

  if (msg.includes('nickname_taken')) {
    return 'その名前はもう使われている。自分の名前なら「ログイン」タブから';
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
    return 'ニックネームまたはパスワードが違います';
  }
  if (msg.includes('User already registered')) {
    return 'その名前はもう登録済み。上の「ログイン」タブから入って';
  }
  if (msg.includes('Password should be at least 6 characters')) {
    return 'パスワードは6文字以上で入力してください';
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
  if (msg.includes('run_not_active') || msg.includes('run_not_found')) {
    return 'このチャレンジはもう終わっています';
  }
  if (msg.includes('revive_not_available')) {
    return '復活はもう使えません';
  }
  if (msg.includes('month_not_closed')) {
    return 'その月はまだ終わっていない。月が替わってから';
  }
  if (msg.includes('invalid_month')) {
    return '月の指定が違う（1日の日付で）';
  }
  if (msg.includes('setting_not_allowed')) {
    return 'その設定は画面から変えられない';
  }
  if (msg.includes('setting_out_of_range')) {
    return '範囲の外。最小〜最大の中で';
  }
  if (msg.includes('invalid_setting_value')) {
    return '数字（または オン/オフ）で';
  }
  if (msg.includes('invalid_mode')) {
    return 'モードを選び直してください';
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
  if (msg.includes('not_enough_nuts')) {
    return 'Miコインが足りない';
  }
  if (msg.includes('not_enough_shards')) {
    return 'かけらが足りません';
  }
  if (msg.includes('invalid_pull_count')) {
    return 'ガチャは 1回 か 11連';
  }
  if (msg.includes('already_claimed')) {
    return 'すでに獲得済みです';
  }
  if (msg.includes('item_not_owned')) {
    return 'そのアイテムを持っていません';
  }
  if (msg.includes('slot_mismatch')) {
    return 'そのスロットには装備できません';
  }
  if (msg.includes('invalid_slot')) {
    return '無効なスロットです';
  }
  if (msg.includes('already_redeemed')) {
    return 'この引換券はすでに引き換え済みです';
  }
  if (msg.includes('ticket_not_found')) {
    return '引換券が見つかりません';
  }

  return 'うまくいかなかった。もう一度';
}


/**
 * HTML に埋め込む文字をエスケープする。
 * 画面は innerHTML で組み立てているので、中高生が入力した文字（ニックネーム・英語の一言・
 * 今週の英語の題名など）をそのまま入れると、スタッフが読んだときにスクリプトが動いてしまう。
 */
export function escapeHtml(s) {
  // すでにエスケープ済みの実体参照（&amp; &lt; &gt; &quot; &#39;）の & は二度変えない。
  // API の層（escapeDeep）と画面の両方で掛けても、名前が「&lt;b&gt;」のように化けないようにするため。
  // 生の < > " ' は必ず実体参照になるので、無害化の強さは変わらない。
  return String(s)
    .replace(/&(?!(?:amp|lt|gt|quot|#39);)/g, '&amp;')
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
    case 5:
      return {
        code: 'SECRET',
        label: 'シークレット',
        color: '#c2413a',
        badgeBg: 'rgba(194, 65, 58, 0.15)',
        borderColor: '#c2413a',
        isRainbow: true
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

/**
 * 木の実の残高からガチャ実行可能状態を判定・整形する
 *
 * @param {number} balance
 * @returns {{ balance: number, canPull1: boolean, canPull10: boolean, label: string }}
 */
export const GACHA_PRICE = { single: 5, multi: 50, multiCount: 11 };

/**
 * ガチャの値段。gacha_rates() が返す値を優先し、無ければ既定
 */
export function gachaPrice(rates) {
  const r = rates || {};
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    single: n(r.pull_cost, GACHA_PRICE.single),
    multi: n(r.pull10_cost, GACHA_PRICE.multi),
    multiCount: n(r.pull10_count, GACHA_PRICE.multiCount)
  };
}

export function calcNutsDisplay(balance, price = GACHA_PRICE) {
  const b = Math.max(0, parseInt(balance, 10) || 0);
  return {
    balance: b,
    canPull1: b >= price.single,
    canPull10: b >= price.multi,
    label: `${b} Mi`
  };
}

/**
 * 木の実の今日の残り獲得上限を計算する
 *
 * @param {number} dailyCap
 * @param {number} todayEarned
 * @returns {number}
 */
export function calcRemainingCap(dailyCap, todayEarned) {
  const cap = Math.max(0, parseInt(dailyCap, 10) || 200);
  const earned = Math.max(0, parseInt(todayEarned, 10) || 0);
  return Math.max(0, cap - earned);
}

/**
 * ガチャ確率情報を画面表示用に整形する
 *
 * @param {{ prize_rate?: number, prizes?: Array<{name: string, stock: number}>, item_rates?: Record<string, number> }} rates
 * @returns {{ prizeRatePercent: string, prizes: Array<{name: string, stock: number}>, itemRates: Array<{code: string, percent: string}> }}
 */
export function formatGachaRates(rates) {
  const r = rates || {};
  const parsedRate = Number(r.prize_rate);
  const pRate = r.prize_rate == null || !Number.isFinite(parsedRate) ? 0.01 : Math.max(0, Math.min(1, parsedRate));
  const prizeRatePercent = `${(pRate * 100).toFixed(1).replace(/\.0$/, '')}%`;

  const prizes = Array.isArray(r.prizes) ? r.prizes.map(p => ({
    name: String(p.name || ''),
    stock: parseInt(p.stock, 10) || 0
  })) : [];

  const defaultRates = { N: 0.70, R: 0.22, SR: 0.07, UR: 0.01 };
  const rawItemRates = r.item_rates || defaultRates;
  const pct = v => `${(v * 100).toFixed(2).replace(/.?0+$/, '')}%`;
  const itemRates = [
    ...(rawItemRates.SECRET ? [{ code: 'SECRET', percent: pct(rawItemRates.SECRET) }] : []),
    { code: 'UR', percent: `${((rawItemRates.UR ?? 0.01) * 100).toFixed(1).replace(/\.0$/, '')}%` },
    { code: 'SR', percent: `${((rawItemRates.SR ?? 0.07) * 100).toFixed(1).replace(/\.0$/, '')}%` },
    { code: 'R', percent: `${((rawItemRates.R ?? 0.22) * 100).toFixed(1).replace(/\.0$/, '')}%` },
    { code: 'N', percent: `${((rawItemRates.N ?? 0.70) * 100).toFixed(1).replace(/\.0$/, '')}%` }
  ];

  return {
    prizeRatePercent,
    prizes,
    itemRates
  };
}

/**
 * 10連ガチャでSR以上が最低1つ保証されているか判定する
 *
 * @param {number} pullCount
 * @param {Array<{rarity?: number, kind?: string}>} results
 * @returns {boolean}
 */
export function checkGuaranteedSr(pullCount, results) {
  if (pullCount !== 10) return true;
  if (!Array.isArray(results) || results.length !== 10) return false;
  return results.some(item => (parseInt(item.rarity, 10) >= 3) || item.kind === 'prize');
}

/**
 * かけら交換に必要なコストをレア度から計算する
 * N 10 / R 30 / SR 100 / UR 300
 *
 * @param {number} rarity
 * @returns {number}
 */
/** 抽選券の番号の見せ方。No.0042 */
export function raffleNo(n) {
  const v = parseInt(n, 10);
  return Number.isFinite(v) && v > 0 ? `No.${String(v).padStart(4, '0')}` : '';
}

/** '2026-09' → '9月' */
export function monthLabel(ym) {
  const m = /^\d{4}-(\d{2})$/.exec(String(ym || ''));
  return m ? `${parseInt(m[1], 10)}月` : String(ym || '');
}

/** かけらで交換できるのはガチャの品のスーパーレア（SR）まで。UR・SECRET・すがた・条件達成の称号は交換できない（2026-10-03 本人） */
export const EXCHANGE_MAX_RARITY = 3;
export function canExchange(item) {
  return !!item && item.source !== 'achievement' && (item.source || 'gacha') === 'gacha'
    && item.slot !== 'form' && parseInt(item.rarity, 10) <= EXCHANGE_MAX_RARITY;
}

/** すがた（特殊スキン）を着ている間は付けられないスロット */
export const FORM_BLOCKS = ['hat', 'face', 'neck'];

export function itemExchangeCost(rarity) {
  const r = parseInt(rarity, 10);
  switch (r) {
    case 1: return 10;
    case 2: return 30;
    case 3: return 100;
    case 4: return 300;
    default: return 10;
  }
}



// ==========================================
// 連続チャレンジ・100本ノック
// ==========================================

/**
 * 連続チャレンジのいまのステージ。5問正解ごとに1つ上がる
 * @param {number} streak - いまの連続正解数
 */
export function streakStage(streak) {
  const n = Math.max(0, parseInt(streak, 10) || 0);
  return { stage: Math.floor(n / 5) + 1, inStage: n % 5, toNext: 5 - (n % 5) };
}

/**
 * 自己ベストとの距離をひとことで（プレッシャー用）。言うことが無ければ空文字
 * @param {number} score - いまの連続正解数
 * @param {number|null} best - これまでの自己ベスト
 */
export function streakPressureLabel(score, best) {
  const s = parseInt(score, 10) || 0;
  const b = parseInt(best, 10) || 0;
  if (b <= 0) return '';
  if (s > b) return '自己ベスト更新中！';
  const remaining = b + 1 - s;
  if (remaining === 1) return 'あと1問で 自己ベスト';
  if (remaining <= 3) return `自己ベストまで あと${remaining}問`;
  return '';
}

/**
 * ミリ秒を「12.3秒」に
 */
export function formatSeconds(ms) {
  const n = Math.max(0, parseInt(ms, 10) || 0);
  return `${(n / 1000).toFixed(1)}秒`;
}

/**
 * 100本ノックの評価
 * @param {number} correct - 100問中の正解数
 */
export function knockGrade(correct) {
  const c = parseInt(correct, 10) || 0;
  if (c >= 100) return { mark: 'PERFECT', label: '全問正解！' };
  if (c >= 90) return { mark: 'S', label: 'キレてる' };
  if (c >= 75) return { mark: 'A', label: 'いい調子' };
  if (c >= 50) return { mark: 'B', label: '半分こえた' };
  return { mark: 'C', label: 'のびしろ' };
}

/**
 * プレイ中の「いまの順位」。いまやめたら何位か、を他の人の今週ベストと比べて出す
 * @param {number} score - いまの記録（連続正解数／100本ノックの正解数）
 * @param {Array<{nickname:string, score:number}>} others - 自分以外の今週ベスト
 * @returns {{rank:number, next:{nickname:string, score:number, gap:number}|null, above:number}}
 *   next = すぐ上の人（抜くまであと gap 問）。同点は相手が上（時間で負けている前提）
 */
export function liveRank(score, others) {
  const s = Math.max(0, parseInt(score, 10) || 0);
  const list = (others || [])
    .map(o => ({ nickname: String(o.nickname || ''), score: Math.max(0, parseInt(o.score, 10) || 0) }))
    .filter(o => o.nickname);
  const above = list.filter(o => o.score >= s);
  above.sort((a, b) => a.score - b.score);
  const next = above[0] ? { ...above[0], gap: above[0].score + 1 - s } : null;
  return { rank: above.length + 1, next, above: above.length };
}

/**
 * 順位が上がったときに抜いた人たち（前の記録では上にいて、今の記録では下になった人）
 */
export function passedPlayers(prevScore, score, others) {
  const p = Math.max(0, parseInt(prevScore, 10) || 0);
  const n = Math.max(0, parseInt(score, 10) || 0);
  if (n <= p) return [];
  return (others || [])
    .filter(o => { const sc = parseInt(o.score, 10) || 0; return sc >= p && sc < n; })
    .sort((a, b) => (parseInt(b.score, 10) || 0) - (parseInt(a.score, 10) || 0))
    .map(o => String(o.nickname || ''));
}

/**
 * ランキングに出すときの名前。スタッフには「（スタッフ）」を付ける（2026-10-02 本人）
 */
export const KNOCK_LEVELS = [
  { band: 1, label: 'A1', sub: '中学前半' },
  { band: 2, label: 'A2', sub: '中学' },
  { band: 3, label: 'B1', sub: '高校' },
  { band: 4, label: 'B2', sub: '大学受験' },
  { band: 5, label: '最難関', sub: '学術語' }
];

/** 100本ノックで選んだレベル（端末に保存）。無ければ 1 */
export function savedKnockBand() {
  try {
    const v = parseInt(localStorage.getItem('miacis_knock_band'), 10);
    return v >= 1 && v <= 5 ? v : 1;
  } catch {
    return 1;
  }
}

export function saveKnockBand(band) {
  try { localStorage.setItem('miacis_knock_band', String(band)); } catch {}
}

export function withStaffTag(nickname, isStaff) {
  const n = String(nickname ?? '');
  return isStaff ? `${n}（スタッフ）` : n;
}

// ==========================================
// ローグライク（カード・スタート地点・系統樹）
// ==========================================

export const CARDS = {
  shield: { icon: '🛡', name: 'たて', desc: '次の1回の不正解を無効にする' },
  fifty: { icon: '✂', name: '50:50', desc: '好きな問題で1回、ハズレを2つ消す' },
  time: { icon: '⏱', name: 'じかん+2', desc: 'この回の残りは1問 +2秒' },
  skip: { icon: '↷', name: 'スキップ', desc: '好きな問題で1回、数えずに次へ' },
  double: { icon: 'Mi', name: 'Mi×2', desc: 'この回のMiコインが2倍' }
};

export const START_STAGES = [
  { stage: 1, label: 'A1', sub: '中学前半' },
  { stage: 3, label: 'A2', sub: '中学' },
  { stage: 5, label: 'B1', sub: '高校' },
  { stage: 8, label: 'B2', sub: '大学受験' },
  { stage: 10, label: '最難関', sub: '学術語' }
];

/** スタート地点が開いているか（その段階にたどり着いたことがある = 到達 >= (stage-1)*5） */
export function startStageUnlocked(stage, maxDepth) {
  return stage <= 1 || (parseInt(maxDepth, 10) || 0) >= (stage - 1) * 5;
}

/** 系統樹のレベルごとの解放（表示用） */
export const META_LEVELS = [
  { level: 1, at: 0, unlock: 'たて・50:50・じかん+2' },
  { level: 2, at: 50, unlock: 'スキップのカード' },
  { level: 3, at: 150, unlock: 'Mi×2 のカード' },
  { level: 4, at: 300, unlock: '最初の1問の前にカード' },
  { level: 5, at: 600, unlock: 'カードの候補が4枚に' }
];

export function nextMetaUnlock(level) {
  return META_LEVELS.find(m => m.level === (parseInt(level, 10) || 1) + 1) || null;
}

// ==========================================
// 連続チャレンジのステージ（0018）と選択肢の細かさ（0019）
// ==========================================

/** 連続チャレンジで選んだステージ（端末に保存）。無ければ 1 */
export function savedStreakBand() {
  try {
    const v = parseInt(localStorage.getItem('miacis_streak_band'), 10);
    return v >= 1 && v <= 5 ? v : 1;
  } catch {
    return 1;
  }
}

export function saveStreakBand(band) {
  try { localStorage.setItem('miacis_streak_band', String(band)); } catch {}
}

/** 選択肢の細かさ（tier）の言い方。0 は何も言わない */
export function tierLabel(tier) {
  return ['', '同じ品詞', '似た単語に注意', 'つづりの罠'][parseInt(tier, 10) || 0] || '';
}

// ==========================================
// 学習のやる気（0023）: 今日やること・図鑑の途中ごほうび・リベンジ・ガチャまでの距離
// ==========================================

/**
 * 今日やること の要約。次にやる1つ（未達成の最初）と、全部済んだか
 * @param {{quests?: Array<{key:string,label:string,unit:string,goal:number,progress:number,claimed?:boolean}>}} state
 */
export function questSummary(state) {
  const quests = Array.isArray(state?.quests) ? state.quests.map(q => {
    const goal = Math.max(1, parseInt(q.goal, 10) || 1);
    const progress = Math.max(0, Math.min(goal, parseInt(q.progress, 10) || 0));
    return { ...q, goal, progress, done: progress >= goal, left: goal - progress };
  }) : [];
  const done = quests.filter(q => q.done).length;
  return { quests, done, total: quests.length, allDone: quests.length > 0 && done === quests.length, next: quests.find(q => !q.done) || null };
}

/** 今日やること 1行の文言。「正解 12/20問」「サバイバル 1回」 */
export function questLine(q) {
  if (!q) return '';
  const goal = Math.max(1, parseInt(q.goal, 10) || 1);
  if (goal === 1) return `${q.label} 1${q.unit}`;
  return `${q.label} ${Math.min(goal, parseInt(q.progress, 10) || 0)}/${goal}${q.unit}`;
}

/**
 * 1回の挑戦で図鑑がどれだけ増えたか。before / after は my_zukan_progress / claim_zukan_milestones の bands
 * @returns {{gained:number, collected:number, total:number, toNext:number|null, nextKind:string|null, coin:number}|null}
 */
export function zukanGain(before, after, band) {
  const find = list => (Array.isArray(list) ? list.find(b => Number(b.band) === Number(band)) : null);
  const a = find(after);
  if (!a) return null;
  const b = find(before);
  const collected = parseInt(a.collected, 10) || 0;
  const nextAt = a.next_at == null ? null : parseInt(a.next_at, 10);
  return {
    gained: b ? Math.max(0, collected - (parseInt(b.collected, 10) || 0)) : 0,
    collected,
    total: parseInt(a.total, 10) || 0,
    toNext: nextAt == null ? null : Math.max(0, nextAt - collected),
    nextKind: a.next_kind || null,
    coin: parseInt(a.coin, 10) || 0
  };
}

/** 図鑑の「次のごほうびまで」の1行。コンプリートが次なら すがた の名前を言う */
export function zukanNextLine(g, completeName = 'すがた') {
  if (!g || g.total === 0) return '';
  if (g.collected >= g.total) return 'コンプリート済み';
  if (g.toNext == null) return '';
  return g.nextKind === 'complete' ? `あと${g.toNext}語で ${completeName}` : `あと${g.toNext}語で Mi +${g.coin}`;
}

/** ガチャ1回まであと何個か（0 なら引ける） */
export function coinsToGacha(balance, price = GACHA_PRICE) {
  const b = Math.max(0, parseInt(balance, 10) || 0);
  return Math.max(0, (price?.single || GACHA_PRICE.single) - b);
}

/**
 * 抽選券の出る確率の言い方。スタッフは抽選券が出ない（サーバーが 0 を返す）ので「0%」と出さない
 * @returns {string} 「ガチャ1回で 10%」／ スタッフ「スタッフには出ない」
 */
export function raffleRateLabel(rates) {
  if (rates?.staff_mode) return 'スタッフには出ない';
  const r = Math.max(0, Math.min(1, Number(rates?.raffle_rate) || 0));
  if (r <= 0) return 'いまは出ない';
  return `ガチャ1回で ${Math.round(r * 100)}%`;
}

// ==========================================
// 🔥 を週単位に・休館日は数えない（0024）
// ==========================================

export const DOW_JA = ['月', '火', '水', '木', '金', '土', '日'];

/**
 * my_streak の返り値を画面の形に。今週の7日は 来た／休館／まだ（今日まで）／これから
 * @returns {{days:number, weekDays:number, weekOpen:number, rested:boolean, chips:Array<{label:string, state:'played'|'closed'|'open'|'future', today:boolean}>}|null}
 */
export function weekVisits(s) {
  if (!s || !Array.isArray(s.week)) return null;
  return {
    days: Math.max(0, parseInt(s.days, 10) || 0),
    weekDays: Math.max(0, parseInt(s.week_days, 10) || 0),
    weekOpen: Math.max(0, parseInt(s.week_open, 10) || 0),
    rested: Boolean(s.rested_last_week),
    chips: s.week.map(d => ({
      label: DOW_JA[((parseInt(d.dow, 10) || 1) - 1) % 7],
      state: d.played ? 'played' : d.closed ? 'closed' : d.future ? 'future' : 'open',
      today: Boolean(d.today)
    }))
  };
}

/** 先週休んだが 🔥 がつながっているときの1行（切れたとは言わない）。それ以外は空 */
export function restLine(v) {
  return v?.rested ? '先週は休み。🔥 は つながってる' : '';
}

/**
 * ログインボーナスの 🔥 の行。上乗せがあれば「🔥 9日 Mi +3」、まだなら「あと2日で ボーナス↑」
 * streak_bonus_next が無い古い返り値は、前の決まり（3日で上乗せ）で数える
 * @returns {{days:number, bonus:number, next:number}}
 */
export function loginStreak(res) {
  const days = Math.max(0, parseInt(res?.streak_days, 10) || 0);
  const bonus = Math.max(0, parseInt(res?.streak_bonus, 10) || 0);
  const next = res?.streak_bonus_next == null ? (days >= 1 && days < 3 ? 3 - days : 0) : Math.max(0, parseInt(res.streak_bonus_next, 10) || 0);
  return { days, bonus, next };
}

/** 'YYYY-MM-DD' → '12/28(月)'（日付だけを扱う。端末の時差に左右されない） */
export function calDayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); // 0=日
  return `${+m[2]}/${+m[3]}(${DOW_JA[(dow + 6) % 7]})`;
}

/** 曜日の設定 '1,2' ⇔ [1,2]。並べ直して重複と範囲外を落とす */
export function parseWeekdays(text) {
  return [...new Set(String(text || '').split(',').map(x => parseInt(x, 10)).filter(n => n >= 1 && n <= 7))].sort((a, b) => a - b);
}

// ==========================================
// コミットポイントの「今日 ◯ / 10」（ホーム）
// ==========================================

/** コミットポイントの1日の上限。サーバーの add_commit（0002）と同じ数。2026-10-03 本人「とりあえず10のまま」 */
export const COMMIT_DAILY_CAP = 10;

/** 日本時間の今日（YYYY-MM-DD）。points.day と比べる */
export function jstToday(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * ホームのコミット欄の「今日 ◯ / 10」。上限で止まっていること、日付が変わってまた入ることが分かるように出す
 * @returns {string} 「今日 7 / 10」／ 上限なら「今日 10 / 10 上限」
 */
export function commitTodayLine(today, cap = COMMIT_DAILY_CAP) {
  const n = Math.min(Math.max(0, Math.floor(Number(today) || 0)), cap);
  return n >= cap ? `今日 ${n} / ${cap} 上限` : `今日 ${n} / ${cap}`;
}

// ==========================================
// ともだちに教える（ホーム）
// ==========================================

/**
 * 送る中身。URL は入口だけ（#/home や ?debug を付けたまま送らない）。2026-10-03 本人「ともだちにおしえるボタン、URLを送れるように」
 * @returns {{title: string, text: string, url: string}}
 */
export function shareInfo(href) {
  const u = new URL(href);
  return {
    title: 'ミアキス英単語サバイバル',
    text: 'ミアキス英単語サバイバル。君は何問いける？',
    url: `${u.origin}${u.pathname}`
  };
}
