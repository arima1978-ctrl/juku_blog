'use strict';

// Node.js 組み込みの node:sqlite を使用する(better-sqlite3 等のネイティブビルドが
// 必要なパッケージは開発機・本番機どちらでも導入に失敗するリスクがあるため避ける)。
// Node.js 22.5+ が必須。実験的機能のためコンソールに警告が出るが動作に問題はない。
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./config');

const DB_PATH = path.join(ROOT, 'data', 'posts.sqlite');
const SCHEMA_PATH = path.join(ROOT, 'db', 'schema.sql');

let db = null;

function ensureColumn(conn, table, column, type) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  // フェーズ2(WordPress自動投稿)で追加: 実際に投稿されたWordPress側のURL
  ensureColumn(db, 'posts', 'wp_link', 'TEXT');
  return db;
}

function insertPost(post) {
  const conn = getDb();
  const stmt = conn.prepare(`
    INSERT INTO posts (
      created_at, title, slug, category, target_audience, keywords,
      meta_description, body_md, body_html, fact_check_report, status, reviewer_note
    ) VALUES (
      :created_at, :title, :slug, :category, :target_audience, :keywords,
      :meta_description, :body_md, :body_html, :fact_check_report, :status, :reviewer_note
    )
  `);
  const result = stmt.run({
    created_at: post.created_at,
    title: post.title,
    slug: post.slug,
    category: post.category,
    target_audience: post.target_audience || null,
    keywords: post.keywords || null,
    meta_description: post.meta_description || null,
    body_md: post.body_md,
    body_html: post.body_html,
    fact_check_report: post.fact_check_report || null,
    status: post.status || 'review_pending',
    reviewer_note: post.reviewer_note || null,
  });
  return Number(result.lastInsertRowid);
}

function updatePostBySlug(slug, fields) {
  const conn = getDb();
  const cols = Object.keys(fields);
  if (cols.length === 0) return 0;
  const setClause = cols.map((c) => `${c} = :${c}`).join(', ');
  const stmt = conn.prepare(`UPDATE posts SET ${setClause} WHERE slug = :slug`);
  const result = stmt.run({ ...fields, slug });
  return Number(result.changes);
}

function getPostBySlug(slug) {
  const conn = getDb();
  const stmt = conn.prepare('SELECT * FROM posts WHERE slug = ?');
  return stmt.get(slug) || null;
}

function getPostById(id) {
  const conn = getDb();
  const stmt = conn.prepare('SELECT * FROM posts WHERE id = ?');
  return stmt.get(id) || null;
}

function listPosts({ status, category } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM posts WHERE 1=1';
  const params = {};
  if (status) {
    query += ' AND status = :status';
    params.status = status;
  }
  if (category) {
    query += ' AND category = :category';
    params.category = category;
  }
  query += ' ORDER BY created_at DESC';
  const stmt = conn.prepare(query);
  return stmt.all(params);
}

function listTitlesSince(sinceIso) {
  const conn = getDb();
  const stmt = conn.prepare('SELECT title, category, created_at FROM posts WHERE created_at >= ? ORDER BY created_at DESC');
  return stmt.all(sinceIso);
}

function setStatus(id, status, reviewerNote) {
  const conn = getDb();
  const stmt = conn.prepare('UPDATE posts SET status = :status, reviewer_note = :reviewer_note WHERE id = :id');
  const result = stmt.run({ status, reviewer_note: reviewerNote || null, id });
  return Number(result.changes);
}

function setPublished(id, { wpPostId, wpLink, publishedAt }) {
  const conn = getDb();
  const stmt = conn.prepare(
    "UPDATE posts SET status = 'published', wp_post_id = :wp_post_id, wp_link = :wp_link, published_at = :published_at WHERE id = :id"
  );
  const result = stmt.run({ wp_post_id: String(wpPostId), wp_link: wpLink, published_at: publishedAt, id });
  return Number(result.changes);
}

function listRejectedWithNotes(limit = 20) {
  const conn = getDb();
  const stmt = conn.prepare(
    "SELECT title, category, reviewer_note, created_at FROM posts WHERE status = 'rejected' ORDER BY created_at DESC LIMIT ?"
  );
  return stmt.all(limit);
}

function monthlySummary(yearMonthPrefix) {
  const conn = getDb();
  const total = conn
    .prepare("SELECT COUNT(*) AS c FROM posts WHERE created_at LIKE ?")
    .get(`${yearMonthPrefix}%`).c;
  const approved = conn
    .prepare("SELECT COUNT(*) AS c FROM posts WHERE created_at LIKE ? AND status IN ('approved','published')")
    .get(`${yearMonthPrefix}%`).c;
  const byCategory = conn
    .prepare("SELECT category, COUNT(*) AS c FROM posts WHERE created_at LIKE ? GROUP BY category")
    .all(`${yearMonthPrefix}%`);
  return {
    total,
    approved,
    approvalRate: total > 0 ? Math.round((approved / total) * 1000) / 10 : 0,
    byCategory,
  };
}

module.exports = {
  getDb,
  insertPost,
  updatePostBySlug,
  getPostBySlug,
  getPostById,
  listPosts,
  listTitlesSince,
  setStatus,
  setPublished,
  listRejectedWithNotes,
  monthlySummary,
  DB_PATH,
};
