'use strict';

// SEO効果測定タブ フェーズ1(2026-07-29): 読み取り専用API
// GET /api/seo/metrics-snapshots・GET /api/seo/metrics-keyword-snapshots のテスト。
// api-server.jsを子プロセスで起動し、一時DB・専用ポートを使う(本番data/posts.sqliteや
// PORT 3013には触れない)。書き込み系エンドポイントは存在しない設計のため、このテストも
// 読み取り確認のみを対象とする。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_metrics_snapshot_api_test_${process.pid}.sqlite`);
const PORT = 34216;

let serverProcess;

function waitForServerReady(port, checkPath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const tryFetch = async () => {
    try {
      const res = await fetch(`http://localhost:${port}${checkPath}`);
      if (res.status) return;
    } catch {
      // まだ起動していない
    }
    if (Date.now() > deadline) throw new Error(`api-server.js(port=${port})の起動待ちがタイムアウトしました`);
    await new Promise((r) => setTimeout(r, 100));
    return tryFetch();
  };
  return tryFetch();
}

const nowIso = '2026-07-29T00:00:00.000Z';

test('setup: シードデータを投入し、api-server.jsを一時DB・専用ポートで起動する', async () => {
  process.env.JUKU_BLOG_DB_PATH = TMP_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  delete require.cache[require.resolve('../scripts/lib/seo_db')];
  delete require.cache[require.resolve('../scripts/lib/branches_db')];
  const seoDb = require('../scripts/lib/seo_db');
  const branchesDb = require('../scripts/lib/branches_db');

  const branch = branchesDb.createBranch({ name: 'metrics-api-テスト校', slug: '__test_metrics_api_branch__' });
  global.__metricsApiBranchId = branch.id;

  seoDb.upsertSeoMetricsSnapshot(
    {
      branchId: branch.id,
      weekStart: '2026-07-13',
      weekEnd: '2026-07-19',
      impressionsTotal: 1200,
      clicksTotal: 90,
      impressionsSchoolPage: 120,
      clicksSchoolPage: 8,
      impressionsBlog: 100,
      clicksBlog: 10,
      impressionsOther: 980,
      clicksOther: 72,
      taskCountTotal: 10,
      taskCountProposed: 1,
      taskCountApproved: 7,
      taskCountRejected: 1,
      taskCountReviewing: 1,
      taskCountMonitorExclude: 0,
      taskCountImplemented: 2,
      gapFulfilledCount: 2,
      gapTotalCount: 7,
      gapFulfillmentRate: 2 / 7,
      publishedCountCumulative: 4,
      publishedCountWeek: 1,
      isBaseline: false,
    },
    nowIso
  );
  seoDb.upsertSeoMetricsSnapshot(
    {
      branchId: branch.id,
      weekStart: '2026-07-20',
      weekEnd: '2026-07-26',
      impressionsTotal: 1500,
      clicksTotal: 110,
      impressionsSchoolPage: 140,
      clicksSchoolPage: 12,
      impressionsBlog: 150,
      clicksBlog: 15,
      impressionsOther: 1210,
      clicksOther: 83,
      taskCountTotal: 12,
      taskCountProposed: 1,
      taskCountApproved: 9,
      taskCountRejected: 1,
      taskCountReviewing: 1,
      taskCountMonitorExclude: 0,
      taskCountImplemented: 3,
      gapFulfilledCount: 3,
      gapTotalCount: 9,
      gapFulfillmentRate: 3 / 9,
      publishedCountCumulative: 5,
      publishedCountWeek: 1,
      isBaseline: false,
    },
    nowIso
  );

  seoDb.upsertSeoMetricsKeywordSnapshot(
    { branchId: branch.id, weekStart: '2026-07-20', weekEnd: '2026-07-26', normalizedKeyword: 'metrics-apiテスト キーワードA', avgPosition: 5.2, impressions: 40, clicks: 3, isImplementedAsOfWeek: true },
    nowIso
  );
  seoDb.upsertSeoMetricsKeywordSnapshot(
    { branchId: branch.id, weekStart: '2026-07-20', weekEnd: '2026-07-26', normalizedKeyword: 'metrics-apiテスト キーワードB', avgPosition: 12.1, impressions: 10, clicks: 0, isImplementedAsOfWeek: false },
    nowIso
  );
  require('../scripts/lib/db').closeDb();

  serverProcess = spawn('node', [path.join(ROOT, 'scripts', 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServerReady(PORT, '/api/seo/competitors');
});

test('GET /api/seo/metrics-snapshots: 週次スナップショットが週start昇順で返る(校舎帰属・サイト全体双方の生データを含む)', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/seo/metrics-snapshots?branch_id=${global.__metricsApiBranchId}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.branchId, global.__metricsApiBranchId);
  assert.equal(body.snapshots.length, 2);
  assert.equal(body.snapshots[0].weekStart, '2026-07-13');
  assert.equal(body.snapshots[1].weekStart, '2026-07-20');
  // 校舎帰属(ブログ+校舎ページ)の元になる生データ
  assert.equal(body.snapshots[1].impressionsBlog, 150);
  assert.equal(body.snapshots[1].impressionsSchoolPage, 140);
  // サイト全体(その他込み)の独立グラフ用の生データ
  assert.equal(body.snapshots[1].impressionsTotal, 1500);
  assert.equal(body.snapshots[1].impressionsOther, 1210);
  assert.equal(body.snapshots[1].gapFulfillmentRate, 3 / 9);
});

test('GET /api/seo/metrics-snapshots: 存在しないbranch_idは空配列(エラーにしない)', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/seo/metrics-snapshots?branch_id=999999`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.snapshots, []);
});

test('GET /api/seo/metrics-keyword-snapshots: branch_id指定で全キーワードの週次実績が返る', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/seo/metrics-keyword-snapshots?branch_id=${global.__metricsApiBranchId}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.snapshots.length, 2);
  const a = body.snapshots.find((s) => s.normalizedKeyword === 'metrics-apiテスト キーワードA');
  assert.equal(a.avgPosition, 5.2);
  assert.equal(a.isImplementedAsOfWeek, true);
});

test('GET /api/seo/metrics-keyword-snapshots?keywords=: カンマ区切りで指定したキーワードのみに絞り込める', async () => {
  const res = await fetch(
    `http://localhost:${PORT}/api/seo/metrics-keyword-snapshots?branch_id=${global.__metricsApiBranchId}&keywords=${encodeURIComponent('metrics-apiテスト キーワードB')}`
  );
  const body = await res.json();
  assert.equal(body.snapshots.length, 1);
  assert.equal(body.snapshots[0].normalizedKeyword, 'metrics-apiテスト キーワードB');
  assert.equal(body.snapshots[0].isImplementedAsOfWeek, false);
});

test('書き込み系エンドポイントは存在しない(POST/PUT/DELETEは404、安全設計のため意図的に未実装)', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/seo/metrics-snapshots`, { method: 'POST' });
  assert.equal(res.status, 404);
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
