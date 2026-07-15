'use strict';

// Sprint 3.5: seo_page_plan_reviewsテーブル追加のマイグレーション安全性を検証する回帰テスト。
// 新規テーブルのためCREATE TABLE IF NOT EXISTSで追加される(seo_page_plans追加時と同じ方式)。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const FRESH_DB = path.join(os.tmpdir(), `juku_blog_page_plan_reviews_migration_fresh_${process.pid}.sqlite`);
const LEGACY_DB = path.join(os.tmpdir(), `juku_blog_page_plan_reviews_migration_legacy_${process.pid}.sqlite`);

function cleanup(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // 既に無ければ無視
  }
}

after(() => {
  cleanup(FRESH_DB);
  cleanup(LEGACY_DB);
});

test('新規DB初期化: seo_page_plan_reviewsが最初から存在し、想定カラム・インデックスを持つ', () => {
  process.env.JUKU_BLOG_DB_PATH = FRESH_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');

  const conn = getDb();
  const cols = conn.prepare('PRAGMA table_info(seo_page_plan_reviews)').all().map((c) => c.name);
  ['id', 'page_plan_id', 'from_status', 'to_status', 'actor', 'reason', 'source', 'metadata', 'created_at'].forEach((col) =>
    assert.ok(cols.includes(col), `カラムが無い: ${col}`)
  );

  const indexes = conn.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='seo_page_plan_reviews'").all().map((i) => i.name);
  assert.ok(indexes.includes('idx_seo_page_plan_reviews_plan_id'));
  closeDb();
});

test('旧DB(seo_page_plan_reviewsが無い既存DB): getDb()で安全に追加され、既存Page Plan/Task行は無変更', () => {
  const legacyDb = new DatabaseSync(LEGACY_DB);
  legacyDb.exec(`
    CREATE TABLE seo_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      target_url TEXT,
      target_page_type TEXT,
      target_page_id TEXT,
      target_page_name TEXT,
      target_keyword TEXT NOT NULL,
      source_candidate_id INTEGER,
      opportunity_score INTEGER NOT NULL,
      recommended_action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE seo_page_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_key TEXT NOT NULL,
      target_page_type TEXT NOT NULL,
      target_page_id TEXT NOT NULL,
      primary_task_id INTEGER NOT NULL,
      primary_keyword TEXT NOT NULL,
      supporting_task_ids TEXT NOT NULL DEFAULT '[]',
      supporting_keywords TEXT NOT NULL DEFAULT '[]',
      excluded_tasks TEXT NOT NULL DEFAULT '[]',
      combined_search_intents TEXT NOT NULL DEFAULT '[]',
      warnings TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (target_page_type, target_page_id),
      FOREIGN KEY (primary_task_id) REFERENCES seo_tasks(id)
    );
  `);
  const taskResult = legacyDb
    .prepare(
      `INSERT INTO seo_tasks (task_type, target_keyword, opportunity_score, recommended_action, status, created_at, updated_at)
       VALUES ('improve_school_page', '既存Task保護テスト', 70, 'improve_school_page', 'proposed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run();
  const taskId = Number(taskResult.lastInsertRowid);
  legacyDb
    .prepare(
      `INSERT INTO seo_page_plans (group_key, target_page_type, target_page_id, primary_task_id, primary_keyword, status, created_at, updated_at)
       VALUES ('school_page:legacy-test', 'school_page', 'legacy-test', :primary_task_id, '既存Plan保護テスト', 'proposed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run({ primary_task_id: taskId });
  legacyDb.close();

  process.env.JUKU_BLOG_DB_PATH = LEGACY_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');

  // 1回目: マイグレーション実行
  let conn = getDb();
  let tableNames = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  assert.ok(tableNames.includes('seo_page_plan_reviews'));

  let taskRows = conn.prepare('SELECT * FROM seo_tasks').all();
  assert.equal(taskRows.length, 1);
  assert.equal(taskRows[0].target_keyword, '既存Task保護テスト');

  let planRows = conn.prepare('SELECT * FROM seo_page_plans').all();
  assert.equal(planRows.length, 1);
  assert.equal(planRows[0].primary_keyword, '既存Plan保護テスト');

  let reviewRows = conn.prepare('SELECT * FROM seo_page_plan_reviews').all();
  assert.equal(reviewRows.length, 0); // 新規テーブルなので当然0件
  closeDb();

  // 2回目: 再初期化してもエラーにならず、既存行も変化しない
  assert.doesNotThrow(() => {
    conn = getDb();
  });
  taskRows = conn.prepare('SELECT * FROM seo_tasks').all();
  assert.equal(taskRows.length, 1);
  planRows = conn.prepare('SELECT * FROM seo_page_plans').all();
  assert.equal(planRows.length, 1);
  closeDb();

  // 3回目: さらに再初期化しても安定
  assert.doesNotThrow(() => {
    conn = getDb();
  });
  closeDb();
});

test('外部キー: page_plan_idが存在しないseo_page_plans.idの場合はDB自体が挿入を拒否する', () => {
  process.env.JUKU_BLOG_DB_PATH = FRESH_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');
  const conn = getDb();

  assert.throws(() => {
    conn
      .prepare(
        `INSERT INTO seo_page_plan_reviews (page_plan_id, from_status, to_status, actor, source, metadata, created_at)
         VALUES (999999, 'proposed', 'reviewing', 'admin', 'cli', '{}', '2026-01-01T00:00:00Z')`
      )
      .run();
  }, /FOREIGN KEY constraint failed/);
  closeDb();
});
