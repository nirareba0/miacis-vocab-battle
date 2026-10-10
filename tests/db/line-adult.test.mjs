// 0036: 英単語バトルを「LINE で参加」「中高生／それ以外（おとな）」に
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, asUser, asAnon, asAdmin, asService } from './helper.mjs';

const KID = '00000000-0000-0000-0000-00000000a001';
const OLD = '00000000-0000-0000-0000-00000000a002';
const NEW_LINE = '00000000-0000-0000-0000-00000000a003';
const NEW_ADULT = '00000000-0000-0000-0000-00000000a004';
const STAFF = '00000000-0000-0000-0000-00000000a005';
let db;
const rejects = (p, code) => assert.rejects(p, (e) => e.message.includes(code));
const as = (uid, sql, params = []) => asUser(db, uid, async () => (await db.query(sql, params)).rows);
const one = async (uid, sql, params = []) => Object.values((await as(uid, sql, params))[0])[0];
const svc = async (sql, params = []) => asService(db, async () => Object.values((await db.query(sql, params)).rows[0])[0]);

before(async () => {
  db = await createTestDb();
  // LINE の確かめは差し替える（"line-<sub>" を受け取ると <sub> を返す）
  await db.exec(`create or replace function public.quiz_line_verify(p_id_token text) returns text
    language plpgsql as $$ begin
      if p_id_token not like 'line-%' then raise exception 'line_login_failed'; end if;
      return substr(p_id_token, 6);
    end; $$;`);
  for (const id of [KID, OLD, NEW_LINE, NEW_ADULT, STAFF]) await createUser(db, id);
  await as(KID, 'select public.register_player($1, $2, null)', ['こども', 2]);
  await as(OLD, 'select public.register_player($1, $2, null)', ['まえから', 4]);
  await as(STAFF, 'select public.register_player($1, null, null)', ['すたっふ']);
  await asAdmin(db, () => db.query('insert into public.staff (user_id) values ($1)', [STAFF]));
});

test('学年を送らずに登録するとおとな（学年なし）。スタッフにすると staff になる', async () => {
  const adult = (await as(NEW_ADULT, 'select account_type, grade from public.register_player($1, null, null)', ['おとな']))[0];
  assert.deepEqual(adult, { account_type: 'adult', grade: null });
  const kid = (await as(KID, 'select account_type, grade from public.players where id = $1', [KID]))[0];
  assert.deepEqual(kid, { account_type: 'student', grade: 2 });
  const staff = (await as(STAFF, 'select account_type from public.players where id = $1', [STAFF]))[0];
  assert.equal(staff.account_type, 'staff');
  await rejects(as(NEW_LINE, 'select public.register_player($1, $2, null)', ['x', 7]), 'invalid_grade');
});

test('おとなは受験レベル（band 4）まで最初から開く。最難関（5）は開かない', async () => {
  const open = async (band) => asAdmin(db, async () => (await db.query('select public.stage_unlocked($1, $2) as v', [NEW_ADULT, band])).rows[0].v);
  assert.equal(await open(4), true);
  assert.equal(await open(5), false);
});

test('LINE: はじめての人は line_lookup で未登録、line_register で players と line_links が同時に入る', async () => {
  const first = await svc('select public.line_lookup($1)', ['line-U-new']);
  assert.deepEqual(first, { sub: 'U-new', user_id: null });
  await svc('select (public.line_register($1, $2, $3, $4)).account_type', ['U-new', NEW_LINE, 'ラインの子', 3]);
  assert.equal((await asAdmin(db, () => db.query('select account_type from public.players where id = $1', [NEW_LINE]))).rows[0].account_type, 'student');
  assert.equal((await svc('select public.line_lookup($1)', ['line-U-new'])).user_id, NEW_LINE);
  // 同じ LINE でもう1人は作れない
  await rejects(svc('select public.line_register($1, $2, $3, $4)', ['U-new', OLD, 'べつ', 3]), 'line_already_linked');
  // ニックネームがかぶったら、何も入らない（line_links も残らない）
  await rejects(svc('select public.line_register($1, $2, $3, $4)', ['U-dup', OLD, 'こども', 3]), 'nickname_taken');
  assert.equal((await svc('select public.line_lookup($1)', ['line-U-dup'])).user_id, null);
});

test('LINE: 前から遊んでいる人は、ログインしたまま line_link でつなぐ。1つの LINE に1人', async () => {
  assert.equal(await one(OLD, 'select public.my_line_linked()'), false);
  assert.deepEqual(await one(OLD, 'select public.line_link($1)', ['line-U-old']), { linked: true });
  assert.deepEqual(await one(OLD, 'select public.line_link($1)', ['line-U-old']), { linked: true }); // もう一度押しても同じ
  assert.equal(await one(OLD, 'select public.my_line_linked()'), true);
  assert.equal((await svc('select public.line_lookup($1)', ['line-U-old'])).user_id, OLD);
  await rejects(one(KID, 'select public.line_link($1)', ['line-U-old']), 'line_already_linked');
  await rejects(one(OLD, 'select public.line_link($1)', ['line-U-other']), 'account_already_linked');
  await rejects(one(KID, 'select public.line_link($1)', ['bad']), 'line_login_failed');
});

test('LINE の表と service_role 用の関数は、ブラウザ（anon / authenticated）から触れない', async () => {
  await rejects(as(KID, 'select * from public.line_links'), 'permission denied');
  await rejects(as(KID, 'select public.line_lookup($1)', ['line-U-old']), 'permission denied');
  await rejects(as(KID, 'select public.line_register($1, $2, $3, $4)', ['U-x', KID, 'x', 1]), 'permission denied');
  await rejects(asAnon(db, () => db.query('select public.line_link($1)', ['line-U-x'])), 'permission denied');
  await rejects(asAnon(db, () => db.query('select public.register_player_core($1, $2, $3)', [KID, 'x', 1])), 'permission denied');
});

test('ランキング: おとなは別の順位（is_adult）。中高生の順位にはスタッフだけが混ざる', async () => {
  await asAdmin(db, () => db.query(`
    insert into public.points (player_id, kind, reason, amount, day, week_start)
    select id, 'commit', 'test', v, public.jst_today(), public.jst_week_start()
    from (values ($1::uuid, 10), ($2::uuid, 30), ($3::uuid, 20)) as t(id, v)`, [KID, NEW_ADULT, STAFF]));
  const rows = await as(KID, 'select nickname, rank, is_adult, is_staff from public.ranking_commit_week where commit_points > 0 order by is_adult, rank');
  assert.deepEqual(rows.map((r) => [r.nickname, r.rank, r.is_adult]), [['すたっふ', 1, false], ['こども', 2, false], ['おとな', 1, true]]);
});
