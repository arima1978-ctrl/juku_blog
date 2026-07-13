'use strict';

// 取得済み競合ページ(seo_competitor_pages)からキーワード候補を抽出し、
// seo_topics/seo_page_topicsへ保存する。未解析、または前回解析後に本文が
// 更新されたページのみを対象にする(content_hashが同じページはcrawl側で
// last_analyzed_at < fetched_atにならないためここでは再解析されない)。
//
// 使い方: node scripts/seo_page_analyze.js [--dry-run]

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { buildDictionaryEntries, extractKeywordCandidates } = require('./lib/seo/keyword_extractor');
const { GENERIC_EXCLUSION_TERMS } = require('./lib/seo/dictionaries');
const { ROOT } = require('./lib/config');
const { logError } = require('./log_error');

const PAGES_DIR = path.join(ROOT, 'data', 'seo', 'pages');

const CATEGORY_TO_AXIS = {
  area: 'target_area',
  school: 'target_school',
  grade: 'target_grade',
  subject: 'target_subject',
};

function readPageBody(contentHash) {
  if (!contentHash) return '';
  const filePath = path.join(PAGES_DIR, `${contentHash}.txt`);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function pickDominantZone(occurrences) {
  const zonePriority = ['title', 'h1', 'h2', 'h3', 'meta_description', 'body'];
  let best = null;
  for (const zone of zonePriority) {
    if (occurrences[zone] && (!best || occurrences[zone] > occurrences[best])) best = zone;
  }
  return best || 'body';
}

function buildExclusionTerms() {
  const competitorNames = seoDb.listCompetitors().map((c) => c.name);
  return [...GENERIC_EXCLUSION_TERMS, ...competitorNames];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const config = loadJukuConfig();
  const feature = config.features && config.features.competitor_keyword_analysis;

  if (!feature || !feature.enabled) {
    console.log('[seo_page_analyze] competitor_keyword_analysis.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  const weights = config.seo.competitor_analysis.extraction_weights;
  const dictionaryEntries = buildDictionaryEntries(config);
  const exclusionTerms = buildExclusionTerms();

  const pages = seoDb.listPagesNeedingAnalysis();
  if (pages.length === 0) {
    console.log('[seo_page_analyze] 解析対象のページがありません');
    return;
  }

  const nowIso = new Date().toISOString();
  let topicsExtracted = 0;

  for (const page of pages) {
    const bodyText = readPageBody(page.content_hash);
    const headings = seoDb.listPageHeadings(page.id);
    const pageForExtraction = {
      title: page.title || '',
      metaDescription: page.meta_description || '',
      headings,
      bodyText,
    };

    let candidates = [];
    try {
      candidates = extractKeywordCandidates(pageForExtraction, dictionaryEntries, weights, exclusionTerms);
    } catch (err) {
      logError('seo_page_analyze', `page_id=${page.id}: ${err.message}`);
      continue;
    }

    if (dryRun) {
      console.log(`[seo_page_analyze][dry-run] page_id=${page.id} candidates=${candidates.length}`);
      continue;
    }

    for (const candidate of candidates) {
      const axisKey = CATEGORY_TO_AXIS[candidate.category] || null;
      const topicId = seoDb.upsertTopic(
        {
          raw_keyword: candidate.rawKeyword,
          normalized_keyword: candidate.normalizedKeyword,
          normalization_rule: candidate.normalizationRule,
          target_area: axisKey === 'target_area' ? candidate.normalizedKeyword : null,
          target_school: axisKey === 'target_school' ? candidate.normalizedKeyword : null,
          target_grade: axisKey === 'target_grade' ? candidate.normalizedKeyword : null,
          target_subject: axisKey === 'target_subject' ? candidate.normalizedKeyword : null,
        },
        nowIso
      );
      const occurrenceCount = Object.values(candidate.occurrences).reduce((a, b) => a + b, 0);
      seoDb.upsertPageTopic(
        {
          page_id: page.id,
          topic_id: topicId,
          score: candidate.score,
          occurrence_count: occurrenceCount,
          extraction_method: pickDominantZone(candidate.occurrences),
          confidence: candidate.confidence,
        },
        nowIso
      );
      topicsExtracted += 1;
    }

    seoDb.markPageAnalyzed(page.id, nowIso);
  }

  console.log(`[seo_page_analyze] 完了: ページ${pages.length}件を解析、テーマ${topicsExtracted}件を保存しました`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_page_analyze] 予期しないエラー: ${err.message}`);
    logError('seo_page_analyze', err.message);
    process.exit(1);
  });
}

module.exports = { main };
