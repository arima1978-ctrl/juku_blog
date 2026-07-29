'use strict';

// logs/errors.json(ダッシュボードの「エラー」欄)が校舎を問わず全件表示されてしまう
// バグの修正確認。api-server.jsを子プロセスで起動し、一時DB・一時errors.json・
// 専用ポートを使う(本番data/posts.sqliteやlogs/errors.json、PORT 3013には触れない)。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_errors_scoping_test_${process.pid}.sqlite`);
const TMP_ERRORS = path.join(os.tmpdir(), `juku_blog_errors_scoping_test_${process.pid}.errors.json`);
const PORT = 34221; // テスト専用の未使用ポート(theme_calendar_api.test.jsの34220と重複しない)

let serverProcess;
let branchA;
let branchB;

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
    fs.unlinkSync(TMP_ERRORS);
  } catch {
    // 既に無ければ無視
  }
});

test('setup: api-server.jsを一時DB・一時errors.json・専用ポートで起動し、2校舎を用意する', async () => {
  serverProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, JUKU_BLOG_ERRORS_PATH: TMP_ERRORS, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServerReady();

  const branches = await (await fetch(`http://localhost:${PORT}/api/branches`)).json();
  branchA = branches[0]; // 最初の校舎(小幡校相当)

  branchB = await (
    await fetch(`http://localhost:${PORT}/api/branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'あま本部' }),
    })
  ).json();

  // branch_idごとのエラーと、branch_idを持たない全体エラーを直接errors.jsonへ書き込む
  // (実際にはscripts/log_error.jsのlogError(step, detail, branchId)が書き込む形式と同じ)
  fs.writeFileSync(
    TMP_ERRORS,
    JSON.stringify(
      [
        { at: new Date().toISOString(), step: 'api_seo_crawl', detail: `${branchA.name}のクロール失敗(morikobe)`, branch_id: branchA.id, resolved: false },
        { at: new Date().toISOString(), step: 'api_seo_crawl', detail: `${branchB.name}のクロール失敗(itto)`, branch_id: branchB.id, resolved: false },
        { at: new Date().toISOString(), step: 'seo_gsc_sync', detail: '全体的なAPI認証エラー', branch_id: null, resolved: false },
      ],
      null,
      2
    ),
    'utf8'
  );
});

test('GET /api/summary: 校舎Aを指定すると校舎Aのエラーと校舎に紐づかない全体エラーだけが返る(校舎Bのエラーは混ざらない)', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/summary?branch_id=${branchA.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(body.errors.some((e) => e.detail.includes('morikobe')), '校舎A自身のエラーは表示される');
  assert.ok(body.errors.some((e) => e.detail.includes('全体的な')), '校舎に紐づかない全体エラーは表示される');
  assert.ok(!body.errors.some((e) => e.detail.includes('itto')), '校舎Bのエラーは混ざらない');
});

test('GET /api/summary: 校舎Bを指定すると校舎Bのエラーと全体エラーだけが返る(校舎Aのエラーは混ざらない)', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/summary?branch_id=${branchB.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(body.errors.some((e) => e.detail.includes('itto')), '校舎B自身のエラーは表示される');
  assert.ok(body.errors.some((e) => e.detail.includes('全体的な')), '校舎に紐づかない全体エラーは表示される');
  assert.ok(!body.errors.some((e) => e.detail.includes('morikobe')), '校舎Aのエラーは混ざらない');
});

test('GET /api/summary: resolved=trueのエラーは表示されない(2026-07-29)', async () => {
  fs.writeFileSync(
    TMP_ERRORS,
    JSON.stringify(
      [
        { at: new Date().toISOString(), step: 'x', detail: '未解決エラー', branch_id: null, resolved: false },
        { at: new Date().toISOString(), step: 'x', detail: '解決済みエラー', branch_id: null, resolved: true },
      ],
      null,
      2
    ),
    'utf8'
  );
  const res = await fetch(`http://localhost:${PORT}/api/summary?branch_id=${branchA.id}`);
  const body = await res.json();
  assert.ok(body.errors.some((e) => e.detail.includes('未解決エラー')));
  assert.ok(!body.errors.some((e) => e.detail.includes('解決済みエラー')));
});

test('GET /api/summary: 14日より古い未解決エラーは自動的に表示されなくなる(resolvedマーク忘れの安全網、2026-07-29)', async () => {
  const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20日前
  const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1日前
  fs.writeFileSync(
    TMP_ERRORS,
    JSON.stringify(
      [
        { at: recentDate, step: 'x', detail: '最近の未解決エラー', branch_id: null, resolved: false },
        { at: oldDate, step: 'x', detail: '古い未解決エラー', branch_id: null, resolved: false },
      ],
      null,
      2
    ),
    'utf8'
  );
  const res = await fetch(`http://localhost:${PORT}/api/summary?branch_id=${branchA.id}`);
  const body = await res.json();
  assert.ok(body.errors.some((e) => e.detail.includes('最近の未解決エラー')));
  assert.ok(!body.errors.some((e) => e.detail.includes('古い未解決エラー')));
});
