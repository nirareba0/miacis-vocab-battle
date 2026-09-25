/**
 * api.js - Supabase クライアント初期化と RPC / データ取得の薄いラッパー
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';
import { nicknameToEmail, translateError, escapeDeep } from './logic.js';

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
 * 新規プレイヤー登録
 */
export async function signUpPlayer(nickname, passphrase, grade) {
  checkClient();
  const trimmedNick = (nickname || '').trim();
  if (trimmedNick.length < 1 || trimmedNick.length > 10) {
    throw new Error('ニックネームは1〜10文字で入力してください');
  }
  if (!passphrase || passphrase.length < 6) {
    throw new Error('あいことばは6文字以上で入力してください');
  }
  if (!grade || grade < 1 || grade > 6) {
    throw new Error('学年を選択してください');
  }

  const email = nicknameToEmail(trimmedNick);
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password: passphrase
  });
  if (authError) {
    throw new Error(translateError(authError));
  }

  // Auth 登録成功後、players テーブルへ登録 (RPC)
  const { data: playerData, error: rpcError } = await supabase.rpc('register_player', {
    p_nickname: trimmedNick,
    p_grade: grade
  });
  if (rpcError) {
    throw new Error(translateError(rpcError));
  }

  return { user: authData.user, player: escapeDeep(playerData) };
}

/**
 * ログイン
 */
export async function signInPlayer(nickname, passphrase) {
  checkClient();
  const trimmedNick = (nickname || '').trim();
  if (!trimmedNick) {
    throw new Error('ニックネームを入力してください');
  }
  if (!passphrase) {
    throw new Error('あいことばを入力してください');
  }
  const email = nicknameToEmail(trimmedNick);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: passphrase
  });
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
  const { data, error } = await supabase
    .from('players')
    .select('*')
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
