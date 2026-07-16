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

// 複数校舎管理: 既存テーブルのUNIQUE制約にbranch_idを含めるには、SQLiteの制約上
// ALTER TABLE ADD COLUMNだけでは対応できない(制約自体はCREATE TABLE時に固定される)ため、
// 「リネーム→新テーブル作成→データコピー→旧テーブル削除」のテーブル再構築を1トランザクション
// 内で行う。branch_id列が既に存在する場合は何もしない(冪等)。
// newCreateTableSql: 更新後のCREATE TABLE文(branch_id・新UNIQUE制約込み)。
// backfillBranchId: 既存の全行に一括セットするbranch_id(既存データが混ざらないようにする)。
function ensureBranchIdRebuild(conn, tableName, newCreateTableSql, backfillBranchId) {
  const existingCols = conn.prepare(`PRAGMA table_info(${tableName})`).all();
  if (existingCols.some((c) => c.name === 'branch_id')) return; // 既に移行済み

  const columnNames = existingCols.map((c) => c.name);
  const oldTableName = `${tableName}_pre_branch_id`;

  // node:sqliteはPRAGMA foreign_keys=ONが既定。ONのままRENAME TOすると、他テーブルが
  // このテーブルを参照するFOREIGN KEY定義(例: seo_page_plans→seo_tasks)を
  // SQLiteが自動的に新テーブル名へ書き換えてしまい、後続のDROP TABLEで
  // 参照整合性違反(FOREIGN KEY constraint failed)を起こす。また同プラグマは
  // トランザクション内では変更できないため、BEGIN前後でOFF/ONを切り替える。
  conn.exec('PRAGMA foreign_keys = OFF');
  try {
    conn.exec('BEGIN');
    try {
      conn.exec(`ALTER TABLE ${tableName} RENAME TO ${oldTableName}`);
      conn.exec(newCreateTableSql);
      conn
        .prepare(
          `INSERT INTO ${tableName} (${columnNames.join(', ')}, branch_id)
           SELECT ${columnNames.join(', ')}, :branch_id FROM ${oldTableName}`
        )
        .run({ branch_id: backfillBranchId });
      conn.exec(`DROP TABLE ${oldTableName}`);
      conn.exec('COMMIT');
    } catch (err) {
      conn.exec('ROLLBACK');
      throw err;
    }
  } finally {
    conn.exec('PRAGMA foreign_keys = ON');
  }
}

// branchesテーブルから「既存データ(移行前=単一テナント時代の全データ)を一括で
// 割り当てるべきbranch_id」を決定する。
//
// 【重要】is_active=1(現在アクティブな校舎)ではなく、最も早く作成された校舎
// (id最小、単一テナント時代から存在する唯一の校舎)を優先する。is_activeは
// 校舎・塾長設定タブの操作で随時変わりうるミュータブルな実行時状態であり、
// 複数テーブルの移行が別々のプロセス実行(例: 初回の7テーブル移行と、後日の
// posts移行が別デプロイ)にまたがる場合、それぞれの実行タイミングでたまたま
// is_active=1だった校舎が異なると、テーブルごとに異なるbranch_idへ既存データが
// 割り当てられてしまう(2026-07-16の本番データ逆転インシデントの根本原因:
// あま本部を有効化した状態で先にseo_*系の移行が走り、その後に小幡校を再度
// 有効化した状態でposts移行が走ったため、同じ既存データ群が校舎間で分裂した)。
// 「最初に作成された校舎」はis_activeの変動と無関係に一意に定まるため、
// 複数回・複数プロセスにまたがる移行でも常に同じbranch_idを返す。
function resolveBackfillBranchId(conn) {
  const earliestRow = conn.prepare('SELECT id FROM branches ORDER BY id ASC LIMIT 1').get();
  if (earliestRow) return earliestRow.id;

  const { loadJukuConfig } = require('./config');
  const config = loadJukuConfig();
  const wpConf = (config && config.wordpress) || {};
  const areaConf = (config && config.area) || {};
  const jukuConf = (config && config.juku) || {};
  const ts = new Date().toISOString();
  const result = conn
    .prepare(
      `INSERT INTO branches (
        name, target_area, wordpress_author_id, wordpress_author_display_name,
        wordpress_api_token, is_active, created_at, updated_at
      ) VALUES (
        :name, :target_area, :wordpress_author_id, :wordpress_author_display_name,
        NULL, 1, :created_at, :updated_at
      )`
    )
    .run({
      name: jukuConf.name || '既存設定から自動作成された校舎',
      target_area: areaConf.city || null,
      wordpress_author_id: wpConf.author_id ?? null,
      wordpress_author_display_name: wpConf.author_display_name ?? null,
      created_at: ts,
      updated_at: ts,
    });
  return Number(result.lastInsertRowid);
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
  // 競合キーワード分析: 複合キーワード対応(features.competitor_keyword_analysis)で追加。
  // 単語単体だった候補を「地域×塾」等の複合キーワードへ変換する機能拡張に伴うカラム。
  ensureColumn(db, 'seo_keyword_candidates', 'keyword_components', 'TEXT'); // JSON: {area,school,grade,subject,teaching_style,service,exam}
  ensureColumn(db, 'seo_keyword_candidates', 'template_type', 'TEXT');
  ensureColumn(db, 'seo_keyword_candidates', 'cooccurrence_score', 'REAL');
  ensureColumn(db, 'seo_keyword_candidates', 'search_intent', 'TEXT');
  ensureColumn(db, 'seo_keyword_candidates', 'content_type', 'TEXT'); // blog_article/school_page
  ensureColumn(db, 'seo_keyword_candidates', 'data_confidence', 'INTEGER'); // priority_scoreとは独立した0-100点
  ensureColumn(db, 'seo_keyword_candidates', 'existing_post_id', 'INTEGER'); // 最有力の既存記事(FK posts.id)
  ensureColumn(db, 'seo_keyword_candidates', 'approved_action', 'TEXT'); // 人間が承認時に確定した最終アクション
  ensureColumn(db, 'seo_keyword_candidates', 'cannibalization_warning', 'TEXT'); // JSON、該当時のみ
  // AI Growth Director Sprint 2: 自社校舎ページ(config/school_pages.yaml)との対応で追加。
  // 校舎ページTask以外(通常記事等)はいずれもNULLのまま。
  ensureColumn(db, 'seo_tasks', 'target_page_type', 'TEXT'); // 現状"school_page"のみ使用
  ensureColumn(db, 'seo_tasks', 'target_page_id', 'TEXT'); // config/school_pages.yamlのid
  ensureColumn(db, 'seo_tasks', 'target_page_name', 'TEXT'); // 表示用の校舎ページ名
  // AI Growth Director Sprint 3.8: Impact×DifficultyによるROI優先度スコアで追加。
  // 既存のopportunity_score(加算式、priority_scoreとは独立)とはさらに別軸の指標。
  // search_demand等が無くImpactが算出不能な場合はいずれもNULLのまま。
  ensureColumn(db, 'seo_tasks', 'difficulty_score', 'INTEGER'); // 1〜100
  ensureColumn(db, 'seo_tasks', 'difficulty_breakdown', 'TEXT'); // JSON(算出根拠)
  ensureColumn(db, 'seo_tasks', 'expected_impact_clicks', 'REAL'); // 月間見込みクリック増加数
  ensureColumn(db, 'seo_tasks', 'expected_impact_cv', 'REAL'); // 月間見込み問い合わせ(CV)増加数
  ensureColumn(db, 'seo_tasks', 'roi_priority_score', 'INTEGER'); // 0〜100(バッチ内min-max正規化後)
  ensureColumn(db, 'seo_tasks', 'roi_score_computed_at', 'TEXT'); // 計算日時(ISO8601)

  // 複数校舎管理(完全マルチテナント化): postsはグローバルにユニークなslugを維持するため
  // 単純なADD COLUMNで済む。以下7テーブルはUNIQUE制約にbranch_idを含める必要があるため、
  // ensureBranchIdRebuild()でテーブル再構築を行う(branch_id列が既にあれば何もしない)。
  // backfillBranchIdは1度だけ解決し、全テーブルの既存行へ同じ校舎IDを一括セットする
  // (呼び出しの都度再解決すると、初回シードのタイミングによっては別の行を作りかねないため)。
  ensureColumn(db, 'posts', 'branch_id', 'INTEGER');
  const backfillBranchId = resolveBackfillBranchId(db);
  // 【重要】ensureColumnはADD COLUMNのみでNULLのまま追加するため、seo_*系(rebuild経由で
  // 自動バックフィルされる)とは異なり、postsは既存行を明示的にUPDATEしないとbranch_id=NULLの
  // まま取り残される(2026-07-16の本番障害の直接原因。branch_id指定のダッシュボード表示が
  // 全校舎で0件になった)。branch_id未設定の行のみを対象にする(冪等)。
  db.prepare('UPDATE posts SET branch_id = :branch_id WHERE branch_id IS NULL').run({ branch_id: backfillBranchId });

  ensureBranchIdRebuild(
    db,
    'seo_competitors',
    `CREATE TABLE seo_competitors (
      id                  TEXT PRIMARY KEY,
      branch_id           INTEGER,
      name                TEXT NOT NULL,
      domain              TEXT NOT NULL,
      start_url           TEXT,
      sitemap_url         TEXT,
      competitor_type     TEXT,
      target_areas        TEXT,
      target_schools      TEXT,
      target_grades       TEXT,
      target_subjects     TEXT,
      crawl_enabled       INTEGER NOT NULL DEFAULT 0,
      crawl_interval_days INTEGER,
      max_pages           INTEGER,
      last_crawled_at     TEXT,
      last_success_at     TEXT,
      last_error_at       TEXT,
      last_error_message  TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      UNIQUE (domain, branch_id)
    )`,
    backfillBranchId
  );

  ensureBranchIdRebuild(
    db,
    'seo_keyword_candidates',
    `CREATE TABLE seo_keyword_candidates (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id            INTEGER,
      normalized_keyword   TEXT NOT NULL,
      raw_keyword          TEXT,
      target_area          TEXT,
      target_school        TEXT,
      target_grade         TEXT,
      target_subject       TEXT,
      gap_type             TEXT NOT NULL,
      priority_score       INTEGER NOT NULL,
      score_breakdown      TEXT,
      search_demand        INTEGER,
      own_avg_position     REAL,
      competitor_count     INTEGER,
      recommended_action   TEXT,
      suggested_title      TEXT,
      suggested_outline    TEXT,
      status               TEXT NOT NULL DEFAULT 'discovered',
      analysis_run_id      TEXT,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      keyword_components   TEXT,
      template_type        TEXT,
      cooccurrence_score   REAL,
      search_intent        TEXT,
      content_type         TEXT,
      data_confidence      INTEGER,
      existing_post_id     INTEGER,
      approved_action      TEXT,
      cannibalization_warning TEXT,
      FOREIGN KEY (analysis_run_id) REFERENCES seo_analysis_runs(id),
      UNIQUE (normalized_keyword, target_area, target_school, target_grade, target_subject, branch_id)
    )`,
    backfillBranchId
  );

  ensureBranchIdRebuild(
    db,
    'seo_tasks',
    `CREATE TABLE seo_tasks (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id                 INTEGER,
      task_type                 TEXT NOT NULL,
      target_url                TEXT,
      target_post_id            INTEGER,
      target_page_type          TEXT,
      target_page_id            TEXT,
      target_page_name          TEXT,
      target_keyword            TEXT NOT NULL,
      source_candidate_id       INTEGER,
      priority_score            INTEGER,
      opportunity_score         INTEGER NOT NULL,
      opportunity_breakdown     TEXT,
      estimated_effort_minutes  INTEGER,
      recommended_action        TEXT NOT NULL,
      reason                    TEXT,
      status                    TEXT NOT NULL DEFAULT 'proposed',
      created_at                TEXT NOT NULL,
      updated_at                TEXT NOT NULL,
      difficulty_score          INTEGER,
      difficulty_breakdown      TEXT,
      expected_impact_clicks    REAL,
      expected_impact_cv        REAL,
      roi_priority_score        INTEGER,
      roi_score_computed_at     TEXT,
      FOREIGN KEY (source_candidate_id) REFERENCES seo_keyword_candidates(id),
      FOREIGN KEY (target_post_id) REFERENCES posts(id),
      UNIQUE (target_keyword, task_type, source_candidate_id, branch_id)
    )`,
    backfillBranchId
  );

  ensureBranchIdRebuild(
    db,
    'seo_page_plans',
    `CREATE TABLE seo_page_plans (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id                 INTEGER,
      group_key                 TEXT NOT NULL,
      target_page_type          TEXT NOT NULL,
      target_page_id            TEXT NOT NULL,
      target_page_name          TEXT,
      target_url                TEXT,
      primary_task_id           INTEGER NOT NULL,
      primary_keyword           TEXT NOT NULL,
      supporting_task_ids       TEXT NOT NULL DEFAULT '[]',
      supporting_keywords       TEXT NOT NULL DEFAULT '[]',
      excluded_tasks            TEXT NOT NULL DEFAULT '[]',
      combined_search_intents   TEXT NOT NULL DEFAULT '[]',
      selection_breakdown       TEXT,
      fact_check_summary        TEXT,
      warnings                  TEXT NOT NULL DEFAULT '[]',
      source_content_hash       TEXT,
      prompt_version            TEXT,
      status                    TEXT NOT NULL DEFAULT 'proposed',
      created_at                TEXT NOT NULL,
      updated_at                TEXT NOT NULL,
      UNIQUE (target_page_type, target_page_id, branch_id),
      FOREIGN KEY (primary_task_id) REFERENCES seo_tasks(id)
    )`,
    backfillBranchId
  );

  ensureBranchIdRebuild(
    db,
    'seo_weekly_recommendations',
    `CREATE TABLE seo_weekly_recommendations (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id             INTEGER,
      batch_date            TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'proposed',
      task_ids              TEXT NOT NULL DEFAULT '[]',
      items                 TEXT NOT NULL DEFAULT '[]',
      total_expected_cv     REAL,
      total_effort_minutes  INTEGER,
      task_type_breakdown   TEXT,
      curation_tier         TEXT,
      curation_params       TEXT,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      UNIQUE (batch_date, branch_id)
    )`,
    backfillBranchId
  );

  ensureBranchIdRebuild(
    db,
    'seo_compound_keywords',
    `CREATE TABLE seo_compound_keywords (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id           INTEGER,
      compound_keyword    TEXT NOT NULL,
      template_type       TEXT NOT NULL,
      keyword_components  TEXT NOT NULL,
      target_area         TEXT,
      target_school       TEXT,
      target_grade        TEXT,
      target_subject      TEXT,
      created_at          TEXT NOT NULL,
      UNIQUE (compound_keyword, template_type, target_area, target_school, target_grade, target_subject, branch_id)
    )`,
    backfillBranchId
  );

  ensureBranchIdRebuild(
    db,
    'seo_topics',
    `CREATE TABLE seo_topics (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id            INTEGER,
      raw_keyword          TEXT NOT NULL,
      normalized_keyword   TEXT NOT NULL,
      normalization_rule   TEXT,
      target_area          TEXT,
      target_school        TEXT,
      target_grade         TEXT,
      target_subject       TEXT,
      created_at           TEXT NOT NULL,
      UNIQUE (normalized_keyword, target_area, target_school, target_grade, target_subject, branch_id)
    )`,
    backfillBranchId
  );

  // branch_id列は上記のensureColumn/ensureBranchIdRebuildが終わった時点で必ず存在するため、
  // ここでインデックスを作成する(schema.sqlの無条件exec()内に置くと、branch_id列がまだ
  // 無い既存テーブルに対してCREATE INDEXが即座に失敗し、以降の移行処理が一切実行されなく
  // なってしまうため、意図的に分離している)。
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_branch_id ON posts(branch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_seo_competitors_branch_id ON seo_competitors(branch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_seo_keyword_candidates_branch_id ON seo_keyword_candidates(branch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_seo_tasks_branch_id ON seo_tasks(branch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_seo_page_plans_branch_id ON seo_page_plans(branch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_seo_weekly_recommendations_branch_id ON seo_weekly_recommendations(branch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_seo_compound_keywords_branch_id ON seo_compound_keywords(branch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_seo_topics_branch_id ON seo_topics(branch_id)');

  return db;
}

function insertPost(post) {
  const conn = getDb();
  const stmt = conn.prepare(`
    INSERT INTO posts (
      created_at, title, slug, category, target_audience, keywords, branch_id,
      meta_description, body_md, body_html, fact_check_report, status, reviewer_note,
      seasonal_topic_id, publish_window_end, similarity_check, plan_rationale, citations, eyecatch,
      exam_target_year, exam_validation_status, exam_validation_warnings
    ) VALUES (
      :created_at, :title, :slug, :category, :target_audience, :keywords, :branch_id,
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
    branch_id: post.branch_id ?? null,
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

function listPosts({ status, category, branchId } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM posts WHERE 1=1';
  const params = {};
  if (branchId !== undefined && branchId !== null) {
    query += ' AND branch_id = :branch_id';
    params.branch_id = branchId;
  }
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

function listTitlesSince(sinceIso, branchId) {
  const conn = getDb();
  if (branchId !== undefined && branchId !== null) {
    return conn
      .prepare('SELECT title, category, created_at FROM posts WHERE created_at >= ? AND branch_id = ? ORDER BY created_at DESC')
      .all(sinceIso, branchId);
  }
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
function getLatestScheduleDate(branchId) {
  const conn = getDb();
  const row =
    branchId !== undefined && branchId !== null
      ? conn
          .prepare("SELECT MAX(published_at) AS latest FROM posts WHERE status IN ('scheduled', 'published') AND branch_id = ?")
          .get(branchId)
      : conn.prepare("SELECT MAX(published_at) AS latest FROM posts WHERE status IN ('scheduled', 'published')").get();
  return row && row.latest ? row.latest : null;
}

// 直近の予約済み/公開済み記事のcategory(またはtarget_audience)を、予約日時の新しい順で返す。
// scripts/lib/schedule.js の checkStreak() に渡し、同じ値の連続を検知するために使う。
function getRecentScheduledValues(column, limit, branchId) {
  if (column !== 'category' && column !== 'target_audience') {
    throw new Error(`getRecentScheduledValues: 不正なcolumn: ${column}`);
  }
  const conn = getDb();
  if (branchId !== undefined && branchId !== null) {
    const stmt = conn.prepare(
      `SELECT ${column} AS value FROM posts WHERE status IN ('scheduled', 'published') AND branch_id = ? ORDER BY published_at DESC LIMIT ?`
    );
    return stmt.all(branchId, limit).map((r) => r.value);
  }
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

function listRejectedWithNotes(limit = 20, branchId) {
  const conn = getDb();
  if (branchId !== undefined && branchId !== null) {
    return conn
      .prepare(
        "SELECT title, category, reviewer_note, created_at FROM posts WHERE status = 'rejected' AND branch_id = ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(branchId, limit);
  }
  const stmt = conn.prepare(
    "SELECT title, category, reviewer_note, created_at FROM posts WHERE status = 'rejected' ORDER BY created_at DESC LIMIT ?"
  );
  return stmt.all(limit);
}

function monthlySummary(yearMonthPrefix, branchId) {
  const conn = getDb();
  const hasBranchFilter = branchId !== undefined && branchId !== null;
  const branchFilter = hasBranchFilter ? ' AND branch_id = :branch_id' : '';
  // node:sqliteは未参照の名前付きパラメータをエラーにするため、branch_idは
  // フィルタを使う場合のみparamsに含める。
  const params = hasBranchFilter ? { prefix: `${yearMonthPrefix}%`, branch_id: branchId } : { prefix: `${yearMonthPrefix}%` };
  const total = conn
    .prepare(`SELECT COUNT(*) AS c FROM posts WHERE created_at LIKE :prefix${branchFilter}`)
    .get(params).c;
  const approved = conn
    .prepare(
      `SELECT COUNT(*) AS c FROM posts WHERE created_at LIKE :prefix AND status IN ('approved','scheduled','published')${branchFilter}`
    )
    .get(params).c;
  const byCategory = conn
    .prepare(`SELECT category, COUNT(*) AS c FROM posts WHERE created_at LIKE :prefix${branchFilter} GROUP BY category`)
    .all(params);
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
