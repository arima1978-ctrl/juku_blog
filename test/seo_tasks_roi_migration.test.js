'use strict';

// Sprint 3.8: seo_tasksへのdifficulty_score/difficulty_breakdown/expected_impact_clicks/
// expected_impact_cv/roi_priority_score/roi_score_computed_at追加のマイグレーション
// 安全性を検証する回帰テスト。
// - 新規DB初期化ではensureColumnで最初から追加される
// - 旧スキーマ(これらの列が無い)の既存DBに対してもensureColumnで安全に追加される
// - 複数回の初期化でもエラーにならず、既存行は削除・上書きされない

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const FRESH_DB = path.join(os.tmpdir(), `juku_blog_roi_migration_fresh_${process.pid}.sqlite`);
const LEGACY_DB = path.join(os.tmpdir(), `juku_blog_roi_migration_legacy_${process.pid}.sqlite`);

const NEW_COLUMNS = [
  'difficulty_score',
  'difficulty_breakdown',
  'expected_impact_clicks',
  'expected_impact_cv',
  'roi_priority_score',
  'roi_score_computed_at',
];

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

test('新規DB初期化: seo_tasksに6カラムが最初から存在する', () => {
  process.env.JUKU_BLOG_DB_PATH = FRESH_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');

  const conn = getDb();
  const cols = conn.prepare('PRAGMA table_info(seo_tasks)').all().map((c) => c.name);
  NEW_COLUMNS.forEach((col) => assert.ok(cols.includes(col), `カラムが無い: ${col}`));
  closeDb();
});

test('旧スキーマ(6カラム無し)の既存DB: ensureColumnで安全に追加され、既存行は保持・無変更のまま', () => {
  // Sprint 3.7時点相当のseo_tasks(ROI関連6列が無い)を手動で作り、既存行を1件入れておく
  const legacyDb = new DatabaseSync(LEGACY_DB);
  legacyDb.exec(`
    CREATE TABLE seo_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      target_url TEXT,
      target_post_id INTEGER,
      target_page_type TEXT,
      target_page_id TEXT,
      target_page_name TEXT,
      target_keyword TEXT NOT NULL,
      source_candidate_id INTEGER,
      priority_score INTEGER,
      opportunity_score INTEGER NOT NULL,
      opportunity_breakdown TEXT,
      estimated_effort_minutes INTEGER,
      recommended_action TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacyDb
    .prepare(
      `INSERT INTO seo_tasks (task_type, target_keyword, opportunity_score, recommended_action, status, created_at, updated_at)
       VALUES ('create_article', 'ROI移行前データ保護テスト', 42, 'create_article', 'proposed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run();
  legacyDb.close();

  process.env.JUKU_BLOG_DB_PATH = LEGACY_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');

  // 1回目: マイグレーション実行
  let conn = getDb();
  let cols = conn.prepare('PRAGMA table_info(seo_tasks)').all().map((c) => c.name);
  NEW_COLUMNS.forEach((col) => assert.ok(cols.includes(col), `カラムが無い: ${col}`));

  let rows = conn.prepare('SELECT * FROM seo_tasks').all();
  assert.equal(rows.length, 1); // 既存行が削除されていない
  assert.equal(rows[0].target_keyword, 'ROI移行前データ保護テスト'); // 既存データが保持されている
  assert.equal(rows[0].opportunity_score, 42); // 既存のopportunity_scoreは無変更
  NEW_COLUMNS.forEach((col) => assert.equal(rows[0][col], null, `新規列は既存行に対してNULLのはず: ${col}`));
  closeDb();

  // 2回目: 再初期化してもエラーにならず(ALTER TABLEの重複実行にならない)、行も変化しない
  assert.doesNotThrow(() => {
    conn = getDb();
  });
  rows = conn.prepare('SELECT * FROM seo_tasks').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target_keyword, 'ROI移行前データ保護テスト');
  closeDb();

  // 3回目: さらに再初期化しても安定
  assert.doesNotThrow(() => {
    conn = getDb();
  });
  closeDb();
});
