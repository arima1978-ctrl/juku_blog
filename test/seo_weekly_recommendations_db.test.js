'use strict';

// Sprint 3.9: seo_weekly_recommendationsテーブルのマイグレーション安全性、および
// upsertWeeklyRecommendation()/getWeeklyRecommendation()の保存・読み出し・
// UNIQUE(batch_date)競合ガードを検証する回帰テスト。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。
//
// 移行系テスト(新規DB/旧DB/UNIQUE制約)はrequire.cacheを都度差し替えて別ファイルの
// DBを切り替えるため、後続のCRUD系テストと同じファイル内で行うとキャッシュが
// 競合しうる。そのためCRUD系テストは専用のtest()内で毎回db.js/seo_db.jsを
// re-requireし、生SQLでの直接操作にも同じ接続を使い回すことで整合性を保つ。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const FRESH_DB = path.join(os.tmpdir(), `juku_blog_weekly_reco_migration_fresh_${process.pid}.sqlite`);
const LEGACY_DB = path.join(os.tmpdir(), `juku_blog_weekly_reco_migration_legacy_${process.pid}.sqlite`);
const CRUD_DB = path.join(os.tmpdir(), `juku_blog_weekly_reco_crud_${process.pid}.sqlite`);

const EXPECTED_COLUMNS = [
  'id', 'batch_date', 'status', 'task_ids', 'items', 'total_expected_cv',
  'total_effort_minutes', 'task_type_breakdown', 'curation_tier', 'curation_params',
  'created_at', 'updated_at',
];

function cleanup(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // 既に無ければ無視
  }
}

after(() => {
  [FRESH_DB, LEGACY_DB, CRUD_DB].forEach(cleanup);
});

function freshDbModules(dbPath) {
  process.env.JUKU_BLOG_DB_PATH = dbPath;
  delete require.cache[require.resolve('../scripts/lib/db')];
  delete require.cache[require.resolve('../scripts/lib/seo_db')];
  return {
    dbModule: require('../scripts/lib/db'),
    seoDb: require('../scripts/lib/seo_db'),
  };
}

test('新規DB初期化: seo_weekly_recommendationsが最初から存在し、想定カラムを持つ', () => {
  const { dbModule } = freshDbModules(FRESH_DB);
  const conn = dbModule.getDb();
  const cols = conn.prepare('PRAGMA table_info(seo_weekly_recommendations)').all().map((c) => c.name);
  EXPECTED_COLUMNS.forEach((col) => assert.ok(cols.includes(col), `カラムが無い: ${col}`));

  const indexes = conn.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='seo_weekly_recommendations'").all().map((i) => i.name);
  assert.ok(indexes.includes('idx_seo_weekly_recommendations_batch_date'));
  dbModule.closeDb();
});

test('旧DB(seo_weekly_recommendationsが無い既存DB): getDb()で安全に追加され、既存Task行は無変更', () => {
  const legacyDb = new DatabaseSync(LEGACY_DB);
  legacyDb.exec(`
    CREATE TABLE seo_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      target_keyword TEXT NOT NULL,
      opportunity_score INTEGER NOT NULL,
      recommended_action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacyDb
    .prepare(
      `INSERT INTO seo_tasks (task_type, target_keyword, opportunity_score, recommended_action, status, created_at, updated_at)
       VALUES ('create_article', '既存Task保護テスト', 42, 'create_article', 'proposed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run();
  legacyDb.close();

  const { dbModule } = freshDbModules(LEGACY_DB);
  let conn = dbModule.getDb();
  let tableNames = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  assert.ok(tableNames.includes('seo_weekly_recommendations'));

  let taskRows = conn.prepare('SELECT * FROM seo_tasks').all();
  assert.equal(taskRows.length, 1);
  assert.equal(taskRows[0].target_keyword, '既存Task保護テスト');

  let recRows = conn.prepare('SELECT * FROM seo_weekly_recommendations').all();
  assert.equal(recRows.length, 0); // 新規テーブルなので当然0件
  dbModule.closeDb();

  // 複数回初期化してもエラーにならず安定している
  assert.doesNotThrow(() => {
    conn = dbModule.getDb();
  });
  taskRows = conn.prepare('SELECT * FROM seo_tasks').all();
  assert.equal(taskRows.length, 1);
  dbModule.closeDb();
});

test('UNIQUE制約: 同一batch_dateの2件目INSERTはDBレベルでエラーになる', () => {
  const { dbModule } = freshDbModules(FRESH_DB);
  const conn = dbModule.getDb();

  // UNIQUE制約はbranch_id込みの複合キーのため、NULL同士は「同じ値」と扱われず
  // 検証にならない(NULL != NULL)。実在するbranch_idを明示指定する。
  const branchId = conn.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get().id;

  const insert = () =>
    conn
      .prepare(
        `INSERT INTO seo_weekly_recommendations (branch_id, batch_date, status, task_ids, items, created_at, updated_at)
         VALUES (:branch_id, '2026-07-13', 'proposed', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run({ branch_id: branchId });

  insert();
  assert.throws(() => insert());
  dbModule.closeDb();
});

// --- upsertWeeklyRecommendation()/getWeeklyRecommendation() ---
// 移行系テストのrequire.cache操作と混線しないよう、CRUD区画専用に
// db.js/seo_db.jsを再requireしてから実行する。

const nowIso = '2026-07-13T09:00:00.000Z';

function sampleRec(overrides = {}) {
  return {
    batchDate: '2026-07-13',
    taskIds: [61, 64, 55],
    items: [{ taskId: 61, taskType: 'improve_school_page', draftStatus: 'prompt_generated' }],
    totalExpectedCv: 2.5,
    totalEffortMinutes: 45,
    taskTypeBreakdown: { improve_school_page: 1, create_article: 2 },
    curationTier: 'strict',
    curationParams: { effortBudgetMinutes: 60, maxPerTaskType: 2 },
    ...overrides,
  };
}

test('upsertWeeklyRecommendation: 新規保存・getWeeklyRecommendationで読み出せる', () => {
  const { seoDb } = freshDbModules(CRUD_DB);
  const result = seoDb.upsertWeeklyRecommendation(sampleRec(), nowIso);
  assert.equal(result.isNew, true);
  assert.equal(result.locked, false);

  const saved = seoDb.getWeeklyRecommendation('2026-07-13');
  assert.equal(saved.batch_date, '2026-07-13');
  assert.equal(saved.status, 'proposed');
  assert.deepEqual(saved.task_ids, [61, 64, 55]);
  assert.deepEqual(saved.items, [{ taskId: 61, taskType: 'improve_school_page', draftStatus: 'prompt_generated' }]);
  assert.equal(saved.total_expected_cv, 2.5);
  assert.equal(saved.total_effort_minutes, 45);
  assert.deepEqual(saved.task_type_breakdown, { improve_school_page: 1, create_article: 2 });
  assert.equal(saved.curation_tier, 'strict');
  assert.deepEqual(saved.curation_params, { effortBudgetMinutes: 60, maxPerTaskType: 2 });
});

test('getWeeklyRecommendation: 存在しないbatch_dateはnullを返す', () => {
  const { seoDb } = freshDbModules(CRUD_DB);
  const result = seoDb.getWeeklyRecommendation('2099-01-01');
  assert.equal(result, null);
});

test('upsertWeeklyRecommendation: 同一batch_date(status=proposedのまま)を再実行すると上書きされる(新規行は増えない)', () => {
  const { seoDb } = freshDbModules(CRUD_DB);
  seoDb.upsertWeeklyRecommendation(sampleRec({ batchDate: '2026-07-20', totalExpectedCv: 1.0 }), nowIso);
  const laterIso = '2026-07-20T10:00:00.000Z';
  const result = seoDb.upsertWeeklyRecommendation(sampleRec({ batchDate: '2026-07-20', totalExpectedCv: 3.0 }), laterIso);

  assert.equal(result.isNew, false);
  assert.equal(result.locked, false);

  const saved = seoDb.getWeeklyRecommendation('2026-07-20');
  assert.equal(saved.total_expected_cv, 3.0); // 更新後の値
  assert.equal(saved.updated_at, laterIso);
});

test('UNIQUE競合ガード: statusがapprovedの週次バンドルは上書きされずlocked=trueが返る', () => {
  const { dbModule, seoDb } = freshDbModules(CRUD_DB);
  seoDb.upsertWeeklyRecommendation(sampleRec({ batchDate: '2026-07-27' }), nowIso);

  // approvedへ直接更新(Sprint 3.9時点ではレビューCLIが無いため、テスト内でSQL直接更新)。
  // dbModule.getDb()はseoDbが内部で使うのと同じ接続(モジュールキャッシュ経由)。
  const conn = dbModule.getDb();
  conn.prepare("UPDATE seo_weekly_recommendations SET status = 'approved' WHERE batch_date = ?").run('2026-07-27');

  const before = seoDb.getWeeklyRecommendation('2026-07-27');
  assert.equal(before.status, 'approved');

  const result = seoDb.upsertWeeklyRecommendation(sampleRec({ batchDate: '2026-07-27', totalExpectedCv: 999 }), '2026-07-27T12:00:00.000Z');

  assert.equal(result.locked, true);
  assert.equal(result.lockedStatus, 'approved');

  const afterRec = seoDb.getWeeklyRecommendation('2026-07-27');
  assert.equal(afterRec.total_expected_cv, before.total_expected_cv); // 変更されていない
  assert.equal(afterRec.updated_at, before.updated_at); // 変更されていない
});

test('UNIQUE競合ガード: statusがarchivedの週次バンドルも上書きされない', () => {
  const { dbModule, seoDb } = freshDbModules(CRUD_DB);
  seoDb.upsertWeeklyRecommendation(sampleRec({ batchDate: '2026-08-03' }), nowIso);
  const conn = dbModule.getDb();
  conn.prepare("UPDATE seo_weekly_recommendations SET status = 'archived' WHERE batch_date = ?").run('2026-08-03');

  const result = seoDb.upsertWeeklyRecommendation(sampleRec({ batchDate: '2026-08-03' }), '2026-08-03T12:00:00.000Z');
  assert.equal(result.locked, true);
  assert.equal(result.lockedStatus, 'archived');
});

test('upsertWeeklyRecommendation: 異なるbatch_dateは複数行として共存できる', () => {
  const { seoDb } = freshDbModules(CRUD_DB);
  seoDb.upsertWeeklyRecommendation(sampleRec({ batchDate: '2026-09-07' }), nowIso);
  seoDb.upsertWeeklyRecommendation(sampleRec({ batchDate: '2026-09-14' }), nowIso);

  assert.ok(seoDb.getWeeklyRecommendation('2026-09-07'));
  assert.ok(seoDb.getWeeklyRecommendation('2026-09-14'));
});

test('保存してもseo_tasksには一切影響しない(回帰確認)', () => {
  const { seoDb } = freshDbModules(CRUD_DB);
  const before = seoDb.listTasks({});
  seoDb.upsertWeeklyRecommendation(sampleRec({ batchDate: '2026-10-05' }), nowIso);
  const after = seoDb.listTasks({});
  assert.deepEqual(after, before);
});
