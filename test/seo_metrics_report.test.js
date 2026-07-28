'use strict';

// SEO効果測定レポート(2026-07-29)のテスト。必ず一時SQLite(JUKU_BLOG_DB_PATH)を使う。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_metrics_report_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const branchesDb = require('../scripts/lib/branches_db');
const { pctChange, buildBranchReport, formatText } = require('../scripts/seo_metrics_report');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-29T00:00:00.000Z';

test('pctChange: 前週比を計算する', () => {
  assert.equal(pctChange(120, 100), 20);
  assert.equal(pctChange(80, 100), -20);
});

test('pctChange: 前週が0またはnullなら算出不能でnullを返す', () => {
  assert.equal(pctChange(50, 0), null);
  assert.equal(pctChange(50, null), null);
});

test('buildBranchReport: スナップショットが無い校舎はhasData=false', () => {
  const branch = branchesDb.createBranch({ name: 'データ無し校舎', slug: '__test_report_nodata__' });
  const report = buildBranchReport(branch);
  assert.equal(report.hasData, false);
});

test('buildBranchReport: 直近2週のスナップショットから前週比・キーワード順位を組み立てる', () => {
  const branch = branchesDb.createBranch({ name: 'レポートテスト校', slug: '__test_report_branch__' });

  seoDb.upsertSeoMetricsSnapshot(
    {
      branchId: branch.id,
      weekStart: '2026-07-06',
      weekEnd: '2026-07-12',
      impressionsTotal: 1000,
      clicksTotal: 100,
      impressionsSchoolPage: 100,
      clicksSchoolPage: 10,
      impressionsBlog: 50,
      clicksBlog: 5,
      impressionsOther: 850,
      clicksOther: 85,
      taskCountTotal: 10,
      taskCountProposed: 2,
      taskCountApproved: 6,
      taskCountRejected: 1,
      taskCountReviewing: 1,
      taskCountMonitorExclude: 0,
      taskCountImplemented: 1,
      gapFulfilledCount: 1,
      gapTotalCount: 6,
      gapFulfillmentRate: 1 / 6,
      publishedCountCumulative: 3,
      publishedCountWeek: 1,
      isBaseline: false,
    },
    nowIso
  );

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

  seoDb.upsertSeoMetricsKeywordSnapshot(
    { branchId: branch.id, weekStart: '2026-07-13', weekEnd: '2026-07-19', normalizedKeyword: 'レポート テスト キーワードA', avgPosition: 5.2, impressions: 40, clicks: 3, isImplementedAsOfWeek: true },
    nowIso
  );
  seoDb.upsertSeoMetricsKeywordSnapshot(
    { branchId: branch.id, weekStart: '2026-07-13', weekEnd: '2026-07-19', normalizedKeyword: 'レポート テスト キーワードB', avgPosition: 12.1, impressions: 20, clicks: 1, isImplementedAsOfWeek: false },
    nowIso
  );

  const report = buildBranchReport(branch);

  assert.equal(report.hasData, true);
  assert.equal(report.latestWeek.weekStart, '2026-07-13');
  assert.equal(report.previousWeek.weekStart, '2026-07-06');

  // ブログ: 100 vs 50 -> +100%
  assert.equal(report.buckets.blog.impressions, 100);
  assert.equal(report.buckets.blog.impressionsChangePct, 100);
  // 校舎ページ: 120 vs 100 -> +20%
  assert.equal(report.buckets.schoolPage.impressionsChangePct, 20);

  assert.equal(report.gapFulfillment.fulfilled, 2);
  assert.equal(report.gapFulfillment.total, 7);
  assert.ok(Math.abs(report.gapFulfillment.previousRate - 1 / 6) < 1e-9);

  // implemented: 前週1件 -> 今週2件 = 週内増分+1件(2026-07-29追加、週次ダイジェスト用)
  assert.equal(report.taskCounts.implementedWeekIncrement, 1);

  // キーワードは順位の良い順(数値が小さいほど上位)に並ぶ
  assert.equal(report.keywords.length, 2);
  assert.equal(report.keywords[0].keyword, 'レポート テスト キーワードA');
  assert.equal(report.keywords[0].implemented, true);
  assert.equal(report.keywords[1].keyword, 'レポート テスト キーワードB');
});

test('buildBranchReport: 前週データが無ければimplementedWeekIncrementはnull', () => {
  const branch = branchesDb.createBranch({ name: '前週無し校', slug: '__test_report_no_previous__' });
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
    nowIso
  );
  const report = buildBranchReport(branch);
  assert.equal(report.taskCounts.implementedWeekIncrement, null);
});

test('formatText: hasData=falseの校舎はデータなしと表示する', () => {
  const text = formatText([{ branchName: 'テスト', hasData: false }]);
  assert.match(text, /スナップショットがまだありません/);
});

test('formatText: 4区分・充足率・キーワードを含むテキストを生成する', () => {
  const text = formatText([
    {
      branchName: 'フォーマットテスト校',
      hasData: true,
      latestWeek: { weekStart: '2026-07-13', weekEnd: '2026-07-19' },
      previousWeek: { weekStart: '2026-07-06' },
      buckets: {
        blog: { impressions: 100, clicks: 10, impressionsChangePct: 100 },
        schoolPage: { impressions: 120, clicks: 8, impressionsChangePct: 20 },
        other: { impressions: 980, clicks: 72, impressionsChangePct: null },
        total: { impressions: 1200, clicks: 90, impressionsChangePct: 20 },
      },
      gapFulfillment: { rate: 2 / 7, fulfilled: 2, total: 7, previousRate: 1 / 6 },
      taskCounts: { proposed: 1, approved: 7, rejected: 1, reviewing: 1, implemented: 2 },
      publishedCountCumulative: 4,
      keywords: [{ keyword: 'kw-a', avgPosition: 5.2, impressions: 40, clicks: 3, implemented: true }],
    },
  ]);
  assert.match(text, /ブログ.*100回.*前週比\+100%/);
  assert.match(text, /2\/7/);
  assert.match(text, /kw-a: 順位5\.2/);
});

test('CLI: --format=jsonでレポートを出力できる', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_report.js'), '--format=json'], { env: process.env }).toString();
  const parsed = JSON.parse(output);
  assert.equal(parsed.ok, true);
  assert.ok(Array.isArray(parsed.reports));
});
