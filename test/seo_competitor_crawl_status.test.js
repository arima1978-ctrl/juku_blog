'use strict';

// 競合クロールの成功/失敗記録(2026-07-29)のテスト。必ず一時SQLite(JUKU_BLOG_DB_PATH)を使う。
// 実インシデント回帰確認: 2026-07-17のクロールエラーが、2026-07-25時点の複数回成功後も
// ダッシュボードに「⚠️エラーあり」として表示され続けていた不具合の修正確認。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_competitor_crawl_status_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
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

const nowIso = '2026-07-29T00:00:00.000Z';

test('recordCompetitorCrawlSuccess: 過去にエラーがあっても、成功記録でlast_error_at/last_error_messageをクリアする', () => {
  seoDb.upsertCompetitor({ id: 'test-morikobe', name: '守山個別塾 モリコベ！', domain: 'www.morikobe.com', branch_id: 1 }, nowIso);

  seoDb.recordCompetitorCrawlError('test-morikobe', '2026-07-17T01:04:44.309Z', 'no such table: main.seo_competitors_pre_branch_id');
  let competitor = seoDb.getCompetitor('test-morikobe');
  assert.equal(competitor.last_error_message, 'no such table: main.seo_competitors_pre_branch_id');

  // 8日後、複数回成功した想定(2026-07-25)
  seoDb.recordCompetitorCrawlSuccess('test-morikobe', '2026-07-25T16:14:56.254Z');
  competitor = seoDb.getCompetitor('test-morikobe');
  assert.equal(competitor.last_error_at, null);
  assert.equal(competitor.last_error_message, null);
  assert.equal(competitor.last_success_at, '2026-07-25T16:14:56.254Z');
  assert.equal(competitor.last_crawled_at, '2026-07-25T16:14:56.254Z');
});

test('recordCompetitorCrawlError: エラー記録時はlast_error_at/last_error_messageを設定する', () => {
  seoDb.upsertCompetitor({ id: 'test-plabo', name: '個別指導塾PLABO', domain: 'pbstudy.jp', branch_id: 1 }, nowIso);
  seoDb.recordCompetitorCrawlError('test-plabo', '2026-07-17T01:04:25.535Z', 'no such table: main.seo_competitors_pre_branch_id');
  const competitor = seoDb.getCompetitor('test-plabo');
  assert.equal(competitor.last_error_at, '2026-07-17T01:04:25.535Z');
  assert.equal(competitor.last_error_message, 'no such table: main.seo_competitors_pre_branch_id');
});
