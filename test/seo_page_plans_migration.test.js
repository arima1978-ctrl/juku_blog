'use strict';

// Sprint 3.4: seo_page_plansテーブル追加のマイグレーション安全性を検証する回帰テスト。
// 新規テーブルのため、既存のensureColumn(ALTER TABLE)パターンではなく
// schema.sqlのCREATE TABLE IF NOT EXISTSで追加される(db.jsのgetDb()が毎回db.exec(schema)を
// 実行するため、既存DBに対しても安全に不足テーブルだけを追加できる)。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const FRESH_DB = path.join(os.tmpdir(), `juku_blog_page_plans_migration_fresh_${process.pid}.sqlite`);
const LEGACY_DB = path.join(os.tmpdir(), `juku_blog_page_plans_migration_legacy_${process.pid}.sqlite`);

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

test('新規DB初期化: seo_page_plansが最初から存在し、想定カラムを持つ', () => {
  process.env.JUKU_BLOG_DB_PATH = FRESH_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');

  const conn = getDb();
  const cols = conn.prepare('PRAGMA table_info(seo_page_plans)').all().map((c) => c.name);
  [
    'id', 'group_key', 'target_page_type', 'target_page_id', 'target_page_name', 'target_url',
    'primary_task_id', 'primary_keyword', 'supporting_task_ids', 'supporting_keywords',
    'excluded_tasks', 'combined_search_intents', 'selection_breakdown', 'fact_check_summary',
    'warnings', 'source_content_hash', 'prompt_version', 'status', 'created_at', 'updated_at',
  ].forEach((col) => assert.ok(cols.includes(col), `カラムが無い: ${col}`));
  closeDb();
});

test('旧DB(seo_page_plansが無い既存DB): getDb()で安全に追加され、既存テーブル・行は無変更', () => {
  // Sprint 3.3時点相当(seo_page_plansテーブルが無い)を手動で作り、既存データを入れておく。
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
    CREATE TABLE seo_keyword_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_keyword TEXT NOT NULL,
      gap_type TEXT,
      priority_score INTEGER,
      status TEXT NOT NULL DEFAULT 'discovered',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacyDb
    .prepare(
      `INSERT INTO seo_tasks (task_type, target_keyword, opportunity_score, recommended_action, status, created_at, updated_at)
       VALUES ('improve_school_page', '既存データ保護テスト', 74, 'improve_school_page', 'proposed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run();
  legacyDb
    .prepare(
      `INSERT INTO seo_keyword_candidates (normalized_keyword, gap_type, priority_score, status, created_at, updated_at)
       VALUES ('既存候補保護テスト', 'weak', 70, 'discovered', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run();
  legacyDb.close();

  process.env.JUKU_BLOG_DB_PATH = LEGACY_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');

  // 1回目: マイグレーション実行(不足テーブルのみ追加される)
  let conn = getDb();
  let tableNames = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  assert.ok(tableNames.includes('seo_page_plans'));

  let taskRows = conn.prepare('SELECT * FROM seo_tasks').all();
  assert.equal(taskRows.length, 1);
  assert.equal(taskRows[0].target_keyword, '既存データ保護テスト');
  assert.equal(taskRows[0].opportunity_score, 74);

  let candidateRows = conn.prepare('SELECT * FROM seo_keyword_candidates').all();
  assert.equal(candidateRows.length, 1);
  assert.equal(candidateRows[0].normalized_keyword, '既存候補保護テスト');

  let planRows = conn.prepare('SELECT * FROM seo_page_plans').all();
  assert.equal(planRows.length, 0); // 新規テーブルなので当然0件
  closeDb();

  // 2回目: 再初期化してもエラーにならず(CREATE TABLE IF NOT EXISTSの重複実行)、既存行も変化しない
  assert.doesNotThrow(() => {
    conn = getDb();
  });
  taskRows = conn.prepare('SELECT * FROM seo_tasks').all();
  assert.equal(taskRows.length, 1);
  assert.equal(taskRows[0].target_keyword, '既存データ保護テスト');
  candidateRows = conn.prepare('SELECT * FROM seo_keyword_candidates').all();
  assert.equal(candidateRows.length, 1);
  closeDb();

  // 3回目: さらに再初期化しても安定
  assert.doesNotThrow(() => {
    conn = getDb();
  });
  closeDb();
});

test('UNIQUE制約: 同一(target_page_type, target_page_id)は2件目挿入時にエラーになる', () => {
  process.env.JUKU_BLOG_DB_PATH = FRESH_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');
  const conn = getDb();

  const taskResult = conn
    .prepare(
      `INSERT INTO seo_tasks (task_type, target_keyword, opportunity_score, recommended_action, status, created_at, updated_at)
       VALUES ('improve_school_page', 'UNIQUE制約テスト', 70, 'improve_school_page', 'proposed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run();
  const taskId = Number(taskResult.lastInsertRowid);
  // UNIQUE制約はbranch_id込みの複合キーのため、NULL同士は「同じ値」と扱われず
  // 検証にならない(NULL != NULL)。実在するbranch_idを明示指定する。
  const branchId = conn.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get().id;

  const insertPlan = () =>
    conn
      .prepare(
        `INSERT INTO seo_page_plans (
          branch_id, group_key, target_page_type, target_page_id, primary_task_id, primary_keyword,
          supporting_task_ids, supporting_keywords, excluded_tasks, combined_search_intents,
          warnings, status, created_at, updated_at
        ) VALUES (
          :branch_id, 'school_page:unique-test', 'school_page', 'unique-test', :primary_task_id, 'テスト',
          '[]', '[]', '[]', '[]', '[]', 'proposed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )`
      )
      .run({ branch_id: branchId, primary_task_id: taskId });

  insertPlan();
  assert.throws(() => insertPlan());
  closeDb();
});

test('外部キー: primary_task_idが存在しないseo_tasks.idの場合はDB自体が挿入を拒否する(FOREIGN KEY制約が有効)', () => {
  // node:sqlite(DatabaseSync)は外部キー制約を有効な状態で開くため、
  // 存在しないprimary_task_idはDBレベルでFOREIGN KEY constraint failedとして拒否される。
  // アプリ層(seo_db.js upsertSeoPagePlan)の事前存在チェックは、より分かりやすいエラー
  // メッセージを返すための追加の防御であり、DB制約自体もそれとは独立して機能する。
  process.env.JUKU_BLOG_DB_PATH = FRESH_DB;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const { getDb, closeDb } = require('../scripts/lib/db');
  const conn = getDb();

  assert.throws(() => {
    conn
      .prepare(
        `INSERT INTO seo_page_plans (
          group_key, target_page_type, target_page_id, primary_task_id, primary_keyword,
          supporting_task_ids, supporting_keywords, excluded_tasks, combined_search_intents,
          warnings, status, created_at, updated_at
        ) VALUES (
          'school_page:fk-test', 'school_page', 'fk-test', 999999, 'テスト',
          '[]', '[]', '[]', '[]', '[]', 'proposed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )`
      )
      .run();
  }, /FOREIGN KEY constraint failed/);
  closeDb();
});
