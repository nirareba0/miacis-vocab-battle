#!/usr/bin/env node
/**
 * tools/admin.mjs - 管理者用 CLI スクリプト
 *
 * 使用例:
 *   export SUPABASE_SERVICE_ROLE_KEY="ey..."
 *   node tools/admin.mjs reset-passphrase <nickname> <新しいパスワード>
 *   node tools/admin.mjs make-staff <nickname>
 *   node tools/admin.mjs create-staff <nickname...> [--out <ファイル>]
 *   node tools/admin.mjs merge-into <残すアカウント> <消す空アカウント> [--pass-file <ファイル>]
 *   node tools/admin.mjs delete-player <nickname> [--yes]
 *   node tools/admin.mjs set-picker <nickname> on|off
 *   node tools/admin.mjs rename <旧ニックネーム> <新ニックネーム>
 *   node tools/admin.mjs import-words
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nicknameToEmail } from '../web/js/logic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aljlbxvucscmpbcuccin.supabase.co';

function printUsageAndExit(message = null) {
  if (message) {
    console.error(`エラー: ${message}\n`);
  }
  console.log(`
ミアキス 英単語バトル 管理ツール (tools/admin.mjs)

環境変数:
  SUPABASE_SERVICE_ROLE_KEY  必須。Supabase の service_role 秘密鍵
  SUPABASE_URL               省略可能（既定: https://aljlbxvucscmpbcuccin.supabase.co）

サブコマンド:
  reset-passphrase <nickname> <新しいパスワード>
      プレイヤーのパスワードを再設定します。
  make-staff <nickname>
      指定したプレイヤーにスタッフ権限を付与します。
  create-staff <nickname...> [--out <ファイル>]
      スタッフのアカウントを新しく作ります（学年なし・スタッフ区分）。
      パスワードはランダムに作り、画面には出さず --out のファイル（既定:
      ドキュメント/miacis-staff-passphrases.txt）に追記します。Git の外に置くこと。
      すでにあるニックネームは、パスワードを変えずにスタッフ権限だけ付けます。
  merge-into <残すアカウント> <消す空アカウント> [--pass-file <ファイル>]
      空のアカウント（遊んだ記録が無いもの）を消し、残すアカウントをその名前に変えます。
      記録は残すアカウントのものが引き継がれます。消す側がスタッフなら、残す側もスタッフにします。
      --pass-file に消す側の名前の行があれば、残す側のパスワードをそれに揃えます（画面には出さない）。
  delete-player <nickname> [--yes]
      アカウントと、その人の記録（対戦・連続チャレンジ・ポイント・木の実・着せ替え・抽選券など）を全部消します。
      --yes なしだと、消える件数を表示するだけで何もしません。元に戻せません。
  set-picker <nickname> on|off
      指定したプレイヤーのピッカー権限を設定します。
  rename <旧ニックネーム> <新ニックネーム>
      ニックネームを変更し、認証用のメールアドレスも再生成します。
  import-words
      data/words.csv を読み込み、words テーブルにアップサートします。
`);
  process.exit(1);
}

if (!SERVICE_ROLE_KEY) {
  printUsageAndExit('環境変数 SUPABASE_SERVICE_ROLE_KEY が設定されていません。');
}

/**
 * Supabase Admin REST/Auth クライアントラッパー
 */
class SupabaseAdminClient {
  constructor(url, serviceRoleKey) {
    this.url = url.replace(/\/$/, '');
    this.key = serviceRoleKey;
    this.headers = {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json'
    };
  }

  async getPlayerByNickname(nickname) {
    const res = await fetch(
      `${this.url}/rest/v1/players?select=id,nickname,grade,tier,is_picker&nickname=eq.${encodeURIComponent(nickname)}`,
      { headers: this.headers }
    );
    if (!res.ok) {
      throw new Error(`DB 照会エラー: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data && data.length > 0 ? data[0] : null;
  }

  async updateUserAuth(userId, updates) {
    const res = await fetch(`${this.url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      throw new Error(`Auth 更新エラー: ${res.status} ${await res.text()}`);
    }
    return await res.json();
  }

  async createAuthUser(email, password) {
    const res = await fetch(`${this.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    if (!res.ok) {
      throw new Error(`Auth 作成エラー: ${res.status} ${await res.text()}`);
    }
    return await res.json();
  }

  async insertStaffPlayer(userId, nickname) {
    const res = await fetch(`${this.url}/rest/v1/players`, {
      method: 'POST',
      headers: { ...this.headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ id: userId, nickname, grade: null, account_type: 'staff', tier: 1 })
    });
    if (!res.ok) {
      throw new Error(`プレイヤー作成エラー: ${res.status} ${await res.text()}`);
    }
  }

  async deleteAuthUser(userId) {
    await fetch(`${this.url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: this.headers });
  }

  async countRows(table, column, value) {
    const res = await fetch(`${this.url}/rest/v1/${table}?select=${column}&${column}=eq.${value}`, {
      headers: { ...this.headers, Prefer: 'count=exact', Range: '0-0' }
    });
    if (!res.ok) {
      throw new Error(`件数の照会エラー（${table}）: ${res.status} ${await res.text()}`);
    }
    const range = res.headers.get('content-range') || '*/0';
    return parseInt(range.split('/')[1], 10) || 0;
  }

  async isStaff(userId) {
    return (await this.countRows('staff', 'user_id', userId)) > 0;
  }

  async makeStaff(userId) {
    const res = await fetch(`${this.url}/rest/v1/staff`, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'resolution=ignore-duplicates'
      },
      body: JSON.stringify({ user_id: userId })
    });
    if (!res.ok) {
      throw new Error(`スタッフ追加エラー: ${res.status} ${await res.text()}`);
    }
  }

  async setPicker(userId, isPicker) {
    const res = await fetch(`${this.url}/rest/v1/players?id=eq.${userId}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({ is_picker: isPicker })
    });
    if (!res.ok) {
      throw new Error(`ピッカー権限更新エラー: ${res.status} ${await res.text()}`);
    }
  }

  async updateNickname(userId, newNickname) {
    const res = await fetch(`${this.url}/rest/v1/players?id=eq.${userId}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({ nickname: newNickname })
    });
    if (!res.ok) {
      throw new Error(`ニックネーム更新エラー: ${res.status} ${await res.text()}`);
    }
  }

  async upsertWordsBatch(words) {
    const res = await fetch(`${this.url}/rest/v1/words?on_conflict=rank`, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'resolution=merge-duplicates, return=minimal'
      },
      body: JSON.stringify(words)
    });
    if (!res.ok) {
      throw new Error(`単語登録エラー: ${res.status} ${await res.text()}`);
    }
  }
}

const admin = new SupabaseAdminClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// コマンドディスパッチ
const [subcommand, ...args] = process.argv.slice(2);

async function main() {
  if (!subcommand) {
    printUsageAndExit('サブコマンドが指定されていません。');
  }

  switch (subcommand) {
    case 'reset-passphrase': {
      const [nickname, newPass] = args;
      if (!nickname || !newPass) {
        printUsageAndExit('使い方: node tools/admin.mjs reset-passphrase <nickname> <新しいパスワード>');
      }
      if (newPass.length < 6) {
        console.error('エラー: パスワードは6文字以上である必要があります。');
        process.exit(1);
      }
      const player = await admin.getPlayerByNickname(nickname);
      if (!player) {
        console.error(`エラー: ニックネーム "${nickname}" のプレイヤーが見つかりません。`);
        process.exit(1);
      }
      await admin.updateUserAuth(player.id, { password: newPass });
      console.log(`成功: ニックネーム "${nickname}" のパスワードを再設定しました。`);
      break;
    }

    case 'make-staff': {
      const [nickname] = args;
      if (!nickname) {
        printUsageAndExit('使い方: node tools/admin.mjs make-staff <nickname>');
      }
      const player = await admin.getPlayerByNickname(nickname);
      if (!player) {
        console.error(`エラー: ニックネーム "${nickname}" のプレイヤーが見つかりません。`);
        process.exit(1);
      }
      await admin.makeStaff(player.id);
      console.log(`成功: ニックネーム "${nickname}" をスタッフに追加しました。`);
      break;
    }

    case 'create-staff': {
      const outIdx = args.indexOf('--out');
      const outFile = outIdx >= 0 ? args[outIdx + 1] : path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Documents', 'miacis-staff-passphrases.txt');
      const nicknames = args.filter((_, i) => outIdx < 0 || (i !== outIdx && i !== outIdx + 1)).map(n => n.trim()).filter(Boolean);
      if (nicknames.length === 0) {
        printUsageAndExit('使い方: node tools/admin.mjs create-staff <nickname...> [--out <ファイル>]');
      }
      if (path.resolve(outFile).startsWith(rootDir)) {
        console.error('エラー: --out はリポジトリの外にしてください（パスワードを Git に入れない）。');
        process.exit(1);
      }
      // 打ち間違えにくい文字だけ（0/O、1/l/I を除く）
      const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
      const makePass = () => Array.from(crypto.getRandomValues(new Uint32Array(8)), x => alphabet[x % alphabet.length]).join('');
      const lines = [];
      for (const nickname of nicknames) {
        if (nickname.length > 10 || /[\x00-\x1F\x7F]/.test(nickname)) {
          console.log(`スキップ: "${nickname}" はニックネームに使えない（1〜10文字・制御文字なし）`);
          continue;
        }
        const existing = await admin.getPlayerByNickname(nickname);
        if (existing) {
          await admin.makeStaff(existing.id);
          console.log(`既存: "${nickname}" はもう登録済み。スタッフ権限だけ付けた（パスワードは変えていない）`);
          continue;
        }
        const pass = makePass();
        const user = await admin.createAuthUser(nicknameToEmail(nickname), pass);
        try {
          await admin.insertStaffPlayer(user.id, nickname);
          await admin.makeStaff(user.id);
        } catch (err) {
          await admin.deleteAuthUser(user.id);
          throw err;
        }
        lines.push(`${nickname}\t${pass}`);
        console.log(`作成: "${nickname}" をスタッフとして作った`);
      }
      if (lines.length) {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        const header = fs.existsSync(outFile) ? '' : '# ミアキス英単語サバイバル スタッフのパスワード（Git・Drive に置かない。本人に渡したら消す）\n';
        fs.appendFileSync(outFile, header + `# ${new Date().toISOString()}\n` + lines.join('\n') + '\n', { encoding: 'utf8' });
        console.log(`パスワードは ${outFile} に書いた（画面には出さない）`);
      }
      break;
    }

    case 'merge-into': {
      const pfIdx = args.indexOf('--pass-file');
      const passFile = pfIdx >= 0 ? args[pfIdx + 1] : null;
      const [keepNick, dropNick] = args.filter((_, i) => pfIdx < 0 || (i !== pfIdx && i !== pfIdx + 1));
      if (!keepNick || !dropNick) {
        printUsageAndExit('使い方: node tools/admin.mjs merge-into <残すアカウント> <消す空アカウント> [--pass-file <ファイル>]');
      }
      const keep = await admin.getPlayerByNickname(keepNick);
      const drop = await admin.getPlayerByNickname(dropNick);
      if (!keep) { console.error(`エラー: "${keepNick}" が見つかりません。`); process.exit(1); }
      if (!drop) { console.error(`エラー: "${dropNick}" が見つかりません。`); process.exit(1); }
      // 消す側に遊んだ記録が1件でもあれば止める（記録を消さない）
      const tables = ['matches', 'runs', 'points', 'nut_ledger', 'player_items', 'writings', 'raffle_entries', 'prize_tickets'];
      for (const t of tables) {
        const n = await admin.countRows(t, 'player_id', drop.id);
        if (n > 0) {
          console.error(`中止: "${dropNick}" には ${t} の記録が ${n} 件ある。空のアカウントだけ消せる。`);
          process.exit(1);
        }
      }
      const dropWasStaff = await admin.isStaff(drop.id);
      let newPass = null;
      if (passFile && fs.existsSync(passFile)) {
        const row = fs.readFileSync(passFile, 'utf8').split(/\r?\n/).reverse().find(l => l.split('\t')[0] === dropNick);
        if (row) newPass = row.split('\t')[1];
      }
      await admin.deleteAuthUser(drop.id);
      if (await admin.getPlayerByNickname(dropNick)) {
        console.error(`エラー: "${dropNick}" を消せなかった。`);
        process.exit(1);
      }
      await admin.updateNickname(keep.id, dropNick);
      await admin.updateUserAuth(keep.id, { email: nicknameToEmail(dropNick), email_confirm: true, ...(newPass ? { password: newPass } : {}) });
      if (dropWasStaff) await admin.makeStaff(keep.id);
      console.log(`統合: "${keepNick}" の記録を残したまま、名前を "${dropNick}" にした（空の "${dropNick}" は削除）`);
      console.log(dropWasStaff ? 'スタッフ権限: 付けた' : 'スタッフ権限: 変えていない');
      console.log(newPass ? `パスワード: ${passFile} の "${dropNick}" の行に揃えた` : `パスワード: 変えていない（元の "${keepNick}" のまま）`);
      break;
    }

    case 'delete-player': {
      const nickname = args.find(a => a !== '--yes');
      const yes = args.includes('--yes');
      if (!nickname) {
        printUsageAndExit('使い方: node tools/admin.mjs delete-player <nickname> [--yes]');
      }
      const player = await admin.getPlayerByNickname(nickname);
      if (!player) {
        console.error(`エラー: "${nickname}" が見つかりません。`);
        process.exit(1);
      }
      const tables = ['matches', 'runs', 'points', 'nut_ledger', 'player_items', 'writings', 'raffle_entries', 'prize_tickets', 'weekly_results'];
      const counts = [];
      for (const t of tables) {
        counts.push(`${t} ${await admin.countRows(t, 'player_id', player.id)}`);
      }
      const staff = await admin.isStaff(player.id);
      console.log(`対象: "${nickname}"（${staff ? 'スタッフ' : '生徒'}・段${player.tier}）`);
      console.log(`消える記録: ${counts.join(' / ')}`);
      if (!yes) {
        console.log('確認だけして止めた。消すときは --yes を付ける（元に戻せない）');
        break;
      }
      await admin.deleteAuthUser(player.id);
      if (await admin.getPlayerByNickname(nickname)) {
        console.error(`エラー: "${nickname}" を消せなかった。`);
        process.exit(1);
      }
      console.log(`削除: "${nickname}" と、その記録を消した`);
      break;
    }

    case 'set-picker': {
      const [nickname, val] = args;
      if (!nickname || (val !== 'on' && val !== 'off')) {
        printUsageAndExit('使い方: node tools/admin.mjs set-picker <nickname> on|off');
      }
      const player = await admin.getPlayerByNickname(nickname);
      if (!player) {
        console.error(`エラー: ニックネーム "${nickname}" のプレイヤーが見つかりません。`);
        process.exit(1);
      }
      const isPicker = val === 'on';
      await admin.setPicker(player.id, isPicker);
      console.log(`成功: ニックネーム "${nickname}" のピッカー権限を ${val} に設定しました。`);
      break;
    }

    case 'rename': {
      const [oldNick, newNick] = args;
      if (!oldNick || !newNick) {
        printUsageAndExit('使い方: node tools/admin.mjs rename <旧ニックネーム> <新ニックネーム>');
      }
      const trimmedNew = newNick.trim();
      if (trimmedNew.length < 1 || trimmedNew.length > 10) {
        console.error('エラー: 新しいニックネームは1〜10文字である必要があります。');
        process.exit(1);
      }
      if (/[\x00-\x1F\x7F]/.test(trimmedNew)) {
        console.error('エラー: 新しいニックネームに使用できない文字が含まれています。');
        process.exit(1);
      }
      const existingNew = await admin.getPlayerByNickname(trimmedNew);
      if (existingNew) {
        console.error(`エラー: ニックネーム "${trimmedNew}" はすでに使用されています。`);
        process.exit(1);
      }
      const player = await admin.getPlayerByNickname(oldNick);
      if (!player) {
        console.error(`エラー: ニックネーム "${oldNick}" のプレイヤーが見つかりません。`);
        process.exit(1);
      }

      // DB のニックネーム更新
      await admin.updateNickname(player.id, trimmedNew);

      // Auth のメールアドレス更新（logic.js の nicknameToEmail を使用）
      const newEmail = nicknameToEmail(trimmedNew);
      await admin.updateUserAuth(player.id, {
        email: newEmail,
        email_confirm: true
      });

      console.log(`成功: ニックネームを "${oldNick}" から "${trimmedNew}" に変更しました。`);
      console.log(`認証用メールアドレスも "${newEmail}" に更新されました。`);
      break;
    }

    case 'import-words': {
      const csvPath = path.join(rootDir, 'data', 'words.csv');
      if (!fs.existsSync(csvPath)) {
        console.error(`エラー: ${csvPath} が見つかりません。`);
        process.exit(1);
      }
      console.log(`data/words.csv を読み込んでいます...`);
      const fileContent = fs.readFileSync(csvPath, 'utf8');
      const lines = fileContent.split(/\r?\n/).filter(line => line.trim().length > 0);

      if (lines.length < 2) {
        console.error('エラー: CSV ファイルが空です。');
        process.exit(1);
      }

      const headers = parseCSVLine(lines[0]).map(h => h.trim());
      const rankIdx = headers.indexOf('rank');
      const enIdx = headers.indexOf('en');
      const posIdx = headers.indexOf('pos');
      const jaIdx = headers.indexOf('ja');
      const quizzableIdx = headers.indexOf('quizzable');

      if (rankIdx === -1 || enIdx === -1 || jaIdx === -1 || quizzableIdx === -1) {
        console.error('エラー: CSV に rank, en, pos, ja, quizzable 列が必要です。');
        process.exit(1);
      }

      const words = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols[quizzableIdx]?.trim() === '1') {
          words.push({
            rank: parseInt(cols[rankIdx]?.trim(), 10),
            en: cols[enIdx]?.trim(),
            ja: cols[jaIdx]?.trim(),
            pos: posIdx !== -1 ? cols[posIdx]?.trim() : ''
          });
        }
      }

      words.sort((a, b) => a.rank - b.rank);
      const total = words.length;
      if (total === 0) {
        console.error('エラー: quizzable な単語が見つかりません。');
        process.exit(1);
      }

      // band の計算（tools/build-words-seed.mjs と同一規則）
      for (let i = 0; i < total; i++) {
        words[i].band = Math.min(5, Math.floor((i * 5) / total) + 1);
      }

      console.log(`合計 ${total} 件の単語を Supabase words テーブルへ upsert します...`);

      const batchSize = 200;
      for (let i = 0; i < total; i += batchSize) {
        const batch = words.slice(i, i + batchSize);
        await admin.upsertWordsBatch(batch);
        process.stdout.write(`\r投入中: ${Math.min(i + batchSize, total)} / ${total} 件`);
      }
      console.log(`\n完了: ${total} 件の単語を words テーブルに投入しました。`);
      break;
    }

    default:
      printUsageAndExit(`不明なサブコマンド "${subcommand}"`);
  }
}

main().catch(err => {
  console.error('実行エラー:', err.message);
  process.exit(1);
});
