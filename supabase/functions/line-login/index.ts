// line-login: 公式LINE から開いた英単語バトルに、LINE ログインで入る（0036・AIOS specs/vocab-line-login-20261010.md）
//
// POST { id_token, action: 'session' }                  → つながっている人なら { status: 'linked', session }、まだなら { status: 'new' }
// POST { id_token, action: 'create', nickname, grade }  → はじめての人を作って { status: 'linked', session }（grade が null ならおとな）
//
// LINE の ID トークンは DB の line_lookup（quiz_line_verify）が LINE のサーバーで確かめる。
// セッションは Auth の管理 API で作る（magiclink のトークンをその場で使う。メールは送らない）。
// 管理用の鍵（SUPABASE_SERVICE_ROLE_KEY）は Supabase が関数に渡すものだけを使う。リポジトリにも Drive にも置かない。
// 前から遊んでいる人のつなぎ込みは、ブラウザがログインしたまま line_link を呼ぶ（この関数は通らない）。
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, opts);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// web/js/logic.js の normalizeNickname / nicknameToEmail と同じ（ニックネームとあいことばでも入れるように同じメールにする）
const normalizeNickname = (s: unknown) => String(s ?? '').normalize('NFC').trim().replace(/[~〜∼⁓～]/g, '～');
const nicknameToEmail = (nick: string) =>
  `v_${[...new TextEncoder().encode(normalizeNickname(nick))].map((b) => b.toString(16).padStart(2, '0')).join('')}@players.miacis-vocab.example`;

async function sessionFor(userId: string) {
  const { data: u, error: e1 } = await admin.auth.admin.getUserById(userId);
  if (e1 || !u.user?.email) throw new Error('not_authenticated');
  const { data: link, error: e2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
  if (e2) throw e2;
  const anon = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, opts);
  const { data: v, error: e3 } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
  if (e3 || !v.session) throw e3 ?? new Error('session_failed');
  return { access_token: v.session.access_token, refresh_token: v.session.refresh_token };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  let body: { id_token?: string; action?: string; nickname?: string; grade?: number | null };
  try { body = await req.json(); } catch { return reply({ error: 'bad_request' }, 400); }

  const look = await admin.rpc('line_lookup', { p_id_token: body.id_token ?? '' });
  if (look.error) return reply({ error: 'line_login_failed' }, 401);
  const { sub, user_id } = look.data as { sub: string; user_id: string | null };

  try {
    if (body.action === 'session') {
      return reply(user_id ? { status: 'linked', session: await sessionFor(user_id) } : { status: 'new' });
    }
    if (body.action === 'create') {
      if (user_id) return reply({ status: 'linked', session: await sessionFor(user_id) });
      const nickname = normalizeNickname(body.nickname);
      const grade = body.grade ?? null;
      if (nickname.length < 1 || nickname.length > 10) return reply({ error: 'invalid_nickname_length' }, 400);
      const made = await admin.auth.admin.createUser({
        email: nicknameToEmail(nickname),
        password: crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true
      });
      if (made.error || !made.data.user) {
        return reply({ error: /already|exists|registered/i.test(made.error?.message ?? '') ? 'nickname_taken' : 'create_failed' }, 400);
      }
      const uid = made.data.user.id;
      const reg = await admin.rpc('line_register', { p_sub: sub, p_user: uid, p_nickname: nickname, p_grade: grade });
      if (reg.error) {
        await admin.auth.admin.deleteUser(uid);
        return reply({ error: reg.error.message }, 400);
      }
      return reply({ status: 'linked', session: await sessionFor(uid) });
    }
    return reply({ error: 'bad_request' }, 400);
  } catch (e) {
    console.error(e);
    return reply({ error: 'session_failed' }, 500);
  }
});
