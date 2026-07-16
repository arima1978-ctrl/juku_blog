'use strict';

// 2026-07-16の本番データ逆転インシデントの修復スクリプト(scripts/fix_swap_branch_ids.js)の
// テスト。誤ってbranch_id=2に紐づいた既存データをbranch_id=1へ一方向に統合しつつ、
// branch_id=1に既に存在する正しいデータ(移行後に生成された新しい記事等)には
// 一切触れないこと(=単純な双方向スワップではないこと)を検証する。

const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { moveBranchData, BRANCH_ID_TABLES } = require('../scripts/fix_swap_branch_ids');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_fix_swap_branch_ids_${process.pid}.sqlite`);

after(() => {
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
});

function buildReversedProdLikeDb() {
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
  const db = new DatabaseSync(TMP_DB);
  db.exec(`
    CREATE TABLE branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL, category TEXT, status TEXT NOT NULL DEFAULT 'review_pending', branch_id INTEGER
    );
    CREATE TABLE seo_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER, task_type TEXT NOT NULL,
      target_keyword TEXT NOT NULL, source_candidate_id INTEGER, opportunity_score INTEGER NOT NULL,
      recommended_action TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (target_keyword, task_type, source_candidate_id, branch_id)
    );
  `);
  db.prepare("INSERT INTO branches (id, name, is_active, created_at, updated_at) VALUES (1, '小幡校', 1, '2026-06-01', '2026-06-01')").run();
  db.prepare("INSERT INTO branches (id, name, is_active, created_at, updated_at) VALUES (2, 'あま本部', 0, '2026-07-10', '2026-07-10')").run();

  // 旧来の既存記事5件(誤ってbranch_id=2に紐づいている)
  for (let i = 1; i <= 5; i += 1) {
    db.prepare(
      "INSERT INTO posts (created_at, title, slug, category, status, branch_id) VALUES (?, ?, ?, '地域情報', 'published', 2)"
    ).run(`2026-0${i}-01T00:00:00Z`, `既存記事${i}`, `existing-post-${i}`);
  }
  // 移行後に正しく生成された新しい記事(branch_id=1のまま。統合処理で一切変更されてはいけない)
  db.prepare(
    "INSERT INTO posts (created_at, title, slug, category, status, branch_id) VALUES ('2026-07-16T05:00:00Z', '今朝の新規記事', 'new-post-today', '地域情報', 'review_pending', 1)"
  ).run();

  db.prepare(
    "INSERT INTO seo_tasks (branch_id, task_type, target_keyword, source_candidate_id, opportunity_score, recommended_action, status, created_at, updated_at) VALUES (2, 'create_article', '守山区 塾', 42, 70, 'create_article', 'proposed', '2026-06-01', '2026-06-01')"
  ).run();

  db.close();
}

test('moveBranchData: branch_id=2の全データがbranch_id=1へ移動し、既存のbranch_id=1データ(今朝の新規記事)は変更されない', () => {
  buildReversedProdLikeDb();
  const conn = new DatabaseSync(TMP_DB);

  moveBranchData(conn, 2, 1);

  const posts = conn.prepare('SELECT id, title, slug, branch_id FROM posts ORDER BY id').all();
  assert.equal(posts.length, 6, '記事は1件も失われていないこと(5件の既存記事+1件の新規記事)');
  assert.ok(posts.every((p) => p.branch_id === 1), '全記事がbranch_id=1に統合されていること');

  const todayPost = posts.find((p) => p.slug === 'new-post-today');
  assert.ok(todayPost, '今朝の新規記事が失われていないこと');
  assert.equal(todayPost.title, '今朝の新規記事', '今朝の新規記事の内容が変更されていないこと');

  const tasks = conn.prepare('SELECT branch_id FROM seo_tasks').all();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].branch_id, 1);

  const branch2Posts = conn.prepare('SELECT COUNT(*) c FROM posts WHERE branch_id = 2').get();
  assert.equal(branch2Posts.c, 0, 'branch_id=2(あま本部)は完全に空になっていること');

  conn.close();
});

test('moveBranchData: fromとtoの両方に同じ一意キーの行が既に存在する場合、UNIQUE制約違反でトランザクション全体がロールバックされる', () => {
  buildReversedProdLikeDb();
  const conn = new DatabaseSync(TMP_DB);
  // branch_id=1側にも同じ自然キー(target_keyword+task_type+source_candidate_id)の行を用意し、衝突を発生させる。
  conn
    .prepare(
      "INSERT INTO seo_tasks (branch_id, task_type, target_keyword, source_candidate_id, opportunity_score, recommended_action, status, created_at, updated_at) VALUES (1, 'create_article', '守山区 塾', 42, 60, 'create_article', 'proposed', '2026-07-01', '2026-07-01')"
    )
    .run();

  assert.throws(() => moveBranchData(conn, 2, 1));

  // ロールバックにより、postsテーブルも含め一切変更されていないこと(1トランザクションでまとめているため)。
  const branch2Posts = conn.prepare('SELECT COUNT(*) c FROM posts WHERE branch_id = 2').get();
  assert.equal(branch2Posts.c, 5, '失敗時はpostsも含め全テーブルが変更前の状態のままであること');

  conn.close();
});

test('BRANCH_ID_TABLES: 対象8テーブルが定義されている', () => {
  assert.deepEqual(BRANCH_ID_TABLES, [
    'posts',
    'seo_competitors',
    'seo_keyword_candidates',
    'seo_tasks',
    'seo_page_plans',
    'seo_weekly_recommendations',
    'seo_compound_keywords',
    'seo_topics',
  ]);
});
