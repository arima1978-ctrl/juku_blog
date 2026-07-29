'use strict';

// 習い事カテゴリ 週次スナップショット(2026-07-29)のテスト。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_category_snapshot_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
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

const nowIso = '2026-07-27T00:00:00.000Z';
const WEEK_START = '2026-07-13';
const WEEK_END = '2026-07-19';

test('CLI: 生GSCクエリを辞書分類し、習い事カテゴリの合計をJSON出力する(--dry-run)', () => {
  seoDb.upsertGscQueryRows(
    [
      { site_property: 'sc-domain:an-english.com', date: WEEK_START, query: 'そろばん 効果', page: 'https://an-english.com/brand/ansorobanclub/', impressions: 100, clicks: 10 },
      { site_property: 'sc-domain:an-english.com', date: WEEK_START, query: '小幡 英会話', page: 'https://an-english.com/school/obata/', impressions: 50, clicks: 5 },
      { site_property: 'sc-domain:an-english.com', date: WEEK_START, query: '守山区 塾', page: 'https://an-english.com/school/obata/', impressions: 999, clicks: 99 },
      { site_property: 'sc-domain:an-english.com', date: '2026-06-01', query: 'そろばん 週外', page: 'https://an-english.com/brand/ansorobanclub/', impressions: 777, clicks: 77 },
    ],
    nowIso
  );

  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_category_snapshot_generate.js'), `--week=${WEEK_START}`, '--dry-run', '--format=json'], {
    env: process.env,
  }).toString();
  const parsed = JSON.parse(output);
  assert.equal(parsed.saved, false);
  // そろばん(100) + 英会話(50) = 150(週外の777は含まない)
  assert.equal(parsed.totals.naraigoto.impressions, 150);
  assert.equal(parsed.totals.naraigoto.clicks, 15);
  assert.equal(seoDb.listSeoMetricsCategorySnapshots('naraigoto').length, 0);
});

test('CLI: --saveで保存し、再実行するとUPSERT(重複行が増えない)される', () => {
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_category_snapshot_generate.js'), `--week=${WEEK_START}`, '--save'], { env: process.env });
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_category_snapshot_generate.js'), `--week=${WEEK_START}`, '--save'], { env: process.env });

  const rows = seoDb.listSeoMetricsCategorySnapshots('naraigoto');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].week_start, WEEK_START);
  assert.equal(rows[0].week_end, WEEK_END);
  assert.equal(rows[0].impressions, 150);
  assert.equal(rows[0].clicks, 15);
});

function yesterdayAsWeekStart() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const y = yesterday.getFullYear();
  const m = String(yesterday.getMonth() + 1).padStart(2, '0');
  const d = String(yesterday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

test('CLI: 週末から3日経っていない対象週は保存を拒否する(既存スナップショットCLIと同じ防御)', () => {
  const recentWeek = yesterdayAsWeekStart();
  const result = spawnSync('node', [path.join(ROOT, 'scripts', 'seo_metrics_category_snapshot_generate.js'), `--week=${recentWeek}`, '--save'], {
    encoding: 'utf8',
    env: process.env,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /まだ完全ではない可能性/);
});
