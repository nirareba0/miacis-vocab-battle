import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const adminScript = path.join(rootDir, 'tools', 'admin.mjs');

test('tools/admin.mjs: SUPABASE_SERVICE_ROLE_KEY が無い場合は使用方法を出力して終了コード1', async () => {
  await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [adminScript],
      {
        env: {
          ...process.env,
          SUPABASE_SERVICE_ROLE_KEY: ''
        }
      },
      (error, stdout, stderr) => {
        assert.ok(error, 'エラーで終了すること');
        assert.equal(error.code, 1, '終了コードが1であること');
        const output = stdout + stderr;
        assert.ok(
          output.includes('SUPABASE_SERVICE_ROLE_KEY が設定されていません'),
          '環境変数の案内が含まれること'
        );
        assert.ok(
          output.includes('reset-passphrase'),
          'サブコマンドの案内が含まれること'
        );
        resolve();
      }
    );
  });
});
