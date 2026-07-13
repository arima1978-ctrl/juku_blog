'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_csv_import_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { execFileSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');

const TMP_KEYWORD_CSV = path.join(os.tmpdir(), `keyword_metrics_${process.pid}.csv`);
const TMP_SERP_CSV = path.join(os.tmpdir(), `serp_${process.pid}.csv`);

after(() => {
  closeDb();
  [TMP_DB, TMP_KEYWORD_CSV, TMP_SERP_CSV].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

function run(script, args = []) {
  return execFileSync('node', [path.join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8', env: process.env });
}

test('seo_keyword_metrics_import.js: CSVを取り込みseo_keyword_metricsに反映される', () => {
  fs.writeFileSync(TMP_KEYWORD_CSV, 'キーワード,月間検索数\n守山区 塾,120\n', 'utf8');
  const output = run('seo_keyword_metrics_import.js', [TMP_KEYWORD_CSV]);
  assert.match(output, /取込1件/);

  const metric = seoDb.getKeywordMetric('守山区 塾', 'keyword_planner_csv');
  assert.ok(metric);
  assert.equal(metric.average_monthly_searches, 120);
});

test('seo_keyword_metrics_import.js: --dry-runはDBへ書き込まない', () => {
  fs.writeFileSync(TMP_KEYWORD_CSV, 'キーワード,月間検索数\nドライラン専用キーワード,99\n', 'utf8');
  run('seo_keyword_metrics_import.js', [TMP_KEYWORD_CSV, '--dry-run']);
  const metric = seoDb.getKeywordMetric('ドライラン専用キーワード', 'keyword_planner_csv');
  assert.equal(metric, null);
});

test('seo_serp_import.js: CSVを取り込みseo_serp_rankingsに反映される', () => {
  fs.writeFileSync(TMP_SERP_CSV, 'キーワード,ドメイン,順位,確認日\n守山区 塾,an-english.com,4,2026-07-01\n', 'utf8');
  const output = run('seo_serp_import.js', [TMP_SERP_CSV]);
  assert.match(output, /取込1件/);

  const rankings = seoDb.listSerpRankingsForKeyword('守山区 塾');
  assert.equal(rankings.length, 1);
  assert.equal(rankings[0].position, 4);
});

test('seo_keyword_metrics_import.js: 存在しないファイルはエラー終了する', () => {
  assert.throws(() => run('seo_keyword_metrics_import.js', [path.join(os.tmpdir(), 'not-exist-file.csv')]));
});
