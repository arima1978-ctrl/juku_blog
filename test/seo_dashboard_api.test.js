'use strict';

// api-server.jsを実際に子プロセスで起動し、/api/seo/*エンドポイントの動作を検証する。
// 一時DB・未使用ポートを使い、本番data/posts.sqliteやPORT 3013には触れない。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_dashboard_api_test_${process.pid}.sqlite`);
const PORT = 34213; // テスト専用の未使用ポート

let serverProcess;

function waitForServerReady(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const tryFetch = async () => {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/summary`);
      if (res.ok) return;
    } catch {
      // まだ起動していない
    }
    if (Date.now() > deadline) throw new Error('api-server.jsの起動待ちがタイムアウトしました');
    await new Promise((r) => setTimeout(r, 100));
    return tryFetch();
  };
  return tryFetch();
}

test('setup: api-server.jsを一時DB・専用ポートで起動する', async () => {
  serverProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServerReady();
});

test('GET /api/seo/competitors: 未登録なら空配列', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/seo/competitors`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('GET /api/seo/candidates: 候補が無ければ空配列', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/seo/candidates`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('GET /api/seo/candidates/:id: 存在しなければ404', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/seo/candidates/999999`);
  assert.equal(res.status, 404);
});

test('候補の承認→キュー投入→詳細取得がAPI経由で行える', async () => {
  process.env.JUKU_BLOG_DB_PATH = TMP_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  delete require.cache[require.resolve('../scripts/lib/seo_db')];
  const freshSeoDb = require('../scripts/lib/seo_db');
  const nowIso = '2026-07-13T00:00:00.000Z';
  const created = freshSeoDb.upsertKeywordCandidate(
    { normalized_keyword: 'API経由テスト候補', gap_type: 'missing', priority_score: 65 },
    nowIso
  );
  require('../scripts/lib/db').closeDb();

  const approveRes = await fetch(`http://localhost:${PORT}/api/seo/candidates/${created.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create_article', reason: 'API経由の承認テスト' }),
  });
  assert.equal(approveRes.status, 200);
  const approveBody = await approveRes.json();
  assert.equal(approveBody.to, 'approved');

  const queueRes = await fetch(`http://localhost:${PORT}/api/seo/candidates/${created.id}/queue`, { method: 'POST' });
  assert.equal(queueRes.status, 200);
  assert.equal((await queueRes.json()).to, 'queued');

  const detailRes = await fetch(`http://localhost:${PORT}/api/seo/candidates/${created.id}`);
  const detail = await detailRes.json();
  assert.equal(detail.status, 'queued');
  assert.equal(detail.statusHistory.length, 2);

  // 二重キュー投入はエラーになる
  const secondQueueRes = await fetch(`http://localhost:${PORT}/api/seo/candidates/${created.id}/queue`, { method: 'POST' });
  assert.equal(secondQueueRes.status, 400);
});

test('POST /api/seo/candidates/:id/approve: actionが不正なら400', async () => {
  const seoDb = require('../scripts/lib/seo_db');
  const created = seoDb.upsertKeywordCandidate({ normalized_keyword: '不正action候補', gap_type: 'missing', priority_score: 50 }, '2026-07-13T00:00:00.000Z');
  require('../scripts/lib/db').closeDb();

  const res = await fetch(`http://localhost:${PORT}/api/seo/candidates/${created.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'action未指定' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/seo/candidates/:id/hold: 保留(reviewing)へ遷移できる', async () => {
  const seoDb = require('../scripts/lib/seo_db');
  const created = seoDb.upsertKeywordCandidate({ normalized_keyword: '保留テスト候補', gap_type: 'untapped', priority_score: 40 }, '2026-07-13T00:00:00.000Z');
  require('../scripts/lib/db').closeDb();

  const res = await fetch(`http://localhost:${PORT}/api/seo/candidates/${created.id}/hold`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.to, 'reviewing');
});

after(async () => {
  if (serverProcess) {
    serverProcess.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
});
