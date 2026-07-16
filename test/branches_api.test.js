'use strict';

// 複数校舎管理(プランA)のAPI結合テスト。api-server.jsを実際に子プロセスで起動し、
// 一時DB・専用ポートを使う(本番data/posts.sqliteやPORT 3013には触れない)。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_branches_api_test_${process.pid}.sqlite`);
const PORT = 34218; // テスト専用の未使用ポート

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
});

test('setup: api-server.jsを一時DB・専用ポートで起動する', async () => {
  serverProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServerReady();
});

test('GET /api/branches: 初回アクセスでconfig由来の1件が自動シードされて返る', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches`);
  assert.equal(res.status, 200);
  const branches = await res.json();
  assert.equal(branches.length, 1);
  assert.equal(branches[0].is_active, true);
  global.__seedBranchId = branches[0].id;
});

test('POST /api/branches: name無しは400', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_area: 'テスト' }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'name_required');
});

test('POST /api/branches: 校舎を新規作成できる', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '瓢箪山校',
      target_area: '瓢箪山',
      wordpress_author_id: 20,
      wordpress_author_display_name: '山田太郎',
    }),
  });
  assert.equal(res.status, 200);
  const branch = await res.json();
  assert.equal(branch.name, '瓢箪山校');
  assert.equal(branch.wordpress_author_id, 20);
  assert.equal(branch.is_active, false);
  global.__newBranchId = branch.id;
});

test('GET /api/branches: 作成した校舎が一覧に含まれる', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches`);
  const branches = await res.json();
  assert.equal(branches.length, 2);
});

test('PUT /api/branches/:id: 指定フィールドのみ更新できる', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches/${global.__newBranchId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_area: '瓢箪山駅前' }),
  });
  assert.equal(res.status, 200);
  const branch = await res.json();
  assert.equal(branch.target_area, '瓢箪山駅前');
  assert.equal(branch.name, '瓢箪山校');
});

test('PUT /api/branches/:id: 存在しないIDは404', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches/999999`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  });
  assert.equal(res.status, 404);
});

test('DELETE /api/branches/:id: アクティブな校舎は削除できず400', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches/${global.__seedBranchId}`, { method: 'DELETE' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'cannot_delete_active_branch');
});

test('POST /api/branches/:id/activate: 校舎を切り替えられ、is_active=1は常に1件のみになる', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches/${global.__newBranchId}/activate`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.branch.is_active, true);

  const list = await (await fetch(`http://localhost:${PORT}/api/branches`)).json();
  const activeCount = list.filter((b) => b.is_active).length;
  assert.equal(activeCount, 1);
});

test('DELETE /api/branches/:id: 非アクティブになった旧校舎は削除できる', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches/${global.__seedBranchId}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('DELETE /api/branches/:id: 存在しないIDは404', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/branches/999999`, { method: 'DELETE' });
  assert.equal(res.status, 404);
});
