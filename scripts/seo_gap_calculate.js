'use strict';

// Keyword Gap判定 + 優先度スコア算出。seo_page_analyze.jsが保存した複合キーワード
// (seo_compound_keywords/seo_page_compound_keywords)と、自社記事(posts)・
// Search Console実績(seo_gsc_queries)・検索需要CSV(seo_keyword_metrics)・
// 順位CSV(seo_serp_rankings)を突き合わせ、seo_keyword_candidates(+evidence+
// 既存記事紐付け)を更新する。
//
// 2026-07-13の設計変更: 単語単体(seo_topics)をそのまま候補化するのをやめ、
// 「地域×塾」等の複合キーワード(seo_compound_keywords)のみを候補生成の対象にする。
// 既存の単語単体候補(旧仕様で生成されたもの)はDBに残るが、このスクリプトの
// 再実行では更新されない(新規に単語単体候補が作られることもない)。
//
// 既存candidateのstatus(承認/除外等、人間が設定した値)は再計算時も保持される
// (upsertKeywordCandidateはstatusを更新しない)。
//
// 使い方: node scripts/seo_gap_calculate.js [--dry-run]

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const { listPosts } = require('./lib/db');
const seoDb = require('./lib/seo_db');
const branchesDb = require('./lib/branches_db');
const { buildAreaDictionary, GENERIC_EXCLUSION_TERMS } = require('./lib/seo/dictionaries');
const { buildDictionaryEntries } = require('./lib/seo/keyword_extractor');
const { buildOwnCompoundCoverageIndex, getOwnCompoundCoverage, isOwnContentThinner } = require('./lib/seo/own_content_analyzer');
const { classifyKeywordGap } = require('./lib/seo/gap_classifier');
const { computePriorityScore, computeAreaRelevanceRatio, computeInquiryIntentRatio, isLowIntentKeyword } = require('./lib/seo/priority_scorer');
const { decideRecommendedAction, SCHOOL_PAGE_TEMPLATES } = require('./lib/seo/recommended_action');
const { computeDataConfidence } = require('./lib/seo/data_confidence');
const { detectCannibalization } = require('./lib/seo/cannibalization');
const { logError } = require('./log_error');

const PAGES_DIR = path.join(ROOT, 'data', 'seo', 'pages');
const MAX_EVIDENCE_PER_CANDIDATE = 5;

// template_type別の検索意図ラベル(ダッシュボード表示用)
const SEARCH_INTENT_BY_TEMPLATE = {
  area_juku: 'general_service',
  area_grade_juku: 'general_service',
  area_teaching_style: 'general_service',
  area_subject_juku: 'general_service',
  school_juku: 'general_service',
  area_koko_nyushi: 'exam_prep',
  area_teiki_test: 'exam_prep',
  school_teiki_test: 'exam_prep',
  area_season_course: 'seasonal_course',
  area_muryou_taiken: 'trial_inquiry',
};

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function readPageBodyLength(contentHash) {
  if (!contentHash) return null;
  try {
    return fs.readFileSync(path.join(PAGES_DIR, `${contentHash}.txt`), 'utf8').length;
  } catch {
    return null;
  }
}

function parseKeywordComponents(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function groupByCompound(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.compound_keyword_id)) groups.set(row.compound_keyword_id, []);
    groups.get(row.compound_keyword_id).push(row);
  }
  return groups;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const config = loadJukuConfig();
  const feature = config.features && config.features.competitor_keyword_analysis;

  if (!feature || !feature.enabled) {
    console.log('[seo_gap_calculate] competitor_keyword_analysis.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  const running = seoDb.getRunningAnalysisRun();
  if (running) {
    console.log(`[seo_gap_calculate] 既に実行中のanalysis_run(${running.id})があるため二重起動を回避します`);
    process.exit(0);
  }

  const seoConfig = config.seo.competitor_analysis;
  const priorityWeights = seoConfig.priority_score_weights;
  const areaDictionary = buildAreaDictionary(config);
  const dictionaryEntries = buildDictionaryEntries(config);
  const exclusionTerms = [...GENERIC_EXCLUSION_TERMS, ...seoDb.listCompetitors().map((c) => c.name)];
  const competitorDomainById = new Map(seoDb.listCompetitors().map((c) => [c.id, c.domain]));

  const nowIso = new Date().toISOString();
  const runId = `run-${nowIso.replace(/[:.]/g, '-')}`;
  if (!dryRun) seoDb.createAnalysisRun(runId, nowIso);
  // 複数校舎管理: config自体はフェーズ3対象外(校舎別に分離しない)ため、
  // 算出したキーワード候補は現在アクティブな校舎に紐づけて保存する。
  const activeBranch = branchesDb.getActiveBranch();
  const activeBranchId = activeBranch ? activeBranch.id : null;

  const stats = { topics_extracted: 0, candidates_created: 0, candidates_updated: 0, error_count: 0 };

  try {
    const ownPosts = listPosts({}).filter((p) => p.status !== 'rejected');
    const ownCompoundCoverageIndex = buildOwnCompoundCoverageIndex(ownPosts, dictionaryEntries, seoConfig.extraction_weights, exclusionTerms);

    const compoundRows = seoDb.listCompoundKeywordCoverage();
    const compoundGroups = groupByCompound(compoundRows);
    const totalCompetitorsConsidered = seoDb.countAnalyzedCompetitors();
    stats.topics_extracted = compoundGroups.size;

    for (const rows of compoundGroups.values()) {
      const first = rows[0];
      const compoundKeyword = first.compound_keyword;
      const templateType = first.template_type;
      const components = parseKeywordComponents(first.keyword_components);
      const competitorIds = new Set(rows.map((r) => r.competitor_id));
      const competitorCount = competitorIds.size;
      const competitorDomains = Array.from(competitorIds).map((id) => competitorDomainById.get(id)).filter(Boolean);

      const ownCoverage = getOwnCompoundCoverage(ownCompoundCoverageIndex, compoundKeyword);
      const ownHasArticle = Boolean(ownCoverage);
      const existingPostId = ownCoverage ? ownCoverage.postId : null;

      const gscAgg = seoDb.getGscAggregateForKeyword(compoundKeyword);
      const ownAvgPosition = gscAgg ? gscAgg.avgPosition : null;
      const ownImpressions = gscAgg ? gscAgg.impressions : null;
      const ownCtr = gscAgg ? gscAgg.ctr : null;

      const competitorBestPosition = seoDb.getCompetitorBestPosition(compoundKeyword, competitorDomains);
      const searchDemand = seoDb.getKeywordDemand(compoundKeyword);

      const bestEvidenceRow = rows.reduce(
        (best, r) => ((r.cooccurrence_score || 0) > (best.cooccurrence_score || 0) ? r : best),
        rows[0]
      );
      const competitorBodyLength = readPageBodyLength(bestEvidenceRow.content_hash);
      const ownContentThinner = isOwnContentThinner(ownCoverage, competitorBodyLength);

      const classification = classifyKeywordGap({
        competitorCount,
        totalCompetitorsConsidered,
        ownHasArticle,
        ownAvgPosition,
        ownImpressions,
        ownClicks: gscAgg ? gscAgg.clicks : null,
        ownCtr,
        competitorBestPosition,
        ownContentThinnerThanCompetitor: ownContentThinner,
        matchType: 'exact',
      });

      if (!classification.gapType) continue; // 根拠不十分(no_evidence_either_side)は候補化しない

      const areaRelevanceRatio = computeAreaRelevanceRatio(compoundKeyword, areaDictionary);
      const inquiryIntentRatio = computeInquiryIntentRatio(compoundKeyword);
      const isLowIntent = isLowIntentKeyword(compoundKeyword);
      const competitorAdoptionRatio = totalCompetitorsConsidered > 0 ? competitorCount / totalCompetitorsConsidered : 0;
      const competitorRankRatio =
        competitorBestPosition != null && ownAvgPosition != null
          ? clamp01((ownAvgPosition - competitorBestPosition) / 20)
          : competitorBestPosition != null
            ? 0.5
            : 0;
      const searchDemandRatio = searchDemand != null ? clamp01(Math.log10(searchDemand + 1) / 4) : 0;
      const ownRankImprovementRatio = ownAvgPosition != null && ownAvgPosition > 10 ? clamp01((ownAvgPosition - 10) / 20) : 0;

      const { score, breakdown } = computePriorityScore(
        {
          areaRelevance: areaRelevanceRatio,
          inquiryIntent: inquiryIntentRatio,
          competitorAdoption: competitorAdoptionRatio,
          competitorRank: competitorRankRatio,
          searchDemand: searchDemandRatio,
          ownRankImprovement: ownRankImprovementRatio,
          seasonality: 0, // MVP未実装(config/seasonal_topics.yamlとの連携は将来対応)
        },
        priorityWeights
      );

      const recommendedAction = decideRecommendedAction({
        gapType: classification.gapType,
        isLowIntent,
        ownHasArticle,
        templateType,
        existingPostId,
      });

      // data_confidence: priority_scoreとは独立した「どれだけ確からしいデータに基づくか」の指標。
      const sameZoneAcrossEvidence = rows.find((r) => r.same_zone)?.same_zone || null;
      const { score: dataConfidence } = computeDataConfidence({
        competitorCount,
        evidencePageCount: rows.length,
        sameZone: sameZoneAcrossEvidence,
        hasGscData: gscAgg !== null,
        hasSearchDemandData: searchDemand !== null,
        hasSerpData: competitorBestPosition !== null,
      });

      // カニバリゼーション警告(GSC実績ベース: 同一クエリで複数の自社ページに表示があるか)
      const cannibalizationWarning = detectCannibalization(seoDb.getGscPagesForQuery(compoundKeyword));

      const searchIntent = SEARCH_INTENT_BY_TEMPLATE[templateType] || 'general_service';
      const contentType = SCHOOL_PAGE_TEMPLATES.has(templateType) ? 'school_page' : 'blog_article';

      if (dryRun) {
        console.log(
          `[seo_gap_calculate][dry-run] ${compoundKeyword}: gap=${classification.gapType} score=${score} confidence=${dataConfidence} action=${recommendedAction}`
        );
        continue;
      }

      const candidateResult = seoDb.upsertKeywordCandidate(
        {
          normalized_keyword: compoundKeyword,
          raw_keyword: null,
          target_area: first.target_area,
          target_school: first.target_school,
          target_grade: first.target_grade,
          target_subject: first.target_subject,
          gap_type: classification.gapType,
          priority_score: score,
          score_breakdown: { ...breakdown, gap_reasons: classification.reasons },
          search_demand: searchDemand,
          own_avg_position: ownAvgPosition,
          competitor_count: competitorCount,
          recommended_action: recommendedAction,
          keyword_components: components,
          template_type: templateType,
          cooccurrence_score: bestEvidenceRow.cooccurrence_score,
          search_intent: searchIntent,
          content_type: contentType,
          data_confidence: dataConfidence,
          existing_post_id: existingPostId,
          cannibalization_warning: cannibalizationWarning,
          analysis_run_id: runId,
          branch_id: activeBranchId,
        },
        nowIso
      );

      if (candidateResult.isNew) stats.candidates_created += 1;
      else stats.candidates_updated += 1;

      const topEvidence = [...rows]
        .sort((a, b) => (b.cooccurrence_score || 0) - (a.cooccurrence_score || 0))
        .slice(0, MAX_EVIDENCE_PER_CANDIDATE);
      for (const row of topEvidence) {
        seoDb.insertCandidateEvidence(
          {
            candidate_id: candidateResult.id,
            competitor_page_id: row.page_id,
            evidence_type: row.same_zone || 'page',
            detail: { url: row.canonical_url, title: row.page_title },
            confidence: row.cooccurrence_score,
          },
          nowIso
        );
      }

      if (ownCoverage) {
        seoDb.upsertCandidateExistingArticle(
          {
            candidate_id: candidateResult.id,
            post_id: ownCoverage.postId,
            similarity_score: null,
            match_reason: 'compound_keyword_match',
          },
          nowIso
        );
      }
    }

    if (!dryRun) {
      seoDb.finishAnalysisRun(runId, { status: 'completed', finishedAtIso: new Date().toISOString(), ...stats });
    }
    console.log(`[seo_gap_calculate] 完了(dry-run=${dryRun}): ${JSON.stringify(stats)}`);
  } catch (err) {
    if (!dryRun) {
      seoDb.finishAnalysisRun(runId, { status: 'failed', finishedAtIso: new Date().toISOString(), ...stats, error_count: stats.error_count + 1 });
    }
    logError('seo_gap_calculate', err.message);
    throw err;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_gap_calculate] 予期しないエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
