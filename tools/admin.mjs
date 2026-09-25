#!/usr/bin/env node
/**
 * tools/admin.mjs - 管理者用 CLI スクリプト
 *
 * 使用例:
 *   export SUPABASE_SERVICE_ROLE_KEY="ey..."
 *   node tools/admin.mjs reset-passphrase <nickname> <新しいあいことば>
 *   node tools/admin.mjs make-staff <nickname>
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
  reset-passphrase <nickname> <新しいあいことば>
      プレイヤーのあいことばを再設定します。
  make-staff <nickname>
      指定したプレイヤーにスタッフ権限を付与します。
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
        printUsageAndExit('使い方: node tools/admin.mjs reset-passphrase <nickname> <新しいあいことば>');
      }
      if (newPass.length < 6) {
        console.error('エラー: あいことばは6文字以上である必要があります。');
        process.exit(1);
      }
      const player = await admin.getPlayerByNickname(nickname);
      if (!player) {
        console.error(`エラー: ニックネーム "${nickname}" のプレイヤーが見つかりません。`);
        process.exit(1);
      }
      await admin.updateUserAuth(player.id, { password: newPass });
      console.log(`成功: ニックネーム "${nickname}" のあいことばを再設定しました。`);
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
