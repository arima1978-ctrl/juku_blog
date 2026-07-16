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
const branchesDb = require('./lib/branches_db');
const { buildDictionaryEntries, extractKeywordCandidates } = require('./lib/seo/keyword_extractor');
const { buildCompoundKeywords } = require('./lib/seo/compound_keyword_builder');
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

// コア処理(テスト容易性・API層からの呼び出しのため、process.exitを含まない形で分離)。
// branchIdを指定すると、その校舎の競合(seo_competitors.branch_id)が保有するページのみを
// 解析対象にする(未指定時は全校舎対象。CLI/cronの既存挙動を変えないためのデフォルト)。
// 保存するテーマ・複合キーワードのbranch_idも、明示指定があればそれを使い、
// 無ければ現在アクティブな校舎にフォールバックする。
async function resolvePageAnalyze({ dryRun = false, branchId, seoDbImpl = seoDb, branchesDbImpl = branchesDb } = {}) {
  const config = loadJukuConfig();
  const feature = config.features && config.features.competitor_keyword_analysis;

  if (!feature || !feature.enabled) {
    return { ok: false, reason: 'feature_disabled', stats: null };
  }

  const weights = config.seo.competitor_analysis.extraction_weights;
  const dictionaryEntries = buildDictionaryEntries(config);
  const exclusionTerms = buildExclusionTerms();

  const pages = seoDbImpl.listPagesNeedingAnalysis(branchId);
  if (pages.length === 0) {
    return { ok: true, reason: 'no_pages', stats: null };
  }

  const nowIso = new Date().toISOString();
  // 複数校舎管理: config自体はフェーズ3対象外(校舎別に分離しない)ため、
  // 抽出したテーマ・複合キーワードは対象校舎(branchId、無ければ現在アクティブな校舎)に
  // 紐づけて保存する。
  const saveBranchId =
    branchId !== undefined && branchId !== null
      ? branchId
      : ((branchesDbImpl.getActiveBranch() || {}).id ?? null);
  let topicsExtracted = 0;
  let compoundsExtracted = 0;

  for (const page of pages) {
    const bodyText = readPageBody(page.content_hash);
    const headings = seoDbImpl.listPageHeadings(page.id);
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

    const compounds = buildCompoundKeywords(candidates);

    if (dryRun) {
      console.log(`[seo_page_analyze][dry-run] page_id=${page.id} candidates=${candidates.length} compounds=${compounds.length}`);
      continue;
    }

    for (const candidate of candidates) {
      const axisKey = CATEGORY_TO_AXIS[candidate.category] || null;
      const topicId = seoDbImpl.upsertTopic(
        {
          raw_keyword: candidate.rawKeyword,
          normalized_keyword: candidate.normalizedKeyword,
          normalization_rule: candidate.normalizationRule,
          target_area: axisKey === 'target_area' ? candidate.normalizedKeyword : null,
          target_school: axisKey === 'target_school' ? candidate.normalizedKeyword : null,
          target_grade: axisKey === 'target_grade' ? candidate.normalizedKeyword : null,
          target_subject: axisKey === 'target_subject' ? candidate.normalizedKeyword : null,
          branch_id: saveBranchId,
        },
        nowIso
      );
      const occurrenceCount = Object.values(candidate.occurrences).reduce((a, b) => a + b, 0);
      seoDbImpl.upsertPageTopic(
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

    // 複合キーワード(「地域×塾」等)。単語単体(seo_topics)とは別テーブルに保存し、
    // seo_gap_calculate.jsはこちらを候補生成の主単位として使う。
    for (const compound of compounds) {
      const compoundKeywordId = seoDbImpl.upsertCompoundKeyword(
        {
          compound_keyword: compound.compoundKeyword,
          template_type: compound.templateType,
          keyword_components: compound.components,
          target_area: compound.components.area || null,
          target_school: compound.components.school || null,
          target_grade: compound.components.grade || null,
          target_subject: compound.components.subject || null,
          branch_id: saveBranchId,
        },
        nowIso
      );
      seoDbImpl.upsertPageCompoundKeyword(
        {
          page_id: page.id,
          compound_keyword_id: compoundKeywordId,
          cooccurrence_score: compound.cooccurrenceScore,
          same_zone: compound.sameZone,
        },
        nowIso
      );
      compoundsExtracted += 1;
    }

    seoDbImpl.markPageAnalyzed(page.id, nowIso);
  }

  const stats = { pages_analyzed: pages.length, topics_extracted: topicsExtracted, compounds_extracted: compoundsExtracted };
  console.log(
    `[seo_page_analyze] 完了: ページ${pages.length}件を解析、単語テーマ${topicsExtracted}件・複合キーワード${compoundsExtracted}件を保存しました`
  );
  return { ok: true, dryRun, stats };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const result = await resolvePageAnalyze({ dryRun });

  if (result.reason === 'feature_disabled') {
    console.log('[seo_page_analyze] competitor_keyword_analysis.enabled が false のため無処理で終了します');
    process.exit(0);
  }
  if (result.reason === 'no_pages') {
    console.log('[seo_page_analyze] 解析対象のページがありません');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_page_analyze] 予期しないエラー: ${err.message}`);
    logError('seo_page_analyze', err.message);
    process.exit(1);
  });
}

module.exports = { main, resolvePageAnalyze };
