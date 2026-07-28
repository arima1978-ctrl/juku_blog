'use strict';

// 週次SEOダイジェスト(2026-07-29)のテスト。必ず一時SQLite(JUKU_BLOG_DB_PATH)を使う。
// 実送信はしない(既存方針どおりネットワーク送信は検証しない。--dry-runで文面のみ検証)。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_metrics_digest_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const branchesDb = require('../scripts/lib/branches_db');
const { formatDigestBlock, formatDigest } = require('../scripts/seo_metrics_digest');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

test('formatDigestBlock: hasData=falseはnullを返す(通知に含めない)', () => {
  assert.equal(formatDigestBlock({ hasData: false }), null);
});

test('formatDigestBlock: 校舎に帰属する数字(ブログ+校舎ページ)のみの簡潔な1行を生成する', () => {
  const block = formatDigestBlock({
    hasData: true,
    branchName: 'ダイジェストテスト校',
    buckets: {
      blog: { impressions: 10, clicks: 1 },
      schoolPage: { impressions: 20, clicks: 2 },
      other: { impressions: 970, clicks: 90 },
      total: { impressions: 1000, clicks: 93, impressionsChangePct: 20, clicksChangePct: -5 },
      attributed: { impressions: 30, clicks: 3, impressionsChangePct: 50, clicksChangePct: -10 },
    },
    gapFulfillment: { rate: 2 / 7, fulfilled: 2, total: 7 },
    taskCounts: { implementedWeekIncrement: 1 },
  });
  assert.match(block, /ダイジェストテスト校/);
  // 校舎帰属分(30回)を使い、サイト全体の数字(1,000回)は使わない
  assert.match(block, /30回\/3クリック\(前週比\+50%\)/);
  assert.match(block, /ブログ10・校舎ページ20/);
  assert.doesNotMatch(block, /その他/);
  assert.match(block, /2\/7/);
  assert.match(block, /実施1件/);
  // 30秒で読める長さを維持する制約: 1校舎ぶんは1行
  assert.equal(block.split('\n').length, 1, `1校舎ぶんが長すぎる(${block.split('\n').length}行)`);
});

test('formatDigestBlock: implementedWeekIncrementがnullなら"-"表示', () => {
  const block = formatDigestBlock({
    hasData: true,
    branchName: 'X',
    buckets: {
      blog: { impressions: 0, clicks: 0 },
      schoolPage: { impressions: 0, clicks: 0 },
      other: { impressions: 0, clicks: 0 },
      total: { impressions: 0, clicks: 0, impressionsChangePct: null, clicksChangePct: null },
      attributed: { impressions: 0, clicks: 0, impressionsChangePct: null, clicksChangePct: null },
    },
    gapFulfillment: { rate: 0, fulfilled: 0, total: 0 },
    taskCounts: { implementedWeekIncrement: null },
  });
  assert.match(block, /実施-/);
});

test('formatDigest: 全校舎hasData=falseならnullを返す(無意味な通知を送らない)', () => {
  assert.equal(formatDigest([{ hasData: false }, { hasData: false }]), null);
});

test('formatDigest: 見出し・サイト全体行(1回だけ)・複数校舎ブロック・フルレポート誘導を含む', () => {
  const r = {
    hasData: true,
    branchName: 'Y校',
    latestWeek: { weekStart: '2026-07-13', weekEnd: '2026-07-19' },
    buckets: {
      blog: { impressions: 1, clicks: 0 },
      schoolPage: { impressions: 2, clicks: 0 },
      other: { impressions: 3, clicks: 0 },
      total: { impressions: 6, clicks: 0, impressionsChangePct: -10, clicksChangePct: null },
      attributed: { impressions: 3, clicks: 0, impressionsChangePct: null, clicksChangePct: null },
    },
    gapFulfillment: { rate: 0, fulfilled: 0, total: 1 },
    taskCounts: { implementedWeekIncrement: 0 },
  };
  const text = formatDigest([r]);
  assert.match(text, /週次SEOダイジェスト\(2026-07-13〜2026-07-19週\)/);
  assert.match(text, /🌐 サイト全体: 6回\/0クリック\(前週比-10%\)/);
  // サイト全体行は1回だけ(校舎ブロックには繰り返さない)
  assert.equal((text.match(/サイト全体/g) || []).length, 1);
  assert.match(text, /Y校/);
  assert.match(text, /node scripts\/seo_metrics_report\.js/);
});

test('CLI: --dry-runでは送信せず文面のみ表示する(実データで疎通確認)', () => {
  const branch = branchesDb.createBranch({ name: 'ダイジェストCLIテスト校', slug: '__test_digest_cli__' });
  seoDb.upsertSeoMetricsSnapshot(
    {
      branchId: branch.id,
      weekStart: '2026-07-13',
      weekEnd: '2026-07-19',
      impressionsTotal: 100,
      clicksTotal: 10,
      impressionsSchoolPage: 10,
      clicksSchoolPage: 1,
      impressionsBlog: 5,
      clicksBlog: 0,
      impressionsOther: 85,
      clicksOther: 9,
      taskCountTotal: 5,
      taskCountProposed: 1,
      taskCountApproved: 3,
      taskCountRejected: 1,
      taskCountReviewing: 0,
      taskCountMonitorExclude: 0,
      taskCountImplemented: 1,
      gapFulfilledCount: 1,
      gapTotalCount: 3,
      gapFulfillmentRate: 1 / 3,
      publishedCountCumulative: 1,
      publishedCountWeek: 1,
      isBaseline: false,
    },
    '2026-07-20T00:00:00.000Z'
  );

  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_digest.js'), `--branch-id=${branch.id}`, '--dry-run'], {
    env: process.env,
  }).toString();
  assert.match(output, /週次SEOダイジェスト/);
  assert.match(output, /送信しません/);
});
