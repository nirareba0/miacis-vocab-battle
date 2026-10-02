/**
 * api.js - Supabase クライアント初期化と RPC / データ取得の薄いラッパー
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';
import { nicknameToEmail, normalizeNickname, translateError, escapeDeep } from './logic.js';

export { isConfigured, translateError };

export const supabase = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;


function checkClient() {
  if (!supabase) {
    throw new Error('アプリは現在準備中です。設定をお待ちください');
  }
}

/**
 * 合言葉が要るか（app_settings に合言葉が設定されているか）。未設定なら誰でも登録できる
 */
export async function inviteRequired() {
  checkClient();
  const { data, error } = await supabase.rpc('invite_required');
  if (error) throw new Error(translateError(error));
  return Boolean(data);
}

/**
 * 合言葉の事前確認 (check_invite)。合言葉が未設定なら true
 */
export async function checkInvite(code) {
  checkClient();
  const trimmed = (code || '').trim();
  const { data, error } = await supabase.rpc('check_invite', { p_code: trimmed });
  if (error) throw new Error(translateError(error));
  return Boolean(data);
}

/**
 * 新規プレイヤー登録
 */
export async function signUpPlayer(nickname, passphrase, grade, inviteCode) {
  checkClient();
  const trimmedNick = normalizeNickname(nickname);
  if (trimmedNick.length < 1 || trimmedNick.length > 10) {
    throw new Error('ニックネームは1〜10文字で入力してください');
  }
  if (!passphrase || passphrase.length < 6) {
    throw new Error('あいことばは6文字以上で入力してください');
  }
  if (!grade || grade < 1 || grade > 6) {
    throw new Error('学年を選択してください');
  }
  // 合言葉の事前検査（合言葉が設定されているときだけ効く。一致しなければ Auth ユーザーを作成しない）
  const inviteOk = await checkInvite(inviteCode);
  if (!inviteOk) {
    throw new Error('ミアキスの合言葉が違います（館内の掲示を見てね）');
  }

  const email = nicknameToEmail(trimmedNick);
  let authUser = null;

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password: passphrase
  });

  if (authError) {
    // 既に同じメールアドレス（ニックネーム）で Auth に存在する場合はログインを試行
    if (authError.message?.includes('already registered')) {
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password: passphrase
      });
      if (loginError) {
        throw new Error(translateError(authError));
      }
      authUser = loginData.user;
    } else {
      throw new Error(translateError(authError));
    }
  } else {
    authUser = authData.user;
  }

  // Auth 登録/ログイン後、players テーブルへ登録 (RPC)
  const { data: playerData, error: rpcError } = await supabase.rpc('register_player', {
    p_nickname: trimmedNick,
    p_grade: grade,
    p_invite_code: (inviteCode || '').trim() || null
  });
  if (rpcError) {
    throw new Error(translateError(rpcError));
  }

  return { user: authUser, player: escapeDeep(playerData) };
}

/**
 * ログイン
 */
export async function signInPlayer(nickname, passphrase) {
  checkClient();
  const trimmedNick = normalizeNickname(nickname);
  if (!trimmedNick) {
    throw new Error('ニックネームを入力してください');
  }
  if (!passphrase) {
    throw new Error('あいことばを入力してください');
  }
  const email = nicknameToEmail(trimmedNick);
  let { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: passphrase
  });
  // コピペで前後に空白・タブ・改行が付いたあいことばを救う（そのままで失敗したときだけ試す）
  const trimmedPass = passphrase.trim();
  if (error && trimmedPass !== passphrase && trimmedPass.length > 0) {
    ({ data, error } = await supabase.auth.signInWithPassword({ email, password: trimmedPass }));
  }
  if (error) {
    throw new Error(translateError(error));
  }
  return escapeDeep(data);
}

/**
 * ログアウト
 */
export async function signOutPlayer() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * 現在のログインセッションを取得
 */
export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data) return null;
  return data.session;
}

/**
 * 現在のプレイヤー情報を取得
 */
export async function getMyPlayer() {
  checkClient();
  const session = await getSession();
  if (!session?.user?.id) return null;
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * スタッフかどうか判定
 */
export async function isStaffUser() {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('staff')
    .select('user_id')
    .maybeSingle();
  if (error || !data) return false;
  return true;
}

/**
 * touch_today を呼ぶ（本日のコミットポイント付与）
 */
export async function touchToday() {
  checkClient();
  const { data, error } = await supabase.rpc('touch_today');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * my_summary を呼ぶ（ポイント・順位・先週サマリー）
 */
export async function getMySummary() {
  checkClient();
  const { data, error } = await supabase.rpc('my_summary');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 対戦開始 (start_match)
 */
export async function startMatch() {
  checkClient();
  const { data, error } = await supabase.rpc('start_match');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 対戦回答提出 (submit_match)
 */
export async function submitMatch(matchId, answers) {
  checkClient();
  const { data, error } = await supabase.rpc('submit_match', {
    p_match_id: matchId,
    p_answers: answers
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 学習ランキング（自分の段のみ）
 */
export async function getRankingLearn(tier) {
  checkClient();
  const { data, error } = await supabase
    .from('ranking_learn_week')
    .select('*')
    .eq('tier', tier)
    .order('rank', { ascending: true })
    .order('nickname', { ascending: true });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * コミットランキング（全体）
 */
export async function getRankingCommit() {
  checkClient();
  const { data, error } = await supabase
    .from('ranking_commit_week')
    .select('*')
    .order('rank', { ascending: true })
    .order('nickname', { ascending: true });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * 今週の承認済み英語コンテンツ一覧
 */
export async function getApprovedContents() {
  checkClient();
  const { data, error } = await supabase
    .from('contents')
    .select('*')
    .not('approved_at', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * 今週の英語を開く (open_content)
 */
export async function openContent(contentId) {
  checkClient();
  const { data, error } = await supabase.rpc('open_content', {
    p_content_id: contentId
  });
  if (error) {
    if (error.message && error.message.includes('already_opened')) {
      return 0; // すでに開いていればエラーにせず 0
    }
    throw new Error(translateError(error));
  }
  return escapeDeep(data);
}

/**
 * 今週の英語クイズ回答 (answer_content_quiz)
 */
export async function answerContentQuiz(contentId, answers) {
  checkClient();
  const { data, error } = await supabase.rpc('answer_content_quiz', {
    p_content_id: contentId,
    p_answers: answers
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 英語の一言送信 (submit_writing)
 */
export async function submitWriting(contentId, text) {
  checkClient();
  const { data, error } = await supabase.rpc('submit_writing', {
    p_content_id: contentId,
    p_text: text
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 英語コンテンツ提案 (propose_content)
 */
export async function proposeContent(title, url, quiz, writingPrompt) {
  checkClient();
  const { data, error } = await supabase.rpc('propose_content', {
    p_title: title,
    p_url: url,
    p_quiz: quiz,
    p_writing_prompt: writingPrompt
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 自分が開いたコンテンツの ID 一覧
 */
export async function getMyContentOpens() {
  checkClient();
  const { data, error } = await supabase
    .from('content_opens')
    .select('content_id');
  if (error) throw new Error(translateError(error));
  return escapeDeep((data || []).map(r => r.content_id));
}

/**
 * 自分が回答したクイズ一覧
 */
export async function getMyQuizAnswers() {
  checkClient();
  const { data, error } = await supabase
    .from('content_quiz_answers')
    .select('*');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * 自分の過去の一言一覧
 */
export async function getMyWritings() {
  checkClient();
  const { data, error } = await supabase
    .from('writings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * 自分の過去の週次結果一覧
 */
export async function getMyWeeklyResults() {
  checkClient();
  const { data, error } = await supabase
    .from('weekly_results')
    .select('*')
    .order('week_start', { ascending: false });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * スタッフ用: 未承認コンテンツ一覧
 */
export async function getUnapprovedContents() {
  checkClient();
  const { data, error } = await supabase
    .from('contents')
    .select('*')
    .is('approved_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * スタッフ用: コンテンツ承認 (approve_content)
 */
export async function approveContent(contentId) {
  checkClient();
  const { data, error } = await supabase.rpc('approve_content', {
    p_content_id: contentId
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * スタッフ用: 生徒の一言一覧 (最新50件)
 */
export async function getRecentWritings() {
  checkClient();
  const { data, error } = await supabase
    .from('writings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * スタッフ用: 一言にスタンプを押す (stamp_writing)
 */
export async function stampWriting(writingId, stamp) {
  checkClient();
  const { data, error } = await supabase.rpc('stamp_writing', {
    p_writing_id: writingId,
    p_stamp: stamp
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 自分の進化・進捗情報 (my_progress)
 */
export async function getMyProgress() {
  checkClient();
  const { data, error } = await supabase.rpc('my_progress');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * カードパックの開封 (open_pack)
 */
export async function openPack(matchId) {
  checkClient();
  const { data, error } = await supabase.rpc('open_pack', {
    p_match_id: matchId
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 今日のカードパック残り回数 (pack_status)
 */
export async function getPackStatus() {
  checkClient();
  const { data, error } = await supabase.rpc('pack_status');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 自分の図鑑コレクション (my_collection)
 */
export async function getMyCollection() {
  checkClient();
  const { data, error } = await supabase.rpc('my_collection');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 単語ID配列から単語データを取得 (words)
 */
export async function getWordsByIds(ids) {
  checkClient();
  if (!ids || ids.length === 0) return [];
  const { data, error } = await supabase
    .from('words')
    .select('id, en, ja, pos, band')
    .in('id', ids);
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * 対戦の木の実獲得 (claim_match_nuts)
 */
export async function claimMatchNuts(matchId) {
  checkClient();
  const { data, error } = await supabase.rpc('claim_match_nuts', {
    p_match_id: matchId
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 毎日の木の実獲得 (claim_daily_nuts)
 */
export async function claimDailyNuts() {
  checkClient();
  const { data, error } = await supabase.rpc('claim_daily_nuts');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 木の実の残高と上限 (my_nuts)
 */
export async function getMyNuts() {
  checkClient();
  const { data, error } = await supabase.rpc('my_nuts');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * アイテムカタログ一覧 (items)
 */
export async function getItems() {
  checkClient();
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('active', true)
    .order('rarity', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * 自分が所持しているアイテム一覧 (player_items)
 */
export async function getMyItems() {
  checkClient();
  const { data, error } = await supabase
    .from('player_items')
    .select('*');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * 自分の現在の装備 (player_looks)
 */
export async function getMyLooks() {
  checkClient();
  const { data, error } = await supabase
    .from('player_looks')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * アイテムの装備/解除 (equip_item)
 */
export async function equipItem(slot, itemId) {
  checkClient();
  const { data, error } = await supabase.rpc('equip_item', {
    p_slot: slot,
    p_item_id: itemId
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 全プレイヤーの公開見た目一覧 (public_looks)
 */
export async function getPublicLooks() {
  checkClient();
  const { data, error } = await supabase
    .from('public_looks')
    .select('*');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * ガチャを引く (pull_gacha)
 */
export async function pullGacha(count) {
  checkClient();
  const { data, error } = await supabase.rpc('pull_gacha', {
    p_count: count
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * かけら残高を取得 (player_shards)
 */
export async function getMyShards() {
  checkClient();
  const { data, error } = await supabase
    .from('player_shards')
    .select('amount')
    .maybeSingle();
  if (error) throw new Error(translateError(error));
  return escapeDeep(data ? data.amount : 0);
}

/**
 * かけらでアイテム交換 (exchange_item)
 */
export async function exchangeItem(itemId) {
  checkClient();
  const { data, error } = await supabase.rpc('exchange_item', {
    p_item_id: itemId
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * ガチャの確率と景品在庫 (gacha_rates)
 */
export async function getGachaRates() {
  checkClient();
  const { data, error } = await supabase.rpc('gacha_rates');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 覚えた単語一覧 (my_words)
 */
export async function getMyWords() {
  checkClient();
  const { data, error } = await supabase.rpc('my_words');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * 自分の引換券一覧 (my_tickets)
 */
export async function getMyTickets() {
  checkClient();
  const { data, error } = await supabase.rpc('my_tickets');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * スタッフ用: 景品の作成・更新 (staff_upsert_prize)
 */
export async function staffUpsertPrize(id, name, description, stock, active) {
  checkClient();
  const { data, error } = await supabase.rpc('staff_upsert_prize', {
    p_id: id || null,
    p_name: name,
    p_description: description,
    p_stock: stock,
    p_active: active
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/**
 * スタッフ用: 引換券一覧 (staff_list_tickets)
 */
export async function staffListTickets(onlyOpen = false) {
  checkClient();
  const { data, error } = await supabase.rpc('staff_list_tickets', {
    p_only_open: onlyOpen
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/**
 * スタッフ用: 引換券の引き換え (staff_redeem_ticket)
 */
export async function staffRedeemTicket(ticketId) {
  checkClient();
  const { data, error } = await supabase.rpc('staff_redeem_ticket', {
    p_ticket_id: ticketId
  });
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}



export async function getStaffRewardOverview() {
  checkClient();
  const { data, error } = await supabase.rpc('staff_reward_overview');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}
export async function getWeeklyRewardRules() {
  checkClient();
  const { data, error } = await supabase.rpc('weekly_reward_rules');
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

// ==========================================
// 連続チャレンジ・100本ノック（1問ずつサーバーが出題・採点する）
// ==========================================

async function rpc(name, params) {
  checkClient();
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(translateError(error));
  return escapeDeep(data);
}

/** @param {'streak'|'knock'} mode */
export function startRun(mode) {
  return rpc('start_run', { p_mode: mode });
}

/** choice が null なら時間切れ */
export function answerRun(runId, choice, ms) {
  return rpc('answer_run', { p_run_id: runId, p_choice: choice, p_ms: ms });
}

export function reviveRun(runId) {
  return rpc('revive_run', { p_run_id: runId });
}

export function endRun(runId) {
  return rpc('end_run', { p_run_id: runId });
}

export function getMyRunBests() {
  return rpc('my_run_bests');
}

/** @param {'week'|'all'} scope */
export async function getRankingStreak(scope = 'week') {
  checkClient();
  const { data, error } = await supabase
    .from(scope === 'all' ? 'ranking_streak_all' : 'ranking_streak_week')
    .select('*')
    .order('rank', { ascending: true })
    .order('nickname', { ascending: true })
    .limit(50);
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

export async function getRankingKnock(band) {
  checkClient();
  const { data, error } = await supabase
    .from('ranking_knock_week')
    .select('*')
    .eq('band', band)
    .order('rank', { ascending: true })
    .order('nickname', { ascending: true })
    .limit(50);
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}

/** 画面の表示を切り替える旗（ランクモードの解禁など） */
export function getAppFlags() {
  return rpc('app_flags');
}

// ==========================================
// 抽選券・スタッフの設定・登録前の1問
// ==========================================

export function getMyRaffle() {
  return rpc('my_raffle');
}

/** @param {string} month - 'YYYY-MM-01' */
export function staffDrawRaffle(month) {
  return rpc('staff_draw_raffle', { p_month: month });
}

export function getStaffSettings() {
  return rpc('staff_settings');
}

export function staffSetSetting(key, value) {
  return rpc('staff_set_setting', { p_key: key, p_value: String(value) });
}

/** 登録前に1問だけ遊ぶための単語（頻度上位・匿名で読める）。選ぶのは端末側 */
export async function getTryoutWords() {
  checkClient();
  const { data, error } = await supabase
    .from('words')
    .select('id, en, ja, rank')
    .lte('rank', 400)
    .limit(60);
  if (error) throw new Error(translateError(error));
  return escapeDeep(data || []);
}
