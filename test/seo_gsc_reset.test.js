'use strict';

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_seo_gsc_reset_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
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

function seedGscRow() {
  seoDb.upsertGscQueryRow(
    { site_property: 'https://an-english.com/', date: '2026-07-01', query: '守山区 塾', clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
    '2026-07-01T00:00:00.000Z'
  );
}

function run(args) {
  return execFileSync('node', [path.join(ROOT, 'scripts', 'seo_gsc_reset.js'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
}

test('seo_gsc_reset.js --dry-run: 件数のみ表示し削除しない', () => {
  seedGscRow();
  closeDb();
  const output = run(['--dry-run']);
  assert.match(output, /1件が削除対象/);
  assert.equal(seoDb.listGscQueriesForKeyword('守山区 塾').length, 1);
});

test('seo_gsc_reset.js --confirm無しではエラー終了し削除しない', () => {
  assert.throws(() => run([]));
  assert.equal(seoDb.listGscQueriesForKeyword('守山区 塾').length, 1);
});

test('seo_gsc_reset.js --confirm: seo_gsc_queriesのみ削除し、他のテーブルには触れない', () => {
  const nowIso = '2026-07-01T00:00:00.000Z';
  seoDb.upsertKeywordCandidate(
    { normalized_keyword: '守山区 塾', raw_keyword: '守山区 塾', gap_type: 'untapped', priority_score: 50, status: 'pending' },
    nowIso
  );
  closeDb();

  const output = run(['--confirm']);
  assert.match(output, /1件を削除しました/);
  assert.equal(seoDb.listGscQueriesForKeyword('守山区 塾').length, 0);
  assert.equal(seoDb.listKeywordCandidates({}).length, 1); // 他のSEOテーブルは無変更
});
