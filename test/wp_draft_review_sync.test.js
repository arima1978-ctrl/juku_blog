'use strict';

// あま本部校セルフ運用(branches.sync_mode='draft_review'、2026-07-27)の結合テスト。
// api-server.jsを実子プロセスで起動し、一時DB・専用ポートを使う(本番には触れない)。
// ローカル開発環境には.envが存在しないため、WordPress呼び出し自体は必ず失敗する前提
// (CLAUDE.mdに記載の既知の制約と同じ)。このテストは「WP呼び出しが失敗しても承認自体は
// 成立し、通常のscheduled校舎とは異なるレスポンス形(wpDraftSynced)を返す」ことを確認する。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_wp_draft_review_test_${process.pid}.sqlite`);
const PORT = 34219; // テスト専用の未使用ポート

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

let branchId;
let postId;

test('setup: api-server.jsを一時DB・専用ポートで起動する', async () => {
  serverProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServerReady();
});

test('setup: sync_mode=draft_reviewの校舎を作成する', async () => {
  const createRes = await fetch(`http://localhost:${PORT}/api/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'あま本部校テスト', target_area: 'あま市' }),
  });
  const created = await createRes.json();
  branchId = created.id;
  assert.ok(branchId);

  const updateRes = await fetch(`http://localhost:${PORT}/api/branches/${branchId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sync_mode: 'draft_review' }),
  });
  const updated = await updateRes.json();
  assert.equal(updated.sync_mode, 'draft_review');
});

test('setup: review_pendingの記事をこの校舎向けに直接DBへ投入する', () => {
  process.env.JUKU_BLOG_DB_PATH = TMP_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { insertPost, closeDb } = require('../scripts/lib/db');
  postId = insertPost({
    created_at: new Date().toISOString(),
    slug: 'wp-draft-review-test-slug',
    branch_id: branchId,
    title: 'テスト記事',
    category: 'コラム',
    body_md: '本文',
    body_html: '<p>本文</p>',
    status: 'review_pending',
  });
  closeDb();
  assert.ok(postId);
});

test('POST /api/posts/:id/approve: draft_review校舎はスケジュール計算をせずwpDraftSyncedを返す', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/posts/${postId}/approve`, { method: 'POST' });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.published, false);
  // scheduled校舎向けのレスポンスにあるはずのフィールドが無いこと(通常経路を通っていない証跡)
  assert.equal(body.scheduledAt, undefined);
  assert.equal(body.streakWarnings, undefined);
  // .envが無いテスト環境ではWordPress呼び出しは必ず失敗するため、wpDraftSynced=falseになる
  assert.equal(body.wpDraftSynced, false);
});

test('承認自体はDBに反映されている(approved。WP同期は失敗してもDB承認は成立する)', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/posts/${postId}`);
  const post = await res.json();
  assert.equal(post.status, 'approved');
});
