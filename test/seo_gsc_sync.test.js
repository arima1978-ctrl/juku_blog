'use strict';

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_seo_gsc_sync_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { ROOT } = require('../scripts/lib/config');
const { defaultDateRange, syncGscData } = require('../scripts/seo_gsc_sync');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

test('defaultDateRange: 直近3日分(データ遅延考慮)の期間を返す', () => {
  const { start, end } = defaultDateRange();
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const diffDays = Math.round((endDate - startDate) / (24 * 3600 * 1000));
  assert.equal(diffDays, 2); // 3日分(開始日・終了日含む)
  assert.ok(end < new Date().toISOString().slice(0, 10)); // 今日は含まない(前日まで)
});

test('seo_gsc_sync.js: competitor_keyword_analysis.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_gsc_sync.js'), '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(output, /無処理で終了/);
});

// 日付ごとに異なる行を返すフェイクprovider(実ネットワーク接続は一切行わない)。
function makeFakeProvider(rowsByDate) {
  return {
    async querySearchAnalytics({ startDate, endDate, dimensions, startRow }) {
      if (startRow > 0) return { rows: [], dimensions };
      const dateIndex = dimensions.indexOf('date');
      const rows = Object.entries(rowsByDate)
        .filter(([date]) => date >= startDate && date <= endDate)
        .map(([date, r]) => {
          const keys = [];
          keys[dateIndex] = date;
          keys[dimensions.indexOf('query')] = r.query;
          return { keys, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
        });
      return { rows, dimensions };
    },
  };
}

test('syncGscData: 3日分の同期は3つの異なる日付の行として保存される(一律の日付にならない)', async () => {
  const provider = makeFakeProvider({
    '2026-07-01': { query: '守山区 塾', clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
    '2026-07-02': { query: '守山区 塾', clicks: 2, impressions: 20, ctr: 0.1, position: 4 },
    '2026-07-03': { query: '守山区 塾', clicks: 3, impressions: 30, ctr: 0.1, position: 3 },
  });
  await syncGscData({ provider, siteProperty: 'https://an-english.com/', start: '2026-07-01', end: '2026-07-03', dryRun: false });

  const rows = seoDb.listGscQueriesForKeyword('守山区 塾').filter((r) => r.site_property === 'https://an-english.com/');
  const dates = rows.map((r) => r.date).sort();
  assert.deepEqual(dates, ['2026-07-01', '2026-07-02', '2026-07-03']);
});

test('syncGscData: 重複する期間を再同期しても行が二重に増えない(UNIQUE制約によるupsert)', async () => {
  const provider = makeFakeProvider({
    '2026-08-01': { query: '瓢箪山 塾', clicks: 1, impressions: 10, ctr: 0.1, position: 6 },
    '2026-08-02': { query: '瓢箪山 塾', clicks: 2, impressions: 20, ctr: 0.1, position: 5 },
  });
  await syncGscData({ provider, siteProperty: 'https://an-english.com/', start: '2026-08-01', end: '2026-08-02', dryRun: false });
  // 8/2を含む重複期間で再同期(8/2は更新、8/3は新規)
  const provider2 = makeFakeProvider({
    '2026-08-02': { query: '瓢箪山 塾', clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
    '2026-08-03': { query: '瓢箪山 塾', clicks: 1, impressions: 10, ctr: 0.1, position: 6 },
  });
  await syncGscData({ provider: provider2, siteProperty: 'https://an-english.com/', start: '2026-08-02', end: '2026-08-03', dryRun: false });

  const rows = seoDb.listGscQueriesForKeyword('瓢箪山 塾').filter((r) => r.site_property === 'https://an-english.com/');
  assert.equal(rows.length, 3); // 8/1, 8/2(更新済み), 8/3
  const day2 = rows.find((r) => r.date === '2026-08-02');
  assert.equal(day2.clicks, 5); // 上書きされている(二重計上ではない)
});

test('getGscAggregateForKeyword: 実際の日別行から合計/合計/CTR再計算/加重平均を正しく算出する', () => {
  const provider = makeFakeProvider({
    '2026-09-01': { query: '小幡 塾', clicks: 2, impressions: 20, ctr: 0.1, position: 10 },
    '2026-09-02': { query: '小幡 塾', clicks: 8, impressions: 80, ctr: 0.1, position: 5 },
  });
  return syncGscData({ provider, siteProperty: 'https://an-english.com/', start: '2026-09-01', end: '2026-09-02', dryRun: false }).then(() => {
    const agg = seoDb.getGscAggregateForKeyword('小幡 塾');
    assert.equal(agg.clicks, 10);
    assert.equal(agg.impressions, 100);
    assert.equal(agg.ctr, 0.1); // clicks合計10 / impressions合計100(行ごとのctr単純平均ではない)
    // impressions加重平均: (10*20 + 5*80) / 100 = 6
    assert.equal(agg.avgPosition, 6);
  });
});
