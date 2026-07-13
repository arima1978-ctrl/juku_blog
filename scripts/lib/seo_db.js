'use strict';

// 競合キーワード分析(Keyword Gap Lite)専用のDBアクセス層。
// db.jsを肥大化させないよう分離するが、接続自体はdb.jsのgetDb()を共有する
// (posts.sqliteに相乗りし、posts/seo_*テーブル間のJOINを可能にするため)。
const { getDb } = require('./db');

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
        id, name, domain, start_url, sitemap_url, competitor_type,
        target_areas, target_schools, target_grades, target_subjects,
        crawl_enabled, crawl_interval_days, max_pages, created_at, updated_at
      ) VALUES (
        :id, :name, :domain, :start_url, :sitemap_url, :competitor_type,
        :target_areas, :target_schools, :target_grades, :target_subjects,
        :crawl_enabled, :crawl_interval_days, :max_pages, :created_at, :updated_at
      )`
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
      created_at: nowIso,
      updated_at: nowIso,
    });
  return competitor.id;
}

function getCompetitor(id) {
  const conn = getDb();
  return conn.prepare('SELECT * FROM seo_competitors WHERE id = ?').get(id) || null;
}

function listCompetitors({ crawlEnabledOnly } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM seo_competitors WHERE 1=1';
  if (crawlEnabledOnly) query += ' AND crawl_enabled = 1';
  query += ' ORDER BY name';
  return conn.prepare(query).all();
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
  };
  const existing = conn
    .prepare(
      `SELECT id FROM seo_topics WHERE normalized_keyword = :normalized_keyword
        AND target_area IS :target_area AND target_school IS :target_school
        AND target_grade IS :target_grade AND target_subject IS :target_subject`
    )
    .get(key);
  if (existing) return existing.id;
  const result = conn
    .prepare(
      `INSERT INTO seo_topics (raw_keyword, normalized_keyword, normalization_rule, target_area, target_school, target_grade, target_subject, created_at)
       VALUES (:raw_keyword, :normalized_keyword, :normalization_rule, :target_area, :target_school, :target_grade, :target_subject, :created_at)`
    )
    .run({
      raw_keyword: topic.raw_keyword || topic.normalized_keyword,
      normalized_keyword: topic.normalized_keyword,
      normalization_rule: topic.normalization_rule || null,
      target_area: key.target_area,
      target_school: key.target_school,
      target_grade: key.target_grade,
      target_subject: key.target_subject,
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

// 表示回数で重み付けした平均順位・CTRを返す(表示回数0のクエリを平均で埋もれさせないため)。
// データが無ければnull(呼び出し側はnullを「実績データ無し」として扱う。0とは区別する)。
function getGscAggregateForKeyword(query) {
  const rows = listGscQueriesForKeyword(query);
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
  };
  const existing = conn
    .prepare(
      `SELECT id, status FROM seo_keyword_candidates WHERE normalized_keyword = :normalized_keyword
        AND target_area IS :target_area AND target_school IS :target_school
        AND target_grade IS :target_grade AND target_subject IS :target_subject`
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
        analysis_run_id: candidate.analysis_run_id || null,
        updated_at: nowIso,
      });
    return { id: existing.id, isNew: false, previousStatus: existing.status };
  }
  const result = conn
    .prepare(
      `INSERT INTO seo_keyword_candidates (
        normalized_keyword, raw_keyword, target_area, target_school, target_grade, target_subject,
        gap_type, priority_score, score_breakdown, search_demand, own_avg_position, competitor_count,
        recommended_action, suggested_title, suggested_outline, status, analysis_run_id, created_at, updated_at
      ) VALUES (
        :normalized_keyword, :raw_keyword, :target_area, :target_school, :target_grade, :target_subject,
        :gap_type, :priority_score, :score_breakdown, :search_demand, :own_avg_position, :competitor_count,
        :recommended_action, :suggested_title, :suggested_outline, :status, :analysis_run_id, :created_at, :updated_at
      )`
    )
    .run({
      normalized_keyword: key.normalized_keyword,
      raw_keyword: candidate.raw_keyword || null,
      target_area: key.target_area,
      target_school: key.target_school,
      target_grade: key.target_grade,
      target_subject: key.target_subject,
      gap_type: candidate.gap_type,
      priority_score: candidate.priority_score,
      score_breakdown: toJson(candidate.score_breakdown),
      search_demand: candidate.search_demand ?? null,
      own_avg_position: candidate.own_avg_position ?? null,
      competitor_count: candidate.competitor_count ?? null,
      recommended_action: candidate.recommended_action || null,
      suggested_title: candidate.suggested_title || null,
      suggested_outline: toJson(candidate.suggested_outline),
      status: candidate.status || 'discovered',
      analysis_run_id: candidate.analysis_run_id || null,
      created_at: nowIso,
      updated_at: nowIso,
    });
  return { id: Number(result.lastInsertRowid), isNew: true, previousStatus: null };
}

function getKeywordCandidateById(id) {
  const conn = getDb();
  const row = conn.prepare('SELECT * FROM seo_keyword_candidates WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, score_breakdown: fromJson(row.score_breakdown), suggested_outline: fromJson(row.suggested_outline) };
}

function listKeywordCandidates({ status, gapType, targetArea, minPriorityScore, orderBy } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM seo_keyword_candidates WHERE 1=1';
  const params = {};
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
  const orderColumns = { priority_score: 'priority_score DESC', updated_at: 'updated_at DESC', search_demand: 'search_demand DESC' };
  query += ` ORDER BY ${orderColumns[orderBy] || 'priority_score DESC'}`;
  return conn
    .prepare(query)
    .all(params)
    .map((row) => ({ ...row, score_breakdown: fromJson(row.score_breakdown), suggested_outline: fromJson(row.suggested_outline) }));
}

// 候補の状態遷移。二重キュー登録を防ぐため、queuedへの遷移はapproved以外からは許可しない。
function updateCandidateStatus(id, { toStatus, reason, actor }, nowIso) {
  const conn = getDb();
  const current = conn.prepare('SELECT status FROM seo_keyword_candidates WHERE id = ?').get(id);
  if (!current) throw new Error(`updateCandidateStatus: candidate id=${id} が見つかりません`);
  if (toStatus === 'queued' && current.status !== 'approved') {
    throw new Error(`updateCandidateStatus: queuedにはapproved状態からのみ遷移可能です(現状: ${current.status})`);
  }
  conn.prepare('UPDATE seo_keyword_candidates SET status = :status, updated_at = :updated_at WHERE id = :id').run({
    status: toStatus,
    updated_at: nowIso,
    id,
  });
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
  upsertGscQueryRow,
  listGscQueriesForKeyword,
  getGscAggregateForKeyword,
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
};
