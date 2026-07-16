'use strict';

// 複数校舎管理(完全マルチテナント化)のマイグレーションテスト。
// 新規DB(branch_idが最初から入る)・既存DB(branch_idが無い状態からの移行)の両方を検証し、
// 既存データが壊れず、現在アクティブな校舎のIDへ正しくbranch_idがバックフィルされることを確認する。

const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const TMP_FRESH_DB = path.join(os.tmpdir(), `juku_blog_branch_migration_fresh_${process.pid}.sqlite`);
const TMP_LEGACY_DB = path.join(os.tmpdir(), `juku_blog_branch_migration_legacy_${process.pid}.sqlite`);

after(() => {
  [TMP_FRESH_DB, TMP_LEGACY_DB].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

// db.js/branches_db.jsはJUKU_BLOG_DB_PATH切り替え+require.cache操作が必要
// (Sprint 4.0以降のテストで確立した既知のパターン)。
function freshDbModules(dbPath) {
  process.env.JUKU_BLOG_DB_PATH = dbPath;
  delete require.cache[require.resolve('../scripts/lib/db')];
  return require('../scripts/lib/db');
}

const BRANCH_ID_TABLES = [
  'posts',
  'seo_competitors',
  'seo_keyword_candidates',
  'seo_tasks',
  'seo_page_plans',
  'seo_weekly_recommendations',
  'seo_compound_keywords',
  'seo_topics',
];

test('新規DB: 全対象テーブルにbranch_id列が最初から存在する', () => {
  const dbModule = freshDbModules(TMP_FRESH_DB);
  const conn = dbModule.getDb();

  BRANCH_ID_TABLES.forEach((table) => {
    const cols = conn.prepare(`PRAGMA table_info(${table})`).all();
    assert.ok(cols.some((c) => c.name === 'branch_id'), `${table}にbranch_id列が存在するべき`);
  });

  dbModule.closeDb();
});

test('新規DB: branchesテーブルにconfig由来の初期校舎が1件自動作成される', () => {
  const dbModule = freshDbModules(TMP_FRESH_DB);
  const conn = dbModule.getDb();
  const branches = conn.prepare('SELECT * FROM branches').all();
  assert.equal(branches.length, 1);
  assert.equal(branches[0].is_active, 1);
  dbModule.closeDb();
});

test('新規DB: getDb()を複数回呼んでも移行処理は冪等(再実行してもエラーにならず、データも変化しない)', () => {
  const dbModule = freshDbModules(TMP_FRESH_DB);
  const conn1 = dbModule.getDb();
  const before = conn1.prepare('SELECT COUNT(*) c FROM branches').get().c;

  // 同一プロセス内でgetDb()はキャッシュされ2回目以降は同じ接続を返すため、
  // ここでは明示的にキャッシュを外して「再度スキーマ初期化から走らせた場合」を再現する。
  dbModule.closeDb();
  delete require.cache[require.resolve('../scripts/lib/db')];
  const dbModule2 = require('../scripts/lib/db');
  const conn2 = dbModule2.getDb();
  const after1 = conn2.prepare('SELECT COUNT(*) c FROM branches').get().c;

  assert.equal(after1, before, '再初期化してもbranchesが重複作成されない');
  dbModule2.closeDb();
});

test('既存DB(branch_id無し): 移行後も既存データが保持され、現在アクティブな校舎IDへ正しくbranch_idがバックフィルされる', () => {
  // Sprint 4.1時点の旧スキーマ相当(branch_id無し)を手動構築し、実データに近い行を投入する。
  const legacyDb = new DatabaseSync(TMP_LEGACY_DB);
  legacyDb.exec(`
    CREATE TABLE seo_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      target_url TEXT,
      target_post_id INTEGER,
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
      updated_at TEXT NOT NULL,
      UNIQUE (target_keyword, task_type, source_candidate_id)
    );
    CREATE TABLE branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_area TEXT,
      wordpress_author_id INTEGER,
      wordpress_author_display_name TEXT,
      wordpress_api_token TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacyDb
    .prepare("INSERT INTO branches (name, is_active, created_at, updated_at) VALUES ('小幡校(既存)', 1, '2026-01-01', '2026-01-01')")
    .run();
  legacyDb
    .prepare(
      `INSERT INTO seo_tasks (task_type, target_keyword, opportunity_score, recommended_action, status, created_at, updated_at)
       VALUES ('create_article', '守山区 塾', 70, 'create_article', 'proposed', '2026-01-01', '2026-01-01')`
    )
    .run();
  legacyDb.close();

  const dbModule = freshDbModules(TMP_LEGACY_DB);
  const conn = dbModule.getDb();

  const tasks = conn.prepare('SELECT * FROM seo_tasks').all();
  assert.equal(tasks.length, 1, '既存の行が失われていないこと');
  assert.equal(tasks[0].target_keyword, '守山区 塾');
  assert.equal(tasks[0].opportunity_score, 70);
  assert.equal(tasks[0].branch_id, 1, '既存の唯一のアクティブ校舎IDへバックフィルされること');

  const branches = conn.prepare('SELECT * FROM branches').all();
  assert.equal(branches.length, 1, '移行処理でbranchesが重複作成されないこと');
  assert.equal(branches[0].name, '小幡校(既存)');

  dbModule.closeDb();
});

test('既存DB(postsにbranch_id無し): 既存記事が失われず、現在アクティブな校舎IDへ正しくbranch_idがバックフィルされる', () => {
  // 2026-07-16の本番障害の再現・回帰防止テスト。postsはUNIQUE制約の再構築が不要なため
  // ensureColumn(ADD COLUMN)のみで済ませていたが、それだと新規追加された列はNULLのまま
  // 残ってしまい、既存記事のbranch_idがバックフィルされない不具合があった
  // (seo_tasks等7テーブルはensureBranchIdRebuild経由で正しく自動バックフィルされるため、
  // このテストが無いとpostsだけの回帰に気付けなかった)。
  const TMP_LEGACY_POSTS_DB = path.join(os.tmpdir(), `juku_blog_branch_migration_legacy_posts_${process.pid}.sqlite`);
  const legacyDb = new DatabaseSync(TMP_LEGACY_POSTS_DB);
  legacyDb.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      target_audience TEXT,
      keywords TEXT,
      meta_description TEXT,
      body_md TEXT NOT NULL,
      body_html TEXT NOT NULL,
      fact_check_report TEXT,
      status TEXT NOT NULL DEFAULT 'review_pending',
      reviewer_note TEXT,
      published_at TEXT,
      wp_post_id TEXT,
      wp_link TEXT
    );
    CREATE TABLE branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_area TEXT,
      wordpress_author_id INTEGER,
      wordpress_author_display_name TEXT,
      wordpress_api_token TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacyDb
    .prepare("INSERT INTO branches (name, is_active, created_at, updated_at) VALUES ('アンイングリッシュグループ 小幡校', 1, '2026-01-01', '2026-01-01')")
    .run();
  legacyDb
    .prepare("INSERT INTO branches (name, is_active, created_at, updated_at) VALUES ('あま本部', 0, '2026-01-01', '2026-01-01')")
    .run();
  for (let i = 1; i <= 3; i += 1) {
    legacyDb
      .prepare(
        `INSERT INTO posts (created_at, title, slug, category, body_md, body_html, status)
         VALUES (?, ?, ?, '地域情報', '本文', '<p>本文</p>', 'published')`
      )
      .run(`2026-0${i}-01T00:00:00Z`, `既存記事${i}`, `existing-post-${i}`);
  }
  legacyDb.close();

  const dbModule = freshDbModules(TMP_LEGACY_POSTS_DB);
  const conn = dbModule.getDb();

  const posts = conn.prepare('SELECT * FROM posts ORDER BY id').all();
  assert.equal(posts.length, 3, '既存の記事が失われていないこと');
  posts.forEach((p, i) => {
    assert.equal(p.title, `既存記事${i + 1}`);
    assert.equal(p.branch_id, 1, '既存の全記事がアクティブ校舎(小幡校)IDへバックフィルされること(NULLのまま残らない)');
  });

  dbModule.closeDb();
  fs.unlinkSync(TMP_LEGACY_POSTS_DB);
});

test('既存DB: 移行後にUNIQUE制約がbranch_id込みで機能する(別branch_idなら同じキーワード+タイプでも登録できる)', () => {
  const dbModule = freshDbModules(TMP_LEGACY_DB);
  const conn = dbModule.getDb();
  const nowIso = '2026-07-16T00:00:00.000Z';

  // 別の校舎を追加
  const branch2 = conn
    .prepare(
      "INSERT INTO branches (name, is_active, created_at, updated_at) VALUES ('あま本部', 0, :ts, :ts)"
    )
    .run({ ts: nowIso });
  const branch2Id = Number(branch2.lastInsertRowid);

  // branch_id=1の既存行と同じtarget_keyword/task_type/source_candidate_id(NULL)だが、
  // branch_idが異なるため正常に挿入できるはず。
  assert.doesNotThrow(() => {
    conn
      .prepare(
        `INSERT INTO seo_tasks (branch_id, task_type, target_keyword, opportunity_score, recommended_action, status, created_at, updated_at)
         VALUES (:branch_id, 'create_article', '守山区 塾', 60, 'create_article', 'proposed', :ts, :ts)`
      )
      .run({ branch_id: branch2Id, ts: nowIso });
  });

  const rows = conn.prepare("SELECT * FROM seo_tasks WHERE target_keyword = '守山区 塾'").all();
  assert.equal(rows.length, 2, '同じキーワードでも校舎が異なれば2行存在できる');

  // 同一branch_id内での重複は引き続き拒否される(NULLはUNIQUE制約上「同じ値」とは
  // 扱われないため、source_candidate_idは非NULLの値で検証する。node:sqliteは
  // foreign_keys=ONが既定のため、参照先のseo_keyword_candidatesも実在させる)。
  const candidate = conn
    .prepare(
      `INSERT INTO seo_keyword_candidates (normalized_keyword, gap_type, priority_score, status, created_at, updated_at)
       VALUES ('瓢箪山 塾', 'weak', 60, 'discovered', :ts, :ts)`
    )
    .run({ ts: nowIso });
  const candidateId = Number(candidate.lastInsertRowid);

  conn
    .prepare(
      `INSERT INTO seo_tasks (branch_id, task_type, target_keyword, source_candidate_id, opportunity_score, recommended_action, status, created_at, updated_at)
       VALUES (1, 'create_article', '瓢箪山 塾', :candidate_id, 60, 'create_article', 'proposed', :ts, :ts)`
    )
    .run({ candidate_id: candidateId, ts: nowIso });

  assert.throws(() => {
    conn
      .prepare(
        `INSERT INTO seo_tasks (branch_id, task_type, target_keyword, source_candidate_id, opportunity_score, recommended_action, status, created_at, updated_at)
         VALUES (1, 'create_article', '瓢箪山 塾', :candidate_id, 99, 'create_article', 'proposed', :ts, :ts)`
      )
      .run({ candidate_id: candidateId, ts: nowIso });
  }, /UNIQUE constraint failed/);

  dbModule.closeDb();
});
