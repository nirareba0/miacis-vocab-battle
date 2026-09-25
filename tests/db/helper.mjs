import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

export async function createTestDb() {
  const db = new PGlite();

  // 1. Supabase Auth Stubs
  await db.exec(`
    do $$
    begin
      if not exists (select from pg_roles where rolname = 'anon') then
        create role anon;
      end if;
      if not exists (select from pg_roles where rolname = 'authenticated') then
        create role authenticated;
      end if;
    end
    $$;

    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text
    );

    create or replace function auth.uid() returns uuid as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ language sql stable;

    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;

    -- 本物の Supabase と同じ既定の権限。public に作ったテーブル・関数・シーケンスは
    -- 何もしなければ anon / authenticated に全部許可される（関数は PUBLIC にも）。
    -- これを再現しないと「GRANT していないから安全」というテストが本番で嘘になる。
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);

  // 2. Run migrations in numeric order
  const migrationsDir = path.join(rootDir, 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.exec(sql);
  }

  return db;
}

export async function seedTestWords(db, wordsPerBand = 30) {
  const rows = [];
  let rank = 1;
  for (let band = 1; band <= 5; band++) {
    for (let i = 1; i <= wordsPerBand; i++) {
      rows.push(`(${rank}, 'word_${band}_${i}', '意味_${band}_${i}', 'noun', ${band})`);
      rank++;
    }
  }

  await db.exec(`
    insert into public.words (rank, en, ja, pos, band)
    values ${rows.join(',\n')}
    on conflict (rank) do nothing;
  `);
}

export async function createUser(db, userId, email = null) {
  const userEmail = email || `user_${userId.slice(0, 8)}@example.com`;
  await db.query(
    'insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing;',
    [userId, userEmail]
  );
}

export async function asUser(db, userId, fn) {
  await db.exec(`
    set role authenticated;
    set "request.jwt.claim.sub" = '${userId}';
  `);
  try {
    return await fn();
  } finally {
    await db.exec(`
      reset role;
      reset "request.jwt.claim.sub";
    `);
  }
}

export async function asAnon(db, fn) {
  await db.exec(`
    set role anon;
    reset "request.jwt.claim.sub";
  `);
  try {
    return await fn();
  } finally {
    await db.exec(`
      reset role;
      reset "request.jwt.claim.sub";
    `);
  }
}

export async function asAdmin(db, fn) {
  await db.exec(`
    reset role;
    reset "request.jwt.claim.sub";
  `);
  return await fn();
}

export async function setTestTime(db, timeStr) {
  if (timeStr) {
    await db.exec(`set app.test_time = '${timeStr}';`);
  } else {
    await db.exec(`reset app.test_time;`);
  }
}
