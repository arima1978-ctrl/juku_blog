'use strict';

// GET /api/theme-calendarのbranch-aware対応(記事生成パイプラインの複数校舎対応 Phase 1)。
// api-server.jsを子プロセスで起動し、一時DB・専用ポートを使う(本番data/posts.sqliteや
// PORT 3013には触れない)。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_theme_calendar_api_test_${process.pid}.sqlite`);
const PORT = 34220; // テスト専用の未使用ポート

let serverProcess;

function waitForServerReady(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const tryFetch = async () => {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/branches`);
      if (res.status) return;
    } catch {
      // まだ起動していない
    }
    if (Date.now() > deadline) throw new Error('api-server.jsの起動待ちがタイムアウトしました');
    await new Promise((r) => setTimeout(r, 100));
    return tryFetch();
  };
  return tryFetch();
}

after(() => {
  if (serverProcess) serverProcess.kill();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
  try {
    fs.rmSync(path.join(ROOT, 'branches', '__test_theme_calendar_ama__'), { recursive: true, force: true });
  } catch {
    // 既に無ければ無視
  }
});

test('setup: api-server.jsを一時DB・専用ポートで起動する', async () => {
  serverProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServerReady();
});

test('GET /api/theme-calendar: 最初の校舎(小幡校相当)はisSharedFallback=falseになる', async () => {
  const branches = await (await fetch(`http://localhost:${PORT}/api/branches`)).json();
  const firstBranchId = branches[0].id;

  const res = await fetch(`http://localhost:${PORT}/api/theme-calendar?days=5&branch_id=${firstBranchId}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.isSharedFallback, false);
  assert.equal(body.calendar.length, 5);
});

test('GET /api/theme-calendar: 後から追加した校舎(あま本部相当)は校舎別ファイルが無ければisSharedFallback=trueになる', async () => {
  const newBranch = await (
    await fetch(`http://localhost:${PORT}/api/branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'あま本部' }),
    })
  ).json();

  const res = await fetch(`http://localhost:${PORT}/api/theme-calendar?days=5&branch_id=${newBranch.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.isSharedFallback, true);
  assert.equal(body.calendar.length, 5);
});

test('GET /api/theme-calendar: branch_id省略時は現在アクティブな校舎で解決される(後方互換)', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/theme-calendar?days=5`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.isSharedFallback, false, 'アクティブな校舎(=最初の校舎)なのでフォールバック扱いにはならない');
});
