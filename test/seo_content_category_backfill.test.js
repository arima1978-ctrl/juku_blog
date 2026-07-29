'use strict';

// content_category遡及分類バックフィル(2026-07-29)のテスト。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_category_backfill_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { closeDb, getDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const branchesDb = require('../scripts/lib/branches_db');
const { backfillTable } = require('../scripts/seo_content_category_backfill');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-29T00:00:00.000Z';

test('backfillTable: 既存行のcontent_categoryを分類し、--saveでのみ保存する', () => {
  const branch = branchesDb.createBranch({ name: 'バックフィルテスト校', slug: '__test_backfill_branch__' });
  seoDb.upsertKeywordCandidate(
    { normalized_keyword: 'そろばん 効果', gap_type: 'untapped', priority_score: 10, branch_id: branch.id },
    nowIso
  );

  const conn = getDb();
  // upsertKeywordCandidateは既に自動分類するため、テスト用にあえてnullへ書き戻して未分類状態を再現する
  conn.prepare("UPDATE seo_keyword_candidates SET content_category = NULL WHERE normalized_keyword = 'そろばん 効果'").run();

  const dryRunResult = backfillTable(conn, 'seo_keyword_candidates', 'normalized_keyword', { save: false });
  assert.ok(dryRunResult.changed >= 1);
  const stillNull = conn.prepare("SELECT content_category FROM seo_keyword_candidates WHERE normalized_keyword = 'そろばん 効果'").get();
  assert.equal(stillNull.content_category, null);

  const saveResult = backfillTable(conn, 'seo_keyword_candidates', 'normalized_keyword', { save: true });
  assert.ok(saveResult.changed >= 1);
  const updated = conn.prepare("SELECT content_category FROM seo_keyword_candidates WHERE normalized_keyword = 'そろばん 効果'").get();
  assert.equal(updated.content_category, 'naraigoto');
});

test('backfillTable: 既に正しく分類済みの行は変更対象に数えない(冪等)', () => {
  const conn = getDb();
  const first = backfillTable(conn, 'seo_keyword_candidates', 'normalized_keyword', { save: true });
  const second = backfillTable(conn, 'seo_keyword_candidates', 'normalized_keyword', { save: true });
  assert.equal(second.changed, 0, `1回目で全て分類済みのはずが2回目でも${second.changed}件変化した`);
  assert.ok(first.total === second.total);
});
