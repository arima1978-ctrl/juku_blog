'use strict';

// Node.js 組み込みの node:sqlite を使用する(better-sqlite3 等のネイティブビルドが
// 必要なパッケージは開発機・本番機どちらでも導入に失敗するリスクがあるため避ける)。
// Node.js 22.5+ が必須。実験的機能のためコンソールに警告が出るが動作に問題はない。
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./config');

// テスト時のみ、JUKU_BLOG_DB_PATH で本番データ(data/posts.sqlite)と別の
// 一時ファイルを指定できるようにする(結合テストが実データを汚さないため)。
const DB_PATH = process.env.JUKU_BLOG_DB_PATH || path.join(ROOT, 'data', 'posts.sqlite');
const SCHEMA_PATH = path.join(ROOT, 'db', 'schema.sql');

let db = null;

// テスト専用: 開いたままのDB接続を閉じる(Windowsでは開いたままのファイルを
// 削除できないため、一時DBファイルを使う結合テストの後始末に必要)。
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

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
  // 季節テーマ管理で追加: config/seasonal_topics.yamlのどのテーマを採用したか、
  // そのテーマの公開可能期間の終了日(YYYY-MM-DD)。季節テーマ以外の記事はどちらもNULL。
  ensureColumn(db, 'posts', 'seasonal_topic_id', 'TEXT');
  ensureColumn(db, 'posts', 'publish_window_end', 'TEXT');
  // 過去記事との類似度チェック結果(JSON文字列。scripts/lib/similarity.js参照)
  ensureColumn(db, 'posts', 'similarity_check', 'TEXT');
  // 智谷の企画採用理由・採点結果(JSON文字列。.claude/agents/planner-blog-btoc.md参照)
  ensureColumn(db, 'posts', 'plan_rationale', 'TEXT');
  // 出典情報(episode_sources/parent_qa_sources/web_sources/citation_checkをまとめたJSON文字列)
  ensureColumn(db, 'posts', 'citations', 'TEXT');
  // WordPress公開状態の同期(scripts/sync_wordpress_status.js)。WordPressが実体の正であり、
  // ここはあくまで最後に確認できた状態のキャッシュ。
  ensureColumn(db, 'posts', 'wp_status', 'TEXT');
  ensureColumn(db, 'posts', 'wp_last_synced_at', 'TEXT');
  ensureColumn(db, 'posts', 'wp_sync_error', 'TEXT');
  // アイキャッチメタデータ(JSON文字列。赤羽が生成。実画像生成は未実装で、
  // template/headline/subheadline/altのみ保持する)
  ensureColumn(db, 'posts', 'eyecatch', 'TEXT');
  // 愛知県高校入試 情報ソース参照機能(features.aichi_exam_research)で追加。
  // 該当しない記事(通常記事)はいずれもNULLのまま。
  ensureColumn(db, 'posts', 'exam_target_year', 'INTEGER');
  ensureColumn(db, 'posts', 'exam_validation_status', 'TEXT'); // passed/warning/blocked、対象外ならNULL
  ensureColumn(db, 'posts', 'exam_validation_warnings', 'TEXT'); // JSON配列文字列
  return db;
}

function insertPost(post) {
  const conn = getDb();
  const stmt = conn.prepare(`
    INSERT INTO posts (
      created_at, title, slug, category, target_audience, keywords,
      meta_description, body_md, body_html, fact_check_report, status, reviewer_note,
      seasonal_topic_id, publish_window_end, similarity_check, plan_rationale, citations, eyecatch,
      exam_target_year, exam_validation_status, exam_validation_warnings
    ) VALUES (
      :created_at, :title, :slug, :category, :target_audience, :keywords,
      :meta_description, :body_md, :body_html, :fact_check_report, :status, :reviewer_note,
      :seasonal_topic_id, :publish_window_end, :similarity_check, :plan_rationale, :citations, :eyecatch,
      :exam_target_year, :exam_validation_status, :exam_validation_warnings
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
    seasonal_topic_id: post.seasonal_topic_id || null,
    publish_window_end: post.publish_window_end || null,
    similarity_check: post.similarity_check || null,
    plan_rationale: post.plan_rationale || null,
    citations: post.citations || null,
    eyecatch: post.eyecatch || null,
    exam_target_year: post.exam_target_year || null,
    exam_validation_status: post.exam_validation_status || null,
    exam_validation_warnings: post.exam_validation_warnings || null,
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

// ダッシュボードからの編集(review_pendingの記事のみ、api-server.js側で制御)用の
// 汎用フィールド更新。updatePostBySlugと同じ動的SQL生成パターンだが、
// ダッシュボードは数値idで記事を扱うためidで更新する。
function updatePostFields(id, fields) {
  const conn = getDb();
  const cols = Object.keys(fields);
  if (cols.length === 0) return 0;
  const setClause = cols.map((c) => `${c} = :${c}`).join(', ');
  const stmt = conn.prepare(`UPDATE posts SET ${setClause} WHERE id = :id`);
  const result = stmt.run({ ...fields, id });
  return Number(result.changes);
}

function setStatus(id, status, reviewerNote) {
  const conn = getDb();
  const stmt = conn.prepare('UPDATE posts SET status = :status, reviewer_note = :reviewer_note WHERE id = :id');
  const result = stmt.run({ status, reviewer_note: reviewerNote || null, id });
  return Number(result.changes);
}

function setScheduled(id, { wpPostId, wpLink, scheduledAt }) {
  const conn = getDb();
  const stmt = conn.prepare(
    "UPDATE posts SET status = 'scheduled', wp_post_id = :wp_post_id, wp_link = :wp_link, published_at = :published_at WHERE id = :id"
  );
  const result = stmt.run({ wp_post_id: String(wpPostId), wp_link: wpLink, published_at: scheduledAt, id });
  return Number(result.changes);
}

// 1日1本ペースを保つため、直近の予約済み/公開済み日時のうち最も新しいものを返す
// (これに1日足した日を次の承認記事の予約先にする)
function getLatestScheduleDate() {
  const conn = getDb();
  const row = conn
    .prepare("SELECT MAX(published_at) AS latest FROM posts WHERE status IN ('scheduled', 'published')")
    .get();
  return row && row.latest ? row.latest : null;
}

// 直近の予約済み/公開済み記事のcategory(またはtarget_audience)を、予約日時の新しい順で返す。
// scripts/lib/schedule.js の checkStreak() に渡し、同じ値の連続を検知するために使う。
function getRecentScheduledValues(column, limit) {
  if (column !== 'category' && column !== 'target_audience') {
    throw new Error(`getRecentScheduledValues: 不正なcolumn: ${column}`);
  }
  const conn = getDb();
  const stmt = conn.prepare(
    `SELECT ${column} AS value FROM posts WHERE status IN ('scheduled', 'published') ORDER BY published_at DESC LIMIT ?`
  );
  return stmt.all(limit).map((r) => r.value);
}

// WordPress側の状態確認が必要な記事(予約済みでwp_post_idが分かっているもの)
function listPostsNeedingWpSync() {
  const conn = getDb();
  const stmt = conn.prepare("SELECT * FROM posts WHERE status = 'scheduled' AND wp_post_id IS NOT NULL");
  return stmt.all();
}

// scripts/lib/wp_sync.js の decideSyncAction() の結果を反映する
function applyWpSyncResult(id, { newStatus, wpStatus, syncError, syncedAt }) {
  const conn = getDb();
  const stmt = conn.prepare(
    'UPDATE posts SET status = :status, wp_status = :wp_status, wp_sync_error = :wp_sync_error, wp_last_synced_at = :synced_at WHERE id = :id'
  );
  const result = stmt.run({
    status: newStatus,
    wp_status: wpStatus,
    wp_sync_error: syncError || null,
    synced_at: syncedAt,
    id,
  });
  return Number(result.changes);
}

// 愛知県高校入試 情報ソース参照機能: source_url単位でキャッシュを引く。
// nowIso以前に期限切れ(expires_at < nowIso)なら「使えるキャッシュなし」としてnullを返す
// (呼び出し側は再取得の要否をこの結果だけで判断できる)。
function getExamResearchCache(sourceUrl, nowIso) {
  const conn = getDb();
  const row = conn
    .prepare('SELECT * FROM exam_research_cache WHERE source_url = ? ORDER BY fetched_at DESC LIMIT 1')
    .get(sourceUrl);
  if (!row) return null;
  if (row.expires_at < nowIso) return null;
  return row;
}

// 直近の取得結果(TTL切れも含む。ハッシュ比較による更新検知に使う)
function getLatestExamResearchCache(sourceUrl) {
  const conn = getDb();
  return (
    conn.prepare('SELECT * FROM exam_research_cache WHERE source_url = ? ORDER BY fetched_at DESC LIMIT 1').get(sourceUrl) ||
    null
  );
}

function insertExamResearchCache(entry) {
  const conn = getDb();
  const stmt = conn.prepare(`
    INSERT INTO exam_research_cache (
      source_id, source_url, parent_url, content_type, document_title, target_year,
      fetched_at, expires_at, http_status, content_hash, raw_text, extracted_text,
      parse_status, error_message, created_at, updated_at
    ) VALUES (
      :source_id, :source_url, :parent_url, :content_type, :document_title, :target_year,
      :fetched_at, :expires_at, :http_status, :content_hash, :raw_text, :extracted_text,
      :parse_status, :error_message, :created_at, :updated_at
    )
  `);
  const now = entry.fetched_at;
  const result = stmt.run({
    source_id: entry.source_id,
    source_url: entry.source_url,
    parent_url: entry.parent_url || null,
    content_type: entry.content_type || null,
    document_title: entry.document_title || null,
    target_year: entry.target_year || null,
    fetched_at: entry.fetched_at,
    expires_at: entry.expires_at,
    http_status: entry.http_status || null,
    content_hash: entry.content_hash || null,
    raw_text: entry.raw_text || null,
    extracted_text: entry.extracted_text || null,
    parse_status: entry.parse_status,
    error_message: entry.error_message || null,
    created_at: now,
    updated_at: now,
  });
  return Number(result.lastInsertRowid);
}

function insertExamResearchUpdateEvent(event) {
  const conn = getDb();
  const stmt = conn.prepare(`
    INSERT INTO exam_research_updates (source_id, source_url, previous_hash, current_hash, target_year, detected_at)
    VALUES (:source_id, :source_url, :previous_hash, :current_hash, :target_year, :detected_at)
  `);
  const result = stmt.run({
    source_id: event.source_id,
    source_url: event.source_url,
    previous_hash: event.previous_hash || null,
    current_hash: event.current_hash,
    target_year: event.target_year || null,
    detected_at: event.detected_at,
  });
  return Number(result.lastInsertRowid);
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
    .prepare("SELECT COUNT(*) AS c FROM posts WHERE created_at LIKE ? AND status IN ('approved','scheduled','published')")
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
  updatePostFields,
  getPostBySlug,
  getPostById,
  listPosts,
  listTitlesSince,
  setStatus,
  setScheduled,
  getLatestScheduleDate,
  getRecentScheduledValues,
  listPostsNeedingWpSync,
  applyWpSyncResult,
  listRejectedWithNotes,
  monthlySummary,
  getExamResearchCache,
  getLatestExamResearchCache,
  insertExamResearchCache,
  insertExamResearchUpdateEvent,
  closeDb,
  DB_PATH,
};
