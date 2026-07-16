'use strict';

// 競合キーワード分析(Keyword Gap Lite)専用のDBアクセス層。
// db.jsを肥大化させないよう分離するが、接続自体はdb.jsのgetDb()を共有する
// (posts.sqliteに相乗りし、posts/seo_*テーブル間のJOINを可能にするため)。
const { getDb } = require('./db');
const { normalizeKeyword } = require('./seo/normalizer');
const { validatePagePlanShape, ALLOWED_PAGE_PLAN_STATUSES } = require('./seo/page_plan_builder');
const { validatePagePlanTransition, ALLOWED_REVIEW_SOURCES } = require('./seo/page_plan_review');
const { validatePageDraftShape } = require('./seo/page_draft_builder');

function toJson(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function fromJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ---- seo_competitors ----------------------------------------------------

function upsertCompetitor(competitor, nowIso) {
  const conn = getDb();
  const existing = conn.prepare('SELECT id FROM seo_competitors WHERE id = ?').get(competitor.id);
  if (existing) {
    conn
      .prepare(
        `UPDATE seo_competitors SET
          name = :name, domain = :domain, start_url = :start_url, sitemap_url = :sitemap_url,
          competitor_type = :competitor_type, target_areas = :target_areas, target_schools = :target_schools,
          target_grades = :target_grades, target_subjects = :target_subjects,
          crawl_enabled = :crawl_enabled, crawl_interval_days = :crawl_interval_days, max_pages = :max_pages,
          updated_at = :updated_at
        WHERE id = :id`
      )
      .run({
        id: competitor.id,
        name: competitor.name,
        domain: competitor.domain,
        start_url: competitor.start_url || null,
        sitemap_url: competitor.sitemap_url || null,
        competitor_type: competitor.competitor_type || null,
        target_areas: toJson(competitor.target_areas),
        target_schools: toJson(competitor.target_schools),
        target_grades: toJson(competitor.target_grades),
        target_subjects: toJson(competitor.target_subjects),
        crawl_enabled: competitor.crawl_enabled ? 1 : 0,
        crawl_interval_days: competitor.crawl_interval_days || null,
        max_pages: competitor.max_pages || null,
        updated_at: nowIso,
      });
    return competitor.id;
  }
  conn
    .prepare(
      `INSERT INTO seo_competitors (
        id, branch_id, name, domain, start_url, sitemap_url, competitor_type,
        target_areas, target_schools, target_grades, target_subjects,
        crawl_enabled, crawl_interval_days, max_pages, created_at, updated_at
      ) VALUES (
        :id, :branch_id, :name, :domain, :start_url, :sitemap_url, :competitor_type,
        :target_areas, :target_schools, :target_grades, :target_subjects,
        :crawl_enabled, :crawl_interval_days, :max_pages, :created_at, :updated_at
      )`
    )
    .run({
      id: competitor.id,
      branch_id: competitor.branch_id ?? null,
      name: competitor.name,
      domain: competitor.domain,
      start_url: competitor.start_url || null,
      sitemap_url: competitor.sitemap_url || null,
      competitor_type: competitor.competitor_type || null,
      target_areas: toJson(competitor.target_areas),
      target_schools: toJson(competitor.target_schools),
      target_grades: toJson(competitor.target_grades),
      target_subjects: toJson(competitor.target_subjects),
      crawl_enabled: competitor.crawl_enabled ? 1 : 0,
      crawl_interval_days: competitor.crawl_interval_days || null,
      max_pages: competitor.max_pages || null,
      created_at: nowIso,
      updated_at: nowIso,
    });
  return competitor.id;
}

function getCompetitor(id) {
  const conn = getDb();
  return conn.prepare('SELECT * FROM seo_competitors WHERE id = ?').get(id) || null;
}

function listCompetitors({ crawlEnabledOnly, branchId } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM seo_competitors WHERE 1=1';
  const params = {};
  if (crawlEnabledOnly) query += ' AND crawl_enabled = 1';
  if (branchId !== undefined && branchId !== null) {
    query += ' AND branch_id = :branch_id';
    params.branch_id = branchId;
  }
  query += ' ORDER BY name';
  return conn.prepare(query).all(params);
}

function recordCompetitorCrawlSuccess(id, atIso) {
  const conn = getDb();
  conn
    .prepare('UPDATE seo_competitors SET last_crawled_at = :at, last_success_at = :at, updated_at = :at WHERE id = :id')
    .run({ at: atIso, id });
}

function recordCompetitorCrawlError(id, atIso, message) {
  const conn = getDb();
  conn
    .prepare(
      'UPDATE seo_competitors SET last_crawled_at = :at, last_error_at = :at, last_error_message = :message, updated_at = :at WHERE id = :id'
    )
    .run({ at: atIso, message, id });
}

// ---- seo_competitor_pages -------------------------------------------------

function getCompetitorPage(competitorId, canonicalUrl) {
  const conn = getDb();
  return (
    conn
      .prepare('SELECT * FROM seo_competitor_pages WHERE competitor_id = ? AND canonical_url = ?')
      .get(competitorId, canonicalUrl) || null
  );
}

// 既存ページと同じcontent_hashならスキップ判定できるよう、呼び出し側にwasUnchangedを返す。
function upsertCompetitorPage(page, nowIso) {
  const conn = getDb();
  const existing = getCompetitorPage(page.competitor_id, page.canonical_url);
  if (existing) {
    const wasUnchanged = Boolean(page.content_hash) && existing.content_hash === page.content_hash;
    conn
      .prepare(
        `UPDATE seo_competitor_pages SET
          url = :url, http_status = :http_status, content_type = :content_type, title = :title,
          meta_description = :meta_description, published_at = :published_at, updated_at_source = :updated_at_source,
          fetched_at = :fetched_at, content_hash = :content_hash, robots_allowed = :robots_allowed,
          updated_at = :updated_at
        WHERE id = :id`
      )
      .run({
        id: existing.id,
        url: page.url,
        http_status: page.http_status || null,
        content_type: page.content_type || null,
        title: page.title || null,
        meta_description: page.meta_description || null,
        published_at: page.published_at || null,
        updated_at_source: page.updated_at_source || null,
        fetched_at: page.fetched_at,
        content_hash: page.content_hash || null,
        robots_allowed: page.robots_allowed === false ? 0 : 1,
        updated_at: nowIso,
      });
    return { id: existing.id, isNew: false, wasUnchanged };
  }
  const result = conn
    .prepare(
      `INSERT INTO seo_competitor_pages (
        competitor_id, url, canonical_url, http_status, content_type, title, meta_description,
        published_at, updated_at_source, fetched_at, content_hash, robots_allowed, created_at, updated_at
      ) VALUES (
        :competitor_id, :url, :canonical_url, :http_status, :content_type, :title, :meta_description,
        :published_at, :updated_at_source, :fetched_at, :content_hash, :robots_allowed, :created_at, :updated_at
      )`
    )
    .run({
      competitor_id: page.competitor_id,
      url: page.url,
      canonical_url: page.canonical_url,
      http_status: page.http_status || null,
      content_type: page.content_type || null,
      title: page.title || null,
      meta_description: page.meta_description || null,
      published_at: page.published_at || null,
      updated_at_source: page.updated_at_source || null,
      fetched_at: page.fetched_at,
      content_hash: page.content_hash || null,
      robots_allowed: page.robots_allowed === false ? 0 : 1,
      created_at: nowIso,
      updated_at: nowIso,
    });
  return { id: Number(result.lastInsertRowid), isNew: true, wasUnchanged: false };
}

function replacePageHeadings(pageId, headings, nowIso) {
  const conn = getDb();
  conn.prepare('DELETE FROM seo_page_headings WHERE page_id = ?').run(pageId);
  const stmt = conn.prepare(
    'INSERT INTO seo_page_headings (page_id, level, text, position, created_at) VALUES (:page_id, :level, :text, :position, :created_at)'
  );
  headings.forEach((h, index) => {
    stmt.run({ page_id: pageId, level: h.level, text: h.text, position: index, created_at: nowIso });
  });
}

function listPageHeadings(pageId) {
  const conn = getDb();
  return conn.prepare('SELECT * FROM seo_page_headings WHERE page_id = ? ORDER BY position').all(pageId);
}

// 未解析、または前回解析後にfetched_atが更新された(=本文が変わった)ページを返す。
function listPagesNeedingAnalysis() {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT * FROM seo_competitor_pages
       WHERE last_analyzed_at IS NULL OR last_analyzed_at < fetched_at
       ORDER BY competitor_id`
    )
    .all();
}

function markPageAnalyzed(pageId, atIso) {
  const conn = getDb();
  conn.prepare('UPDATE seo_competitor_pages SET last_analyzed_at = :at WHERE id = :id').run({ at: atIso, id: pageId });
}

// Gap判定の「totalCompetitorsConsidered」に使う: 実際にページが1件以上取得できた競合数
// (登録はされていても未クロールの競合を分母に含めないようにするため)。
function countAnalyzedCompetitors() {
  const conn = getDb();
  const row = conn.prepare('SELECT COUNT(DISTINCT competitor_id) AS c FROM seo_competitor_pages').get();
  return row ? row.c : 0;
}

// ---- seo_topics / seo_page_topics -----------------------------------------

function upsertTopic(topic, nowIso) {
  const conn = getDb();
  const key = {
    normalized_keyword: topic.normalized_keyword,
    target_area: topic.target_area || null,
    target_school: topic.target_school || null,
    target_grade: topic.target_grade || null,
    target_subject: topic.target_subject || null,
    branch_id: topic.branch_id ?? null,
  };
  const existing = conn
    .prepare(
      `SELECT id FROM seo_topics WHERE normalized_keyword = :normalized_keyword
        AND target_area IS :target_area AND target_school IS :target_school
        AND target_grade IS :target_grade AND target_subject IS :target_subject
        AND branch_id IS :branch_id`
    )
    .get(key);
  if (existing) return existing.id;
  const result = conn
    .prepare(
      `INSERT INTO seo_topics (raw_keyword, normalized_keyword, normalization_rule, target_area, target_school, target_grade, target_subject, branch_id, created_at)
       VALUES (:raw_keyword, :normalized_keyword, :normalization_rule, :target_area, :target_school, :target_grade, :target_subject, :branch_id, :created_at)`
    )
    .run({
      raw_keyword: topic.raw_keyword || topic.normalized_keyword,
      normalized_keyword: topic.normalized_keyword,
      normalization_rule: topic.normalization_rule || null,
      target_area: key.target_area,
      target_school: key.target_school,
      target_grade: key.target_grade,
      target_subject: key.target_subject,
      branch_id: key.branch_id,
      created_at: nowIso,
    });
  return Number(result.lastInsertRowid);
}

function upsertPageTopic(entry, nowIso) {
  const conn = getDb();
  const existing = conn
    .prepare(
      'SELECT id FROM seo_page_topics WHERE page_id = ? AND topic_id = ? AND extraction_method = ?'
    )
    .get(entry.page_id, entry.topic_id, entry.extraction_method);
  if (existing) {
    conn
      .prepare(
        'UPDATE seo_page_topics SET score = :score, occurrence_count = :occurrence_count, confidence = :confidence WHERE id = :id'
      )
      .run({
        id: existing.id,
        score: entry.score ?? null,
        occurrence_count: entry.occurrence_count ?? null,
        confidence: entry.confidence ?? null,
      });
    return existing.id;
  }
  const result = conn
    .prepare(
      `INSERT INTO seo_page_topics (page_id, topic_id, score, occurrence_count, extraction_method, confidence, created_at)
       VALUES (:page_id, :topic_id, :score, :occurrence_count, :extraction_method, :confidence, :created_at)`
    )
    .run({
      page_id: entry.page_id,
      topic_id: entry.topic_id,
      score: entry.score ?? null,
      occurrence_count: entry.occurrence_count ?? null,
      extraction_method: entry.extraction_method,
      confidence: entry.confidence ?? null,
      created_at: nowIso,
    });
  return Number(result.lastInsertRowid);
}

function listTopicsForPage(pageId) {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT t.*, pt.score, pt.occurrence_count, pt.extraction_method, pt.confidence
       FROM seo_page_topics pt JOIN seo_topics t ON t.id = pt.topic_id
       WHERE pt.page_id = ?`
    )
    .all(pageId);
}

// Gap判定用: 競合ページから抽出された全テーマを、ページ・競合情報とJOINして返す。
// 呼び出し側(seo_gap_calculate.js)でtopic_id単位にグルーピングして使う。
function listTopicCoverage() {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT t.id AS topic_id, t.raw_keyword, t.normalized_keyword, t.target_area, t.target_school, t.target_grade, t.target_subject,
              pt.page_id, pt.score, pt.extraction_method, pt.confidence,
              p.competitor_id, p.canonical_url, p.title AS page_title, p.content_hash
       FROM seo_topics t
       JOIN seo_page_topics pt ON pt.topic_id = t.id
       JOIN seo_competitor_pages p ON p.id = pt.page_id`
    )
    .all();
}

// ---- seo_compound_keywords / seo_page_compound_keywords --------------------

function upsertCompoundKeyword(compound, nowIso) {
  const conn = getDb();
  const key = {
    compound_keyword: compound.compound_keyword,
    template_type: compound.template_type,
    target_area: compound.target_area || null,
    target_school: compound.target_school || null,
    target_grade: compound.target_grade || null,
    target_subject: compound.target_subject || null,
    branch_id: compound.branch_id ?? null,
  };
  const existing = conn
    .prepare(
      `SELECT id FROM seo_compound_keywords WHERE compound_keyword = :compound_keyword
        AND template_type = :template_type AND target_area IS :target_area
        AND target_school IS :target_school AND target_grade IS :target_grade
        AND target_subject IS :target_subject AND branch_id IS :branch_id`
    )
    .get(key);
  if (existing) return existing.id;
  const result = conn
    .prepare(
      `INSERT INTO seo_compound_keywords (compound_keyword, template_type, keyword_components, target_area, target_school, target_grade, target_subject, branch_id, created_at)
       VALUES (:compound_keyword, :template_type, :keyword_components, :target_area, :target_school, :target_grade, :target_subject, :branch_id, :created_at)`
    )
    .run({
      compound_keyword: compound.compound_keyword,
      template_type: compound.template_type,
      keyword_components: JSON.stringify(compound.keyword_components || {}),
      target_area: key.target_area,
      target_school: key.target_school,
      target_grade: key.target_grade,
      target_subject: key.target_subject,
      branch_id: key.branch_id,
      created_at: nowIso,
    });
  return Number(result.lastInsertRowid);
}

function upsertPageCompoundKeyword(entry, nowIso) {
  const conn = getDb();
  const existing = conn
    .prepare('SELECT id FROM seo_page_compound_keywords WHERE page_id = ? AND compound_keyword_id = ?')
    .get(entry.page_id, entry.compound_keyword_id);
  if (existing) {
    conn
      .prepare('UPDATE seo_page_compound_keywords SET cooccurrence_score = :cooccurrence_score, same_zone = :same_zone WHERE id = :id')
      .run({ id: existing.id, cooccurrence_score: entry.cooccurrence_score ?? null, same_zone: entry.same_zone || null });
    return existing.id;
  }
  const result = conn
    .prepare(
      `INSERT INTO seo_page_compound_keywords (page_id, compound_keyword_id, cooccurrence_score, same_zone, created_at)
       VALUES (:page_id, :compound_keyword_id, :cooccurrence_score, :same_zone, :created_at)`
    )
    .run({
      page_id: entry.page_id,
      compound_keyword_id: entry.compound_keyword_id,
      cooccurrence_score: entry.cooccurrence_score ?? null,
      same_zone: entry.same_zone || null,
      created_at: nowIso,
    });
  return Number(result.lastInsertRowid);
}

// Gap判定用: 競合ページから検出された全複合キーワードを、ページ・競合情報とJOINして返す。
// 呼び出し側(seo_gap_calculate.js)でcompound_keyword_id単位にグルーピングして使う。
function listCompoundKeywordCoverage() {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT ck.id AS compound_keyword_id, ck.compound_keyword, ck.template_type, ck.keyword_components,
              ck.target_area, ck.target_school, ck.target_grade, ck.target_subject,
              pck.page_id, pck.cooccurrence_score, pck.same_zone,
              p.competitor_id, p.canonical_url, p.title AS page_title, p.content_hash
       FROM seo_compound_keywords ck
       JOIN seo_page_compound_keywords pck ON pck.compound_keyword_id = ck.id
       JOIN seo_competitor_pages p ON p.id = pck.page_id`
    )
    .all();
}

// ---- seo_gsc_queries -------------------------------------------------------

function upsertGscQueryRow(row, nowIso) {
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO seo_gsc_queries (site_property, date, query, page, device, country, search_type, clicks, impressions, ctr, position, fetched_at)
       VALUES (:site_property, :date, :query, :page, :device, :country, :search_type, :clicks, :impressions, :ctr, :position, :fetched_at)
       ON CONFLICT (site_property, date, query, page, device, country, search_type)
       DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions, ctr = excluded.ctr,
         position = excluded.position, fetched_at = excluded.fetched_at`
    )
    .run({
      site_property: row.site_property,
      date: row.date,
      query: row.query,
      page: row.page || '',
      device: row.device || '',
      country: row.country || '',
      search_type: row.search_type || '',
      clicks: row.clicks ?? null,
      impressions: row.impressions ?? null,
      ctr: row.ctr ?? null,
      position: row.position ?? null,
      fetched_at: row.fetched_at || nowIso,
    });
}

function listGscQueriesForKeyword(query) {
  const conn = getDb();
  return conn.prepare('SELECT * FROM seo_gsc_queries WHERE query = ? ORDER BY date DESC').all(query);
}

function listDistinctGscQueries() {
  const conn = getDb();
  return conn.prepare('SELECT DISTINCT query FROM seo_gsc_queries').all().map((r) => r.query);
}

// candidateQueryに対し、raw完全一致のGSC queryに加え、normalizeKeyword()適用後が
// candidateQueryと同一になる他のGSC query(表記揺れ)も全て「一致」として扱う
// (Query Variant Matching Phase1)。token集合一致・部分一致・fuzzy一致は行わない
// (既存のnormalizeKeywordルールで同一と判定されるものだけを統合する)。
// 戻り値: { matchedQueries: string[], matchType: 'exact'|'normalized_exact'|null }
//   matchType: raw完全一致行(candidateQuery自身)が含まれていればexact、
//   含まれず表記揺れ経由のみで一致した場合はnormalized_exact、一致が無ければnull。
function resolveMatchingGscQueries(candidateQuery) {
  const candidateNormalized = normalizeKeyword(candidateQuery).normalized;
  const distinctQueries = listDistinctGscQueries();
  const matchedQueries = distinctQueries.filter((raw) => normalizeKeyword(raw).normalized === candidateNormalized);
  if (matchedQueries.length === 0) return { matchedQueries: [], matchType: null };
  const hasExact = matchedQueries.includes(candidateQuery);
  return { matchedQueries, matchType: hasExact ? 'exact' : 'normalized_exact' };
}

// カニバリゼーション検知(scripts/lib/seo/cannibalization.js)用: 同一クエリ(表記揺れ含む)の
// ページ別実績を{page, impressions}の配列で返す(同一pageは合算し重複させない)。
function getGscPagesForQuery(query) {
  const { matchedQueries } = resolveMatchingGscQueries(query);
  if (matchedQueries.length === 0) return [];
  const conn = getDb();
  const placeholders = matchedQueries.map(() => '?').join(',');
  const rows = conn.prepare(`SELECT page, impressions FROM seo_gsc_queries WHERE query IN (${placeholders})`).all(...matchedQueries);
  const impressionsByPage = new Map();
  rows.forEach((r) => {
    if (!r.page) return;
    impressionsByPage.set(r.page, (impressionsByPage.get(r.page) || 0) + (r.impressions || 0));
  });
  return Array.from(impressionsByPage.entries()).map(([page, impressions]) => ({ page, impressions }));
}

// 表示回数で重み付けした平均順位・CTRを返す(表示回数0のクエリを平均で埋もれさせないため)。
// データが無ければnull(呼び出し側はnullを「実績データ無し」として扱う。0とは区別する)。
// Query Variant Matching Phase1: raw完全一致に加え、normalizeKeyword()後が同一の
// GSC queryの実績も合算する(同一GSC行を二重集計しない。token集合一致・部分一致は行わない)。
// 既存の戻り値フィールド(impressions/clicks/avgPosition/ctr)は維持し、match_type/
// matched_queriesを追加フィールドとしてのみ増やす(既存呼び出し元への後方互換を維持)。
function getGscAggregateForKeyword(query) {
  const { matchedQueries, matchType } = resolveMatchingGscQueries(query);
  if (matchedQueries.length === 0) return null;
  const conn = getDb();
  const placeholders = matchedQueries.map(() => '?').join(',');
  const rows = conn.prepare(`SELECT * FROM seo_gsc_queries WHERE query IN (${placeholders})`).all(...matchedQueries);
  if (rows.length === 0) return null;
  const impressions = rows.reduce((sum, r) => sum + (r.impressions || 0), 0);
  const clicks = rows.reduce((sum, r) => sum + (r.clicks || 0), 0);
  const weightDenom = rows.reduce((sum, r) => sum + (r.impressions || 1), 0);
  const weightedPosition = rows.reduce((sum, r) => sum + (r.position || 0) * (r.impressions || 1), 0);
  return {
    impressions,
    clicks,
    avgPosition: weightDenom > 0 ? weightedPosition / weightDenom : null,
    ctr: impressions > 0 ? clicks / impressions : null,
    match_type: matchType,
    matched_queries: matchedQueries,
  };
}

// ---- seo_keyword_metrics / seo_serp_rankings ------------------------------

function upsertKeywordMetric(row, nowIso) {
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO seo_keyword_metrics (keyword, normalized_keyword, average_monthly_searches, competition, competition_index, low_top_of_page_bid, high_top_of_page_bid, source, source_file, imported_at)
       VALUES (:keyword, :normalized_keyword, :average_monthly_searches, :competition, :competition_index, :low_top_of_page_bid, :high_top_of_page_bid, :source, :source_file, :imported_at)
       ON CONFLICT (normalized_keyword, source)
       DO UPDATE SET keyword = excluded.keyword, average_monthly_searches = excluded.average_monthly_searches,
         competition = excluded.competition, competition_index = excluded.competition_index,
         low_top_of_page_bid = excluded.low_top_of_page_bid, high_top_of_page_bid = excluded.high_top_of_page_bid,
         source_file = excluded.source_file, imported_at = excluded.imported_at`
    )
    .run({
      keyword: row.keyword,
      normalized_keyword: row.normalized_keyword,
      average_monthly_searches: row.average_monthly_searches ?? null,
      competition: row.competition || null,
      competition_index: row.competition_index ?? null,
      low_top_of_page_bid: row.low_top_of_page_bid ?? null,
      high_top_of_page_bid: row.high_top_of_page_bid ?? null,
      source: row.source,
      source_file: row.source_file || null,
      imported_at: row.imported_at || nowIso,
    });
}

function getKeywordMetric(normalizedKeyword, source) {
  const conn = getDb();
  return (
    conn
      .prepare('SELECT * FROM seo_keyword_metrics WHERE normalized_keyword = ? AND source = ?')
      .get(normalizedKeyword, source) || null
  );
}

function upsertSerpRanking(row, nowIso) {
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO seo_serp_rankings (keyword, normalized_keyword, domain, ranking_url, position, checked_at, device, location, source, imported_at)
       VALUES (:keyword, :normalized_keyword, :domain, :ranking_url, :position, :checked_at, :device, :location, :source, :imported_at)
       ON CONFLICT (normalized_keyword, domain, checked_at, device, location)
       DO UPDATE SET keyword = excluded.keyword, ranking_url = excluded.ranking_url, position = excluded.position,
         source = excluded.source, imported_at = excluded.imported_at`
    )
    .run({
      keyword: row.keyword,
      normalized_keyword: row.normalized_keyword,
      domain: row.domain,
      ranking_url: row.ranking_url || null,
      position: row.position ?? null,
      checked_at: row.checked_at,
      device: row.device || '',
      location: row.location || '',
      source: row.source,
      imported_at: row.imported_at || nowIso,
    });
}

function listSerpRankingsForKeyword(normalizedKeyword) {
  const conn = getDb();
  return conn
    .prepare('SELECT * FROM seo_serp_rankings WHERE normalized_keyword = ? ORDER BY checked_at DESC')
    .all(normalizedKeyword);
}

// 登録競合ドメインの中での最良順位(CSV/手動登録のみ。Google検索結果の直接取得はしない)。
function getCompetitorBestPosition(normalizedKeyword, competitorDomains) {
  if (!competitorDomains || competitorDomains.length === 0) return null;
  const conn = getDb();
  const placeholders = competitorDomains.map(() => '?').join(',');
  const row = conn
    .prepare(`SELECT MIN(position) AS best FROM seo_serp_rankings WHERE normalized_keyword = ? AND domain IN (${placeholders})`)
    .get(normalizedKeyword, ...competitorDomains);
  return row && row.best != null ? row.best : null;
}

// キーワードプランナーCSV由来の検索需要(複数sourceがあれば最新のものを採用)。
function getKeywordDemand(normalizedKeyword) {
  const conn = getDb();
  const row = conn
    .prepare('SELECT average_monthly_searches FROM seo_keyword_metrics WHERE normalized_keyword = ? ORDER BY imported_at DESC LIMIT 1')
    .get(normalizedKeyword);
  return row ? row.average_monthly_searches : null;
}

// ---- seo_keyword_candidates -------------------------------------------------

function upsertKeywordCandidate(candidate, nowIso) {
  const conn = getDb();
  const key = {
    normalized_keyword: candidate.normalized_keyword,
    target_area: candidate.target_area || null,
    target_school: candidate.target_school || null,
    target_grade: candidate.target_grade || null,
    target_subject: candidate.target_subject || null,
    branch_id: candidate.branch_id ?? null,
  };
  const existing = conn
    .prepare(
      `SELECT id, status FROM seo_keyword_candidates WHERE normalized_keyword = :normalized_keyword
        AND target_area IS :target_area AND target_school IS :target_school
        AND target_grade IS :target_grade AND target_subject IS :target_subject
        AND branch_id IS :branch_id`
    )
    .get(key);
  if (existing) {
    conn
      .prepare(
        `UPDATE seo_keyword_candidates SET
          raw_keyword = :raw_keyword, gap_type = :gap_type, priority_score = :priority_score,
          score_breakdown = :score_breakdown, search_demand = :search_demand, own_avg_position = :own_avg_position,
          competitor_count = :competitor_count, recommended_action = :recommended_action,
          suggested_title = :suggested_title, suggested_outline = :suggested_outline,
          keyword_components = :keyword_components, template_type = :template_type,
          cooccurrence_score = :cooccurrence_score, search_intent = :search_intent,
          content_type = :content_type, data_confidence = :data_confidence,
          existing_post_id = :existing_post_id, cannibalization_warning = :cannibalization_warning,
          analysis_run_id = :analysis_run_id, updated_at = :updated_at
        WHERE id = :id`
      )
      .run({
        id: existing.id,
        raw_keyword: candidate.raw_keyword || null,
        gap_type: candidate.gap_type,
        priority_score: candidate.priority_score,
        score_breakdown: toJson(candidate.score_breakdown),
        search_demand: candidate.search_demand ?? null,
        own_avg_position: candidate.own_avg_position ?? null,
        competitor_count: candidate.competitor_count ?? null,
        recommended_action: candidate.recommended_action || null,
        suggested_title: candidate.suggested_title || null,
        suggested_outline: toJson(candidate.suggested_outline),
        keyword_components: toJson(candidate.keyword_components),
        template_type: candidate.template_type || null,
        cooccurrence_score: candidate.cooccurrence_score ?? null,
        search_intent: candidate.search_intent || null,
        content_type: candidate.content_type || null,
        data_confidence: candidate.data_confidence ?? null,
        existing_post_id: candidate.existing_post_id ?? null,
        cannibalization_warning: toJson(candidate.cannibalization_warning),
        analysis_run_id: candidate.analysis_run_id || null,
        updated_at: nowIso,
      });
    return { id: existing.id, isNew: false, previousStatus: existing.status };
  }
  const result = conn
    .prepare(
      `INSERT INTO seo_keyword_candidates (
        normalized_keyword, raw_keyword, target_area, target_school, target_grade, target_subject, branch_id,
        gap_type, priority_score, score_breakdown, search_demand, own_avg_position, competitor_count,
        recommended_action, suggested_title, suggested_outline,
        keyword_components, template_type, cooccurrence_score, search_intent, content_type,
        data_confidence, existing_post_id, cannibalization_warning,
        status, analysis_run_id, created_at, updated_at
      ) VALUES (
        :normalized_keyword, :raw_keyword, :target_area, :target_school, :target_grade, :target_subject, :branch_id,
        :gap_type, :priority_score, :score_breakdown, :search_demand, :own_avg_position, :competitor_count,
        :recommended_action, :suggested_title, :suggested_outline,
        :keyword_components, :template_type, :cooccurrence_score, :search_intent, :content_type,
        :data_confidence, :existing_post_id, :cannibalization_warning,
        :status, :analysis_run_id, :created_at, :updated_at
      )`
    )
    .run({
      normalized_keyword: key.normalized_keyword,
      raw_keyword: candidate.raw_keyword || null,
      target_area: key.target_area,
      target_school: key.target_school,
      target_grade: key.target_grade,
      target_subject: key.target_subject,
      branch_id: key.branch_id,
      gap_type: candidate.gap_type,
      priority_score: candidate.priority_score,
      score_breakdown: toJson(candidate.score_breakdown),
      search_demand: candidate.search_demand ?? null,
      own_avg_position: candidate.own_avg_position ?? null,
      competitor_count: candidate.competitor_count ?? null,
      recommended_action: candidate.recommended_action || null,
      suggested_title: candidate.suggested_title || null,
      suggested_outline: toJson(candidate.suggested_outline),
      keyword_components: toJson(candidate.keyword_components),
      template_type: candidate.template_type || null,
      cooccurrence_score: candidate.cooccurrence_score ?? null,
      search_intent: candidate.search_intent || null,
      content_type: candidate.content_type || null,
      data_confidence: candidate.data_confidence ?? null,
      existing_post_id: candidate.existing_post_id ?? null,
      cannibalization_warning: toJson(candidate.cannibalization_warning),
      status: candidate.status || 'discovered',
      analysis_run_id: candidate.analysis_run_id || null,
      created_at: nowIso,
      updated_at: nowIso,
    });
  return { id: Number(result.lastInsertRowid), isNew: true, previousStatus: null };
}

function parseCandidateJsonFields(row) {
  return {
    ...row,
    score_breakdown: fromJson(row.score_breakdown),
    suggested_outline: fromJson(row.suggested_outline),
    keyword_components: fromJson(row.keyword_components),
    cannibalization_warning: fromJson(row.cannibalization_warning),
  };
}

function getKeywordCandidateById(id) {
  const conn = getDb();
  const row = conn.prepare('SELECT * FROM seo_keyword_candidates WHERE id = ?').get(id);
  if (!row) return null;
  return parseCandidateJsonFields(row);
}

function listKeywordCandidates({ status, gapType, targetArea, minPriorityScore, approvedAction, orderBy, branchId } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM seo_keyword_candidates WHERE 1=1';
  const params = {};
  if (branchId !== undefined && branchId !== null) {
    query += ' AND branch_id = :branch_id';
    params.branch_id = branchId;
  }
  if (status) {
    query += ' AND status = :status';
    params.status = status;
  }
  if (gapType) {
    query += ' AND gap_type = :gap_type';
    params.gap_type = gapType;
  }
  if (targetArea) {
    query += ' AND target_area = :target_area';
    params.target_area = targetArea;
  }
  if (minPriorityScore !== undefined && minPriorityScore !== null) {
    query += ' AND priority_score >= :min_priority_score';
    params.min_priority_score = minPriorityScore;
  }
  if (approvedAction) {
    query += ' AND approved_action = :approved_action';
    params.approved_action = approvedAction;
  }
  const orderColumns = { priority_score: 'priority_score DESC', updated_at: 'updated_at DESC', search_demand: 'search_demand DESC' };
  query += ` ORDER BY ${orderColumns[orderBy] || 'priority_score DESC'}`;
  return conn.prepare(query).all(params).map(parseCandidateJsonFields);
}

// 候補の状態遷移。二重キュー登録を防ぐため、queuedへの遷移はapproved以外からは許可しない。
// approvedActionを渡すと、承認時に人間が確定した最終アクション(新規記事/既存記事改善/
// 校舎ページ改善)をapproved_actionへ記録する(recommended_actionは機械判定のまま上書きしない)。
function updateCandidateStatus(id, { toStatus, reason, actor, approvedAction }, nowIso) {
  const conn = getDb();
  const current = conn.prepare('SELECT status FROM seo_keyword_candidates WHERE id = ?').get(id);
  if (!current) throw new Error(`updateCandidateStatus: candidate id=${id} が見つかりません`);
  if (toStatus === 'queued' && current.status !== 'approved') {
    throw new Error(`updateCandidateStatus: queuedにはapproved状態からのみ遷移可能です(現状: ${current.status})`);
  }
  if (approvedAction !== undefined) {
    conn
      .prepare('UPDATE seo_keyword_candidates SET status = :status, approved_action = :approved_action, updated_at = :updated_at WHERE id = :id')
      .run({ status: toStatus, approved_action: approvedAction, updated_at: nowIso, id });
  } else {
    conn.prepare('UPDATE seo_keyword_candidates SET status = :status, updated_at = :updated_at WHERE id = :id').run({
      status: toStatus,
      updated_at: nowIso,
      id,
    });
  }
  conn
    .prepare(
      `INSERT INTO seo_candidate_status_history (candidate_id, from_status, to_status, reason, actor, created_at)
       VALUES (:candidate_id, :from_status, :to_status, :reason, :actor, :created_at)`
    )
    .run({
      candidate_id: id,
      from_status: current.status,
      to_status: toStatus,
      reason: reason || null,
      actor: actor || 'system',
      created_at: nowIso,
    });
  return { from: current.status, to: toStatus };
}

function listCandidateStatusHistory(candidateId) {
  const conn = getDb();
  return conn
    .prepare('SELECT * FROM seo_candidate_status_history WHERE candidate_id = ? ORDER BY created_at')
    .all(candidateId);
}

// ---- seo_candidate_evidence / seo_candidate_existing_articles --------------

function insertCandidateEvidence(evidence, nowIso) {
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO seo_candidate_evidence (candidate_id, competitor_page_id, evidence_type, detail, confidence, created_at)
       VALUES (:candidate_id, :competitor_page_id, :evidence_type, :detail, :confidence, :created_at)
       ON CONFLICT (candidate_id, competitor_page_id, evidence_type)
       DO UPDATE SET detail = excluded.detail, confidence = excluded.confidence`
    )
    .run({
      candidate_id: evidence.candidate_id,
      competitor_page_id: evidence.competitor_page_id || null,
      evidence_type: evidence.evidence_type,
      detail: toJson(evidence.detail),
      confidence: evidence.confidence ?? null,
      created_at: nowIso,
    });
}

function listCandidateEvidence(candidateId) {
  const conn = getDb();
  return conn
    .prepare('SELECT * FROM seo_candidate_evidence WHERE candidate_id = ?')
    .all(candidateId)
    .map((row) => ({ ...row, detail: fromJson(row.detail) }));
}

function upsertCandidateExistingArticle(link, nowIso) {
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO seo_candidate_existing_articles (candidate_id, post_id, similarity_score, match_reason, created_at)
       VALUES (:candidate_id, :post_id, :similarity_score, :match_reason, :created_at)
       ON CONFLICT (candidate_id, post_id)
       DO UPDATE SET similarity_score = excluded.similarity_score, match_reason = excluded.match_reason`
    )
    .run({
      candidate_id: link.candidate_id,
      post_id: link.post_id,
      similarity_score: link.similarity_score ?? null,
      match_reason: link.match_reason || null,
      created_at: nowIso,
    });
}

function listCandidateExistingArticles(candidateId) {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT sea.*, p.title AS post_title, p.slug AS post_slug, p.status AS post_status
       FROM seo_candidate_existing_articles sea JOIN posts p ON p.id = sea.post_id
       WHERE sea.candidate_id = ?`
    )
    .all(candidateId);
}

// ---- seo_analysis_runs / seo_import_jobs -----------------------------------

// 二重起動防止: running状態の実行が既にあればそれを返す(呼び出し側は新規実行を止める)。
function getRunningAnalysisRun() {
  const conn = getDb();
  return conn.prepare("SELECT * FROM seo_analysis_runs WHERE status = 'running' LIMIT 1").get() || null;
}

function createAnalysisRun(id, startedAtIso) {
  const conn = getDb();
  conn
    .prepare(
      "INSERT INTO seo_analysis_runs (id, started_at, status, created_at) VALUES (:id, :started_at, 'running', :created_at)"
    )
    .run({ id, started_at: startedAtIso, created_at: startedAtIso });
  return id;
}

function finishAnalysisRun(id, { status, finishedAtIso, summary, ...counts }) {
  const conn = getDb();
  conn
    .prepare(
      `UPDATE seo_analysis_runs SET
        status = :status, finished_at = :finished_at, competitor_count = :competitor_count,
        pages_fetched = :pages_fetched, pages_new = :pages_new, pages_updated = :pages_updated,
        pages_unchanged = :pages_unchanged, pages_skipped = :pages_skipped,
        robots_disallowed_count = :robots_disallowed_count, error_count = :error_count,
        topics_extracted = :topics_extracted, candidates_created = :candidates_created,
        candidates_updated = :candidates_updated, gsc_rows_fetched = :gsc_rows_fetched,
        csv_rows_imported = :csv_rows_imported, duration_ms = :duration_ms, summary = :summary
      WHERE id = :id`
    )
    .run({
      id,
      status,
      finished_at: finishedAtIso,
      competitor_count: counts.competitor_count ?? null,
      pages_fetched: counts.pages_fetched ?? null,
      pages_new: counts.pages_new ?? null,
      pages_updated: counts.pages_updated ?? null,
      pages_unchanged: counts.pages_unchanged ?? null,
      pages_skipped: counts.pages_skipped ?? null,
      robots_disallowed_count: counts.robots_disallowed_count ?? null,
      error_count: counts.error_count ?? null,
      topics_extracted: counts.topics_extracted ?? null,
      candidates_created: counts.candidates_created ?? null,
      candidates_updated: counts.candidates_updated ?? null,
      gsc_rows_fetched: counts.gsc_rows_fetched ?? null,
      csv_rows_imported: counts.csv_rows_imported ?? null,
      duration_ms: counts.duration_ms ?? null,
      summary: toJson(summary),
    });
}

function insertImportJob(job, nowIso) {
  const conn = getDb();
  const result = conn
    .prepare(
      `INSERT INTO seo_import_jobs (job_type, source_file, status, rows_total, rows_imported, rows_updated, rows_skipped, rows_error, error_message, dry_run, started_at, finished_at, created_at)
       VALUES (:job_type, :source_file, :status, :rows_total, :rows_imported, :rows_updated, :rows_skipped, :rows_error, :error_message, :dry_run, :started_at, :finished_at, :created_at)`
    )
    .run({
      job_type: job.job_type,
      source_file: job.source_file || null,
      status: job.status,
      rows_total: job.rows_total ?? null,
      rows_imported: job.rows_imported ?? null,
      rows_updated: job.rows_updated ?? null,
      rows_skipped: job.rows_skipped ?? null,
      rows_error: job.rows_error ?? null,
      error_message: job.error_message || null,
      dry_run: job.dry_run ? 1 : 0,
      started_at: job.started_at || nowIso,
      finished_at: job.finished_at || null,
      created_at: nowIso,
    });
  return Number(result.lastInsertRowid);
}

// ---- seo_tasks (AI Growth Director) ----------------------------------------

function upsertTask(task, nowIso) {
  const conn = getDb();
  const key = {
    target_keyword: task.target_keyword,
    task_type: task.task_type,
    source_candidate_id: task.source_candidate_id ?? null,
    branch_id: task.branch_id ?? null,
  };
  const existing = conn
    .prepare(
      `SELECT id, status FROM seo_tasks WHERE target_keyword = :target_keyword
        AND task_type = :task_type AND source_candidate_id IS :source_candidate_id
        AND branch_id IS :branch_id`
    )
    .get(key);
  if (existing) {
    conn
      .prepare(
        `UPDATE seo_tasks SET
          target_url = :target_url, target_post_id = :target_post_id,
          target_page_type = :target_page_type, target_page_id = :target_page_id, target_page_name = :target_page_name,
          priority_score = :priority_score, opportunity_score = :opportunity_score,
          opportunity_breakdown = :opportunity_breakdown, estimated_effort_minutes = :estimated_effort_minutes,
          recommended_action = :recommended_action, reason = :reason,
          difficulty_score = :difficulty_score, difficulty_breakdown = :difficulty_breakdown,
          expected_impact_clicks = :expected_impact_clicks, expected_impact_cv = :expected_impact_cv,
          roi_priority_score = :roi_priority_score, roi_score_computed_at = :roi_score_computed_at,
          updated_at = :updated_at
        WHERE id = :id`
      )
      .run({
        id: existing.id,
        target_url: task.target_url || null,
        target_post_id: task.target_post_id ?? null,
        target_page_type: task.target_page_type || null,
        target_page_id: task.target_page_id || null,
        target_page_name: task.target_page_name || null,
        priority_score: task.priority_score ?? null,
        opportunity_score: task.opportunity_score,
        opportunity_breakdown: toJson(task.opportunity_breakdown),
        estimated_effort_minutes: task.estimated_effort_minutes ?? null,
        recommended_action: task.recommended_action,
        reason: toJson(task.reason),
        difficulty_score: task.difficulty_score ?? null,
        difficulty_breakdown: toJson(task.difficulty_breakdown),
        expected_impact_clicks: task.expected_impact_clicks ?? null,
        expected_impact_cv: task.expected_impact_cv ?? null,
        roi_priority_score: task.roi_priority_score ?? null,
        roi_score_computed_at: task.roi_score_computed_at ?? null,
        updated_at: nowIso,
      });
    return { id: existing.id, isNew: false, previousStatus: existing.status };
  }
  const result = conn
    .prepare(
      `INSERT INTO seo_tasks (
        task_type, target_url, target_post_id, target_page_type, target_page_id, target_page_name,
        target_keyword, source_candidate_id, branch_id,
        priority_score, opportunity_score, opportunity_breakdown, estimated_effort_minutes,
        recommended_action, reason, status,
        difficulty_score, difficulty_breakdown, expected_impact_clicks, expected_impact_cv,
        roi_priority_score, roi_score_computed_at,
        created_at, updated_at
      ) VALUES (
        :task_type, :target_url, :target_post_id, :target_page_type, :target_page_id, :target_page_name,
        :target_keyword, :source_candidate_id, :branch_id,
        :priority_score, :opportunity_score, :opportunity_breakdown, :estimated_effort_minutes,
        :recommended_action, :reason, :status,
        :difficulty_score, :difficulty_breakdown, :expected_impact_clicks, :expected_impact_cv,
        :roi_priority_score, :roi_score_computed_at,
        :created_at, :updated_at
      )`
    )
    .run({
      task_type: key.task_type,
      target_url: task.target_url || null,
      target_post_id: task.target_post_id ?? null,
      target_page_type: task.target_page_type || null,
      target_page_id: task.target_page_id || null,
      target_page_name: task.target_page_name || null,
      target_keyword: key.target_keyword,
      source_candidate_id: key.source_candidate_id,
      branch_id: key.branch_id,
      priority_score: task.priority_score ?? null,
      opportunity_score: task.opportunity_score,
      opportunity_breakdown: toJson(task.opportunity_breakdown),
      estimated_effort_minutes: task.estimated_effort_minutes ?? null,
      recommended_action: task.recommended_action,
      reason: toJson(task.reason),
      status: task.status || 'proposed',
      difficulty_score: task.difficulty_score ?? null,
      difficulty_breakdown: toJson(task.difficulty_breakdown),
      expected_impact_clicks: task.expected_impact_clicks ?? null,
      expected_impact_cv: task.expected_impact_cv ?? null,
      roi_priority_score: task.roi_priority_score ?? null,
      roi_score_computed_at: task.roi_score_computed_at ?? null,
      created_at: nowIso,
      updated_at: nowIso,
    });
  return { id: Number(result.lastInsertRowid), isNew: true, previousStatus: null };
}

function parseTaskJsonFields(row) {
  return {
    ...row,
    opportunity_breakdown: fromJson(row.opportunity_breakdown),
    reason: fromJson(row.reason),
    difficulty_breakdown: fromJson(row.difficulty_breakdown),
  };
}

function getTaskById(id) {
  const conn = getDb();
  const row = conn.prepare('SELECT * FROM seo_tasks WHERE id = ?').get(id);
  if (!row) return null;
  return parseTaskJsonFields(row);
}

function listTasks({ status, taskType, orderBy, branchId } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM seo_tasks WHERE 1=1';
  const params = {};
  if (branchId !== undefined && branchId !== null) {
    query += ' AND branch_id = :branch_id';
    params.branch_id = branchId;
  }
  if (status) {
    query += ' AND status = :status';
    params.status = status;
  }
  if (taskType) {
    query += ' AND task_type = :task_type';
    params.task_type = taskType;
  }
  const orderColumns = { opportunity_score: 'opportunity_score DESC', updated_at: 'updated_at DESC' };
  query += ` ORDER BY ${orderColumns[orderBy] || 'opportunity_score DESC'}`;
  return conn.prepare(query).all(params).map(parseTaskJsonFields);
}

// Sprint 1ではproposed/approved/rejectedのみを扱う(実行の自動化は行わない)。
function updateTaskStatus(id, toStatus, nowIso) {
  const conn = getDb();
  const current = conn.prepare('SELECT status FROM seo_tasks WHERE id = ?').get(id);
  if (!current) throw new Error(`updateTaskStatus: task id=${id} が見つかりません`);
  conn.prepare('UPDATE seo_tasks SET status = :status, updated_at = :updated_at WHERE id = :id').run({
    status: toStatus,
    updated_at: nowIso,
    id,
  });
  return { from: current.status, to: toStatus };
}

// ---- seo_page_plans (Sprint 3.4) -----------------------------------------
// seo_tasks(キーワード単位)とは別概念の「ページ単位の改善計画」。
// このテーブルへの保存はTask statusを一切変更しない(seo_tasksは削除・書き換えしない)。

// approved/reviewingは人間の判断が既に入っている(または入る過程にある)ため、
// 再生成CLIが内容を勝手に上書きしないようロックする。rejectedは内容を更新して構わないが、
// statusカラム自体は自動でproposedへ戻さない(UPDATE文でstatusを触らないことで担保する)。
// Sprint 3.7: staleも通常のupsertSeoPagePlan()からはロックする。stale化したPage Planの
// 内容更新は、専用のregenerateStaleSeoPagePlan()(stale→proposedの遷移込み)からのみ行う。
const PAGE_PLAN_LOCKED_STATUSES = new Set(['approved', 'reviewing', 'stale']);

function parsePagePlanJsonFields(row) {
  return {
    ...row,
    supporting_task_ids: fromJson(row.supporting_task_ids) || [],
    supporting_keywords: fromJson(row.supporting_keywords) || [],
    excluded_tasks: fromJson(row.excluded_tasks) || [],
    combined_search_intents: fromJson(row.combined_search_intents) || [],
    selection_breakdown: fromJson(row.selection_breakdown),
    fact_check_summary: fromJson(row.fact_check_summary),
    warnings: fromJson(row.warnings) || [],
  };
}

function getSeoPagePlanById(id) {
  const conn = getDb();
  const row = conn.prepare('SELECT * FROM seo_page_plans WHERE id = ?').get(id);
  if (!row) return null;
  return parsePagePlanJsonFields(row);
}

function getSeoPagePlanByPage(targetPageType, targetPageId, branchId) {
  const conn = getDb();
  const row = conn
    .prepare('SELECT * FROM seo_page_plans WHERE target_page_type = ? AND target_page_id = ? AND branch_id IS ?')
    .get(targetPageType, targetPageId, branchId ?? null);
  if (!row) return null;
  return parsePagePlanJsonFields(row);
}

function listSeoPagePlans({ status, branchId } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM seo_page_plans WHERE 1=1';
  const params = {};
  if (branchId !== undefined && branchId !== null) {
    query += ' AND branch_id = :branch_id';
    params.branch_id = branchId;
  }
  if (status) {
    query += ' AND status = :status';
    params.status = status;
  }
  query += ' ORDER BY updated_at DESC';
  return conn.prepare(query).all(params).map(parsePagePlanJsonFields);
}

// plan: scripts/lib/seo/page_plan_builder.jsのbuildPagePlan()が返す形(camelCase)。
// UNIQUE(target_page_type, target_page_id)でupsertする。
// 既存Planがapproved/reviewingの場合は内容を更新せず、{locked:true}を返す(例外は投げない。
// 呼び出し側が"plan_locked_status"として扱えるようにするため)。--forceは今回未実装。
function upsertSeoPagePlan(plan, nowIso) {
  const shapeCheck = validatePagePlanShape(plan);
  if (!shapeCheck.valid) {
    throw new Error(`upsertSeoPagePlan: 不正なPage Planです - ${shapeCheck.errors.join(' / ')}`);
  }

  const conn = getDb();
  const primaryTaskRow = conn.prepare('SELECT id FROM seo_tasks WHERE id = ?').get(plan.primaryTaskId);
  if (!primaryTaskRow) {
    throw new Error(`upsertSeoPagePlan: primary_task_id=${plan.primaryTaskId} に該当するseo_tasksが存在しません`);
  }

  const existing = conn
    .prepare('SELECT id, status FROM seo_page_plans WHERE target_page_type = ? AND target_page_id = ? AND branch_id IS ?')
    .get(plan.targetPageType, plan.targetPageId, plan.branchId ?? null);

  if (existing && PAGE_PLAN_LOCKED_STATUSES.has(existing.status)) {
    return { id: existing.id, isNew: false, locked: true, lockedStatus: existing.status };
  }

  const row = {
    group_key: plan.groupKey,
    target_page_type: plan.targetPageType,
    target_page_id: plan.targetPageId,
    branch_id: plan.branchId ?? null,
    target_page_name: plan.targetPageName || null,
    target_url: plan.targetUrl || null,
    primary_task_id: plan.primaryTaskId,
    primary_keyword: plan.primaryKeyword,
    supporting_task_ids: toJson(plan.supportingTaskIds || []),
    supporting_keywords: toJson(plan.supportingKeywords || []),
    excluded_tasks: toJson(plan.excludedTasks || []),
    combined_search_intents: toJson(plan.combinedSearchIntents || []),
    selection_breakdown: toJson(plan.selectionBreakdown || null),
    fact_check_summary: toJson(plan.factCheckSummary || null),
    warnings: toJson(plan.warnings || []),
    source_content_hash: plan.sourceContentHash || null,
    prompt_version: plan.promptVersion || null,
  };

  if (existing) {
    // statusカラムはここで一切触れない(rejectedはrejectedのまま、proposedはproposedのまま維持)。
    conn
      .prepare(
        `UPDATE seo_page_plans SET
          group_key = :group_key, target_page_name = :target_page_name, target_url = :target_url,
          primary_task_id = :primary_task_id, primary_keyword = :primary_keyword,
          supporting_task_ids = :supporting_task_ids, supporting_keywords = :supporting_keywords,
          excluded_tasks = :excluded_tasks, combined_search_intents = :combined_search_intents,
          selection_breakdown = :selection_breakdown, fact_check_summary = :fact_check_summary,
          warnings = :warnings, source_content_hash = :source_content_hash, prompt_version = :prompt_version,
          updated_at = :updated_at
        WHERE id = :id`
      )
      .run({
        group_key: row.group_key,
        target_page_name: row.target_page_name,
        target_url: row.target_url,
        primary_task_id: row.primary_task_id,
        primary_keyword: row.primary_keyword,
        supporting_task_ids: row.supporting_task_ids,
        supporting_keywords: row.supporting_keywords,
        excluded_tasks: row.excluded_tasks,
        combined_search_intents: row.combined_search_intents,
        selection_breakdown: row.selection_breakdown,
        fact_check_summary: row.fact_check_summary,
        warnings: row.warnings,
        source_content_hash: row.source_content_hash,
        prompt_version: row.prompt_version,
        id: existing.id,
        updated_at: nowIso,
      });
    return { id: existing.id, isNew: false, locked: false, previousStatus: existing.status };
  }

  const result = conn
    .prepare(
      `INSERT INTO seo_page_plans (
        group_key, target_page_type, target_page_id, branch_id, target_page_name, target_url,
        primary_task_id, primary_keyword, supporting_task_ids, supporting_keywords,
        excluded_tasks, combined_search_intents, selection_breakdown, fact_check_summary,
        warnings, source_content_hash, prompt_version, status, created_at, updated_at
      ) VALUES (
        :group_key, :target_page_type, :target_page_id, :branch_id, :target_page_name, :target_url,
        :primary_task_id, :primary_keyword, :supporting_task_ids, :supporting_keywords,
        :excluded_tasks, :combined_search_intents, :selection_breakdown, :fact_check_summary,
        :warnings, :source_content_hash, :prompt_version, :status, :created_at, :updated_at
      )`
    )
    .run({ ...row, status: plan.status || 'proposed', created_at: nowIso, updated_at: nowIso });
  return { id: Number(result.lastInsertRowid), isNew: true, locked: false, previousStatus: null };
}

function updateSeoPagePlanStatus(id, toStatus, nowIso) {
  if (!ALLOWED_PAGE_PLAN_STATUSES.has(toStatus)) {
    throw new Error(`updateSeoPagePlanStatus: 不正なstatusです: ${toStatus}`);
  }
  const conn = getDb();
  const current = conn.prepare('SELECT status FROM seo_page_plans WHERE id = ?').get(id);
  if (!current) throw new Error(`updateSeoPagePlanStatus: page plan id=${id} が見つかりません`);
  conn.prepare('UPDATE seo_page_plans SET status = :status, updated_at = :updated_at WHERE id = :id').run({
    status: toStatus,
    updated_at: nowIso,
    id,
  });
  return { from: current.status, to: toStatus };
}

function deleteSeoPagePlan(id) {
  const conn = getDb();
  const result = conn.prepare('DELETE FROM seo_page_plans WHERE id = ?').run(id);
  return { deleted: result.changes > 0 };
}

// ---- seo_page_plan_reviews (Sprint 3.5: Page Plan人間レビュー) -----------
// updateSeoPagePlanStatus()は既存の単純なstatus更新(内部・テスト用、履歴を残さない)。
// 正式な人間レビューによるstatus変更は必ずtransitionSeoPagePlanStatus()を使うこと
// (状態遷移バリデーション+履歴INSERTを同一トランザクションで行う)。

function parsePagePlanReviewJsonFields(row) {
  return { ...row, metadata: fromJson(row.metadata) || {} };
}

function listSeoPagePlanReviews(pagePlanId) {
  const conn = getDb();
  return conn
    .prepare('SELECT * FROM seo_page_plan_reviews WHERE page_plan_id = ? ORDER BY id ASC')
    .all(pagePlanId)
    .map(parsePagePlanReviewJsonFields);
}

function getLatestSeoPagePlanReview(pagePlanId) {
  const conn = getDb();
  const row = conn
    .prepare('SELECT * FROM seo_page_plan_reviews WHERE page_plan_id = ? ORDER BY id DESC LIMIT 1')
    .get(pagePlanId);
  return row ? parsePagePlanReviewJsonFields(row) : null;
}

// Page Planのstatusを人間レビュー操作として変更し、同一トランザクションで
// seo_page_plan_reviewsへ履歴を1行追加する。
//   - expectedCurrentStatusとDB上の現在statusが異なる場合はpage_plan_status_conflictエラー
//     (err.code='page_plan_status_conflict')
//   - 状態遷移・actor/reasonのバリデーション(page_plan_review.js)に失敗した場合は
//     invalid_transitionエラー(err.code='invalid_transition')
//   - 対象Page Planが存在しない場合はnot_foundエラー(err.code='not_found')
//   - 上記いずれの場合もDBは一切変更されない(ROLLBACK)
// seo_tasksへは一切書き込まない(Task statusはこの関数の対象外)。
function transitionSeoPagePlanStatus({ pagePlanId, expectedCurrentStatus, nextStatus, actor, reason, source }, nowIso) {
  if (!ALLOWED_REVIEW_SOURCES.has(source)) {
    throw new Error(`transitionSeoPagePlanStatus: 不正なsourceです: ${source}`);
  }

  const conn = getDb();
  conn.exec('BEGIN');
  let current;
  try {
    current = conn.prepare('SELECT id, status FROM seo_page_plans WHERE id = ?').get(pagePlanId);
    if (!current) {
      throw Object.assign(new Error(`transitionSeoPagePlanStatus: page plan id=${pagePlanId} が見つかりません`), {
        code: 'not_found',
      });
    }
    if (current.status !== expectedCurrentStatus) {
      throw Object.assign(new Error('page_plan_status_conflict'), {
        code: 'page_plan_status_conflict',
        actualStatus: current.status,
      });
    }

    const validation = validatePagePlanTransition({ currentStatus: current.status, nextStatus, actor, reason });
    if (!validation.valid) {
      throw Object.assign(new Error(`transitionSeoPagePlanStatus: 不正な状態遷移です - ${validation.errors.join(' / ')}`), {
        code: 'invalid_transition',
        errors: validation.errors,
      });
    }

    conn.prepare('UPDATE seo_page_plans SET status = :status, updated_at = :updated_at WHERE id = :id').run({
      status: nextStatus,
      updated_at: nowIso,
      id: pagePlanId,
    });

    conn
      .prepare(
        `INSERT INTO seo_page_plan_reviews (
          page_plan_id, from_status, to_status, actor, reason, source, metadata, created_at
        ) VALUES (
          :page_plan_id, :from_status, :to_status, :actor, :reason, :source, :metadata, :created_at
        )`
      )
      .run({
        page_plan_id: pagePlanId,
        from_status: current.status,
        to_status: nextStatus,
        actor,
        reason: reason || null,
        source,
        metadata: toJson({}),
        created_at: nowIso,
      });

    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }

  return {
    pagePlanId,
    from: current.status,
    to: nextStatus,
    review: getLatestSeoPagePlanReview(pagePlanId),
  };
}

// Sprint 3.7: stale化したPage Planを、最新のPage Plan内容(regeneratedPlan、
// scripts/lib/seo/stale_page_plan_regenerator.jsのregeneratePagePlanContent()相当)で
// 更新し、status=proposedへ復帰させる。1つのトランザクションで
//   (a) 現在status → stale への遷移 + 履歴INSERT(previousContentHash/currentContentHash/
//       staleReasonをmetadataへ保存)
//   (b) 同じPage Plan行の内容(Primary/Supporting/Excluded/selection_breakdown/
//       fact_check_summary/source_content_hash等)をUPDATE
//   (c) stale → proposed への遷移 + 履歴INSERT
// を行う。途中で失敗した場合はすべてROLLBACKし、DBは一切変更されない。
// 短期案(Sprint 3.7)ではPage Planのバージョン管理は行わず、同じ行を上書きする
// (承認時点のPrimary/Supporting/Excluded等の内容はPage Plan行上には残らない。
// status遷移履歴のみがseo_page_plan_reviewsへ残る。詳細はdocs/growth_director.md参照)。
//   - Page Plan不存在: not_foundエラー(err.code='not_found')
//   - expectedCurrentStatusとDB上の現在statusが異なる: page_plan_status_conflict
//   - expectedUpdatedAtとDB上のupdated_atが異なる(再生成準備中に他の変更が入った):
//     page_plan_changed_during_regeneration
//   - 状態遷移・actor/reasonのバリデーションに失敗: invalid_transition
//   - regeneratedPlanの形状が不正: 例外を投げる(呼び出し前にshape validationを行う)
// seo_tasks/seo_keyword_candidatesへは一切書き込まない。
function regenerateStaleSeoPagePlan(
  { pagePlanId, expectedCurrentStatus, expectedUpdatedAt, actor, reason, staleMetadata, regeneratedPlan },
  nowIso
) {
  const shapeCheck = validatePagePlanShape(regeneratedPlan);
  if (!shapeCheck.valid) {
    throw new Error(`regenerateStaleSeoPagePlan: 不正なPage Planです - ${shapeCheck.errors.join(' / ')}`);
  }

  const conn = getDb();
  conn.exec('BEGIN');
  let current;
  try {
    current = conn.prepare('SELECT * FROM seo_page_plans WHERE id = ?').get(pagePlanId);
    if (!current) {
      throw Object.assign(new Error(`regenerateStaleSeoPagePlan: page plan id=${pagePlanId} が見つかりません`), {
        code: 'not_found',
      });
    }
    if (current.status !== expectedCurrentStatus) {
      throw Object.assign(new Error('page_plan_status_conflict'), {
        code: 'page_plan_status_conflict',
        actualStatus: current.status,
      });
    }
    if (current.updated_at !== expectedUpdatedAt) {
      throw Object.assign(new Error('page_plan_changed_during_regeneration'), {
        code: 'page_plan_changed_during_regeneration',
      });
    }

    // (a) current → stale
    const toStaleValidation = validatePagePlanTransition({ currentStatus: current.status, nextStatus: 'stale', actor, reason });
    if (!toStaleValidation.valid) {
      throw Object.assign(
        new Error(`regenerateStaleSeoPagePlan: staleへの遷移が不正です - ${toStaleValidation.errors.join(' / ')}`),
        { code: 'invalid_transition', errors: toStaleValidation.errors }
      );
    }

    conn.prepare('UPDATE seo_page_plans SET status = :status, updated_at = :updated_at WHERE id = :id').run({
      status: 'stale',
      updated_at: nowIso,
      id: pagePlanId,
    });
    conn
      .prepare(
        `INSERT INTO seo_page_plan_reviews (
          page_plan_id, from_status, to_status, actor, reason, source, metadata, created_at
        ) VALUES (
          :page_plan_id, :from_status, :to_status, :actor, :reason, :source, :metadata, :created_at
        )`
      )
      .run({
        page_plan_id: pagePlanId,
        from_status: current.status,
        to_status: 'stale',
        actor,
        reason,
        source: 'cli',
        metadata: toJson(staleMetadata || {}),
        created_at: nowIso,
      });

    // (b) 内容UPDATE(このリビジョンではstatusには触れない。created_atも維持)
    conn
      .prepare(
        `UPDATE seo_page_plans SET
          group_key = :group_key, target_page_name = :target_page_name, target_url = :target_url,
          primary_task_id = :primary_task_id, primary_keyword = :primary_keyword,
          supporting_task_ids = :supporting_task_ids, supporting_keywords = :supporting_keywords,
          excluded_tasks = :excluded_tasks, combined_search_intents = :combined_search_intents,
          selection_breakdown = :selection_breakdown, fact_check_summary = :fact_check_summary,
          warnings = :warnings, source_content_hash = :source_content_hash, prompt_version = :prompt_version,
          updated_at = :updated_at
        WHERE id = :id`
      )
      .run({
        group_key: regeneratedPlan.groupKey,
        target_page_name: regeneratedPlan.targetPageName || null,
        target_url: regeneratedPlan.targetUrl || null,
        primary_task_id: regeneratedPlan.primaryTaskId,
        primary_keyword: regeneratedPlan.primaryKeyword,
        supporting_task_ids: toJson(regeneratedPlan.supportingTaskIds || []),
        supporting_keywords: toJson(regeneratedPlan.supportingKeywords || []),
        excluded_tasks: toJson(regeneratedPlan.excludedTasks || []),
        combined_search_intents: toJson(regeneratedPlan.combinedSearchIntents || []),
        selection_breakdown: toJson(regeneratedPlan.selectionBreakdown || null),
        fact_check_summary: toJson(regeneratedPlan.factCheckSummary || null),
        warnings: toJson(regeneratedPlan.warnings || []),
        source_content_hash: regeneratedPlan.sourceContentHash || null,
        prompt_version: regeneratedPlan.promptVersion || null,
        updated_at: nowIso,
        id: pagePlanId,
      });

    // (c) stale → proposed(再レビューのため必ずproposedへ戻す。reviewing/approvedへの
    // 直接遷移はALLOWED_TRANSITIONSで許可していない)
    const proposedReason = '最新ページ本文により内容を再計算し、再レビューのためproposedへ復帰';
    const toProposedValidation = validatePagePlanTransition({
      currentStatus: 'stale',
      nextStatus: 'proposed',
      actor,
      reason: proposedReason,
    });
    if (!toProposedValidation.valid) {
      throw Object.assign(
        new Error(`regenerateStaleSeoPagePlan: proposedへの復帰が不正です - ${toProposedValidation.errors.join(' / ')}`),
        { code: 'invalid_transition', errors: toProposedValidation.errors }
      );
    }

    conn.prepare('UPDATE seo_page_plans SET status = :status, updated_at = :updated_at WHERE id = :id').run({
      status: 'proposed',
      updated_at: nowIso,
      id: pagePlanId,
    });
    conn
      .prepare(
        `INSERT INTO seo_page_plan_reviews (
          page_plan_id, from_status, to_status, actor, reason, source, metadata, created_at
        ) VALUES (
          :page_plan_id, :from_status, :to_status, :actor, :reason, :source, :metadata, :created_at
        )`
      )
      .run({
        page_plan_id: pagePlanId,
        from_status: 'stale',
        to_status: 'proposed',
        actor,
        reason: proposedReason,
        source: 'cli',
        metadata: toJson({}),
        created_at: nowIso,
      });

    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }

  return {
    pagePlanId,
    finalStatus: 'proposed',
    plan: getSeoPagePlanById(pagePlanId),
    reviews: listSeoPagePlanReviews(pagePlanId).slice(-2),
  };
}

// ---- seo_page_drafts (Sprint 3.6: approved Page Planから生成した統合Draft) ----------
// Draftは常にINSERT(upsertしない)。1 Page Planにつき複数世代のDraftを履歴として保持する。
// 保存してもseo_page_plans/seo_tasksのstatusは一切変更しない。

function parsePageDraftJsonFields(row) {
  return {
    ...row,
    covered_task_ids: fromJson(row.covered_task_ids) || [],
    covered_keywords: fromJson(row.covered_keywords) || [],
    excluded_task_ids: fromJson(row.excluded_task_ids) || [],
    excluded_intents: fromJson(row.excluded_intents) || [],
    warnings: fromJson(row.warnings) || [],
    validation_result: fromJson(row.validation_result),
  };
}

function getSeoPageDraftById(id) {
  const conn = getDb();
  const row = conn.prepare('SELECT * FROM seo_page_drafts WHERE id = ?').get(id);
  return row ? parsePageDraftJsonFields(row) : null;
}

function getLatestSeoPageDraftByPlan(pagePlanId) {
  const conn = getDb();
  const row = conn
    .prepare('SELECT * FROM seo_page_drafts WHERE page_plan_id = ? ORDER BY draft_version DESC LIMIT 1')
    .get(pagePlanId);
  return row ? parsePageDraftJsonFields(row) : null;
}

function listSeoPageDrafts({ pagePlanId, status } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM seo_page_drafts WHERE 1=1';
  const params = {};
  if (pagePlanId) {
    query += ' AND page_plan_id = :page_plan_id';
    params.page_plan_id = pagePlanId;
  }
  if (status) {
    query += ' AND status = :status';
    params.status = status;
  }
  query += ' ORDER BY page_plan_id ASC, draft_version ASC';
  return conn.prepare(query).all(params).map(parsePageDraftJsonFields);
}

// Page Planごとに1から連番になる次のdraft_versionを返す(既存Draftが無ければ1)。
// 最終的な一意性の担保はUNIQUE(page_plan_id, draft_version)制約が行う
// (この関数はあくまで「次の番号の目安」を返すヘルパー)。
function getNextSeoPageDraftVersion(pagePlanId) {
  const conn = getDb();
  const row = conn.prepare('SELECT MAX(draft_version) as maxVersion FROM seo_page_drafts WHERE page_plan_id = ?').get(pagePlanId);
  return (row && row.maxVersion ? row.maxVersion : 0) + 1;
}

// draft: scripts/lib/seo/page_draft_builder.jsのbuildPageDraft()が返す形(camelCase)。
// 保存直前に、DB上の現在のPage Planを再取得して以下を確認する(いずれか不一致なら保存拒否):
//   - status === 'approved'                          不一致 → page_plan_not_approved
//   - updated_at === draft.pagePlanUpdatedAt          不一致 → page_plan_changed_during_generation
//   - source_content_hash === draft.sourceContentHash 不一致 → page_plan_content_stale
// UNIQUE(page_plan_id, draft_version)により、同一version番号の重複挿入はDBレベルで拒否される。
function insertSeoPageDraft(draft, nowIso) {
  const shapeCheck = validatePageDraftShape(draft);
  if (!shapeCheck.valid) {
    throw new Error(`insertSeoPageDraft: 不正なPage Draftです - ${shapeCheck.errors.join(' / ')}`);
  }

  const conn = getDb();
  const plan = conn.prepare('SELECT status, updated_at, source_content_hash FROM seo_page_plans WHERE id = ?').get(draft.pagePlanId);
  if (!plan) {
    throw Object.assign(new Error(`insertSeoPageDraft: page plan id=${draft.pagePlanId} が見つかりません`), { code: 'not_found' });
  }
  if (plan.status !== 'approved') {
    throw Object.assign(new Error('page_plan_not_approved'), { code: 'page_plan_not_approved', actualStatus: plan.status });
  }
  if (plan.updated_at !== draft.pagePlanUpdatedAt) {
    throw Object.assign(new Error('page_plan_changed_during_generation'), { code: 'page_plan_changed_during_generation' });
  }
  if ((plan.source_content_hash || null) !== (draft.sourceContentHash || null)) {
    throw Object.assign(new Error('page_plan_content_stale'), { code: 'page_plan_content_stale' });
  }

  const result = conn
    .prepare(
      `INSERT INTO seo_page_drafts (
        page_plan_id, draft_version, draft_type, summary, suggested_location, generated_text,
        change_reason, search_intent_alignment, covered_task_ids, covered_keywords,
        excluded_task_ids, excluded_intents, warnings, prompt_snapshot, prompt_version,
        generator, model, source_content_hash, page_plan_updated_at, validation_result,
        validation_status, status, edited_text, generated_at, updated_at
      ) VALUES (
        :page_plan_id, :draft_version, :draft_type, :summary, :suggested_location, :generated_text,
        :change_reason, :search_intent_alignment, :covered_task_ids, :covered_keywords,
        :excluded_task_ids, :excluded_intents, :warnings, :prompt_snapshot, :prompt_version,
        :generator, :model, :source_content_hash, :page_plan_updated_at, :validation_result,
        :validation_status, :status, :edited_text, :generated_at, :updated_at
      )`
    )
    .run({
      page_plan_id: draft.pagePlanId,
      draft_version: draft.draftVersion,
      draft_type: draft.draftType || 'page_improvement',
      summary: draft.summary,
      suggested_location: draft.suggestedLocation,
      generated_text: draft.generatedText,
      change_reason: draft.changeReason,
      search_intent_alignment: draft.searchIntentAlignment,
      covered_task_ids: toJson(draft.coveredTaskIds || []),
      covered_keywords: toJson(draft.coveredKeywords || []),
      excluded_task_ids: toJson(draft.excludedTaskIds || []),
      excluded_intents: toJson(draft.excludedIntents || []),
      warnings: toJson(draft.warnings || []),
      prompt_snapshot: draft.promptSnapshot,
      prompt_version: draft.promptVersion,
      generator: draft.generator,
      model: draft.model || null,
      source_content_hash: draft.sourceContentHash || null,
      page_plan_updated_at: draft.pagePlanUpdatedAt,
      validation_result: toJson(draft.validationResult),
      validation_status: draft.validationStatus,
      status: draft.status || 'generated',
      edited_text: draft.editedText || null,
      generated_at: nowIso,
      updated_at: nowIso,
    });

  return { id: Number(result.lastInsertRowid), draftVersion: draft.draftVersion };
}

// ---- seo_weekly_recommendations (Sprint 3.9: AI Weekly Director) ---------
// 週(batch_date=月曜日)ごとに1行。approved/archivedになった週次バンドルは
// upsertSeoPagePlanのPAGE_PLAN_LOCKED_STATUSESと同じ考え方でロックし、
// 再実行による意図しない上書きを防ぐ(status='proposed'の間のみ上書き可能)。

const WEEKLY_RECOMMENDATION_LOCKED_STATUSES = new Set(['approved', 'archived']);

function parseWeeklyRecommendationJsonFields(row) {
  return {
    ...row,
    task_ids: fromJson(row.task_ids) || [],
    items: fromJson(row.items) || [],
    task_type_breakdown: fromJson(row.task_type_breakdown) || {},
    curation_params: fromJson(row.curation_params) || {},
  };
}

function getWeeklyRecommendation(batchDate, branchId) {
  const conn = getDb();
  const row = conn
    .prepare('SELECT * FROM seo_weekly_recommendations WHERE batch_date = ? AND branch_id IS ?')
    .get(batchDate, branchId ?? null);
  return row ? parseWeeklyRecommendationJsonFields(row) : null;
}

// rec: { batchDate, status, taskIds, items, totalExpectedCv, totalEffortMinutes,
//        taskTypeBreakdown, curationTier, curationParams }(camelCase)。
// 既存行がapproved/archivedの場合は上書きせず{locked:true}を返す(例外は投げない、
// upsertSeoPagePlanと同じ設計)。1つのトランザクション内でSELECT→INSERT/UPDATEを行う。
function upsertWeeklyRecommendation(rec, nowIso) {
  const conn = getDb();
  conn.exec('BEGIN');
  try {
    const existing = conn
      .prepare('SELECT id, status FROM seo_weekly_recommendations WHERE batch_date = ? AND branch_id IS ?')
      .get(rec.batchDate, rec.branchId ?? null);

    if (existing && WEEKLY_RECOMMENDATION_LOCKED_STATUSES.has(existing.status)) {
      conn.exec('COMMIT');
      return { id: existing.id, isNew: false, locked: true, lockedStatus: existing.status };
    }

    const row = {
      branch_id: rec.branchId ?? null,
      task_ids: toJson(rec.taskIds || []),
      items: toJson(rec.items || []),
      total_expected_cv: rec.totalExpectedCv ?? null,
      total_effort_minutes: rec.totalEffortMinutes ?? null,
      task_type_breakdown: toJson(rec.taskTypeBreakdown || {}),
      curation_tier: rec.curationTier || null,
      curation_params: toJson(rec.curationParams || {}),
    };

    if (existing) {
      // branch_idは既存行の作成時に固定される値のため更新対象に含めない
      // (node:sqliteは未参照の名前付きパラメータをエラーにするため明示的に除外する)。
      const { branch_id: _unusedBranchId, ...updateParams } = row;
      conn
        .prepare(
          `UPDATE seo_weekly_recommendations SET
            task_ids = :task_ids, items = :items, total_expected_cv = :total_expected_cv,
            total_effort_minutes = :total_effort_minutes, task_type_breakdown = :task_type_breakdown,
            curation_tier = :curation_tier, curation_params = :curation_params, updated_at = :updated_at
          WHERE id = :id`
        )
        .run({ ...updateParams, id: existing.id, updated_at: nowIso });
      conn.exec('COMMIT');
      return { id: existing.id, isNew: false, locked: false };
    }

    const result = conn
      .prepare(
        `INSERT INTO seo_weekly_recommendations (
          branch_id, batch_date, status, task_ids, items, total_expected_cv, total_effort_minutes,
          task_type_breakdown, curation_tier, curation_params, created_at, updated_at
        ) VALUES (
          :branch_id, :batch_date, :status, :task_ids, :items, :total_expected_cv, :total_effort_minutes,
          :task_type_breakdown, :curation_tier, :curation_params, :created_at, :updated_at
        )`
      )
      .run({ ...row, batch_date: rec.batchDate, status: rec.status || 'proposed', created_at: nowIso, updated_at: nowIso });
    conn.exec('COMMIT');
    return { id: Number(result.lastInsertRowid), isNew: true, locked: false };
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

// batch_date降順で最新の週次バンドルを1件取得する(Sprint 4.0: ダッシュボードが
// 今週分未生成時にフォールバック表示するために使う)。
function getLatestWeeklyRecommendation(branchId) {
  const conn = getDb();
  const row =
    branchId !== undefined && branchId !== null
      ? conn
          .prepare('SELECT * FROM seo_weekly_recommendations WHERE branch_id = ? ORDER BY batch_date DESC LIMIT 1')
          .get(branchId)
      : conn.prepare('SELECT * FROM seo_weekly_recommendations ORDER BY batch_date DESC LIMIT 1').get();
  return row ? parseWeeklyRecommendationJsonFields(row) : null;
}

// Sprint 4.0: 週次バンドルの状態遷移(ダッシュボードの承認ボタンから使用)。
// transitionSeoPagePlanStatusと同じ楽観的並行性チェック(expectedCurrentStatus)を
// トランザクション内で行うが、レビュー履歴テーブルは今回新設せず、statusカラムの
// 直接UPDATEのみに留める(スコープ最小化)。
const WEEKLY_RECOMMENDATION_ALLOWED_TRANSITIONS = {
  proposed: new Set(['approved', 'rejected']),
  approved: new Set(['archived']),
};

function transitionWeeklyRecommendationStatus({ batchDate, expectedCurrentStatus, nextStatus, branchId }, nowIso) {
  const conn = getDb();
  conn.exec('BEGIN');
  let current;
  try {
    current = conn
      .prepare('SELECT id, status FROM seo_weekly_recommendations WHERE batch_date = ? AND branch_id IS ?')
      .get(batchDate, branchId ?? null);
    if (!current) {
      throw Object.assign(new Error(`transitionWeeklyRecommendationStatus: batch_date=${batchDate} が見つかりません`), {
        code: 'not_found',
      });
    }
    if (current.status !== expectedCurrentStatus) {
      throw Object.assign(new Error('weekly_recommendation_status_conflict'), {
        code: 'status_conflict',
        actualStatus: current.status,
      });
    }

    const allowedNext = WEEKLY_RECOMMENDATION_ALLOWED_TRANSITIONS[current.status];
    if (!allowedNext || !allowedNext.has(nextStatus)) {
      throw Object.assign(new Error(`transitionWeeklyRecommendationStatus: 不正な状態遷移です(${current.status} → ${nextStatus})`), {
        code: 'invalid_transition',
      });
    }

    conn.prepare('UPDATE seo_weekly_recommendations SET status = :status, updated_at = :updated_at WHERE id = :id').run({
      status: nextStatus,
      updated_at: nowIso,
      id: current.id,
    });

    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }

  return { batchDate, from: current.status, to: nextStatus };
}

// Sprint 4.1: 自律パブリッシュバッチ(scripts/seo_publisher.js)用。
// statusが'approved'の週次バンドルのうち、batch_date降順で最新の1件を取得する。
function getLatestApprovedWeeklyRecommendation(branchId) {
  const conn = getDb();
  const row =
    branchId !== undefined && branchId !== null
      ? conn
          .prepare(
            "SELECT * FROM seo_weekly_recommendations WHERE status = 'approved' AND branch_id = ? ORDER BY batch_date DESC LIMIT 1"
          )
          .get(branchId)
      : conn
          .prepare("SELECT * FROM seo_weekly_recommendations WHERE status = 'approved' ORDER BY batch_date DESC LIMIT 1")
          .get();
  return row ? parseWeeklyRecommendationJsonFields(row) : null;
}

// items(JSON配列)内の該当taskIdの要素へ、WordPress投稿結果を安全に書き戻す。
// 既にwpPostIdが設定済みの場合は何もせず{skipped:true}を返す(二重投稿防止の
// 最終防衛ライン。呼び出し側がWordPress API呼び出し前にもチェックする想定だが、
// 実際にDBへ書き込む直前にもう一度この関数内で確認することで、万一チェックと
// 書き込みの間に別プロセスが同じタスクを処理していた場合の二重記録を防ぐ)。
function markWeeklyRecommendationItemPublished(batchDate, taskId, { wpPostId, draftStatus, branchId }, nowIso) {
  const conn = getDb();
  conn.exec('BEGIN');
  try {
    const row = conn
      .prepare('SELECT id, items FROM seo_weekly_recommendations WHERE batch_date = ? AND branch_id IS ?')
      .get(batchDate, branchId ?? null);
    if (!row) {
      throw Object.assign(new Error(`markWeeklyRecommendationItemPublished: batch_date=${batchDate} が見つかりません`), {
        code: 'not_found',
      });
    }

    const items = fromJson(row.items) || [];
    const index = items.findIndex((item) => item.taskId === taskId);
    if (index === -1) {
      throw Object.assign(new Error(`markWeeklyRecommendationItemPublished: taskId=${taskId} がitems内に見つかりません`), {
        code: 'task_not_in_bundle',
      });
    }

    if (items[index].wpPostId) {
      conn.exec('COMMIT');
      return { skipped: true, reason: 'already_published', wpPostId: items[index].wpPostId };
    }

    items[index] = { ...items[index], wpPostId, draftStatus };
    conn
      .prepare('UPDATE seo_weekly_recommendations SET items = :items, updated_at = :updated_at WHERE id = :id')
      .run({ items: toJson(items), updated_at: nowIso, id: row.id });

    conn.exec('COMMIT');
    return { skipped: false, wpPostId, draftStatus };
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  upsertCompetitor,
  getCompetitor,
  listCompetitors,
  recordCompetitorCrawlSuccess,
  recordCompetitorCrawlError,
  getCompetitorPage,
  upsertCompetitorPage,
  replacePageHeadings,
  listPageHeadings,
  listPagesNeedingAnalysis,
  markPageAnalyzed,
  countAnalyzedCompetitors,
  upsertTopic,
  upsertPageTopic,
  listTopicsForPage,
  listTopicCoverage,
  upsertCompoundKeyword,
  upsertPageCompoundKeyword,
  listCompoundKeywordCoverage,
  upsertGscQueryRow,
  listGscQueriesForKeyword,
  getGscAggregateForKeyword,
  getGscPagesForQuery,
  upsertKeywordMetric,
  getKeywordMetric,
  upsertSerpRanking,
  listSerpRankingsForKeyword,
  getCompetitorBestPosition,
  getKeywordDemand,
  upsertKeywordCandidate,
  getKeywordCandidateById,
  listKeywordCandidates,
  updateCandidateStatus,
  listCandidateStatusHistory,
  insertCandidateEvidence,
  listCandidateEvidence,
  upsertCandidateExistingArticle,
  listCandidateExistingArticles,
  getRunningAnalysisRun,
  createAnalysisRun,
  finishAnalysisRun,
  insertImportJob,
  upsertTask,
  getTaskById,
  listTasks,
  updateTaskStatus,
  getSeoPagePlanById,
  getSeoPagePlanByPage,
  listSeoPagePlans,
  upsertSeoPagePlan,
  updateSeoPagePlanStatus,
  deleteSeoPagePlan,
  PAGE_PLAN_LOCKED_STATUSES,
  listSeoPagePlanReviews,
  getLatestSeoPagePlanReview,
  transitionSeoPagePlanStatus,
  regenerateStaleSeoPagePlan,
  getSeoPageDraftById,
  getLatestSeoPageDraftByPlan,
  listSeoPageDrafts,
  getNextSeoPageDraftVersion,
  insertSeoPageDraft,
  getWeeklyRecommendation,
  getLatestWeeklyRecommendation,
  getLatestApprovedWeeklyRecommendation,
  upsertWeeklyRecommendation,
  transitionWeeklyRecommendationStatus,
  markWeeklyRecommendationItemPublished,
  WEEKLY_RECOMMENDATION_LOCKED_STATUSES,
  WEEKLY_RECOMMENDATION_ALLOWED_TRANSITIONS,
};
