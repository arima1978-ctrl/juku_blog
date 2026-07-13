'use strict';

// Keyword Gap判定 + 優先度スコア算出。seo_page_analyze.jsが保存したテーマ(seo_topics/
// seo_page_topics)と、自社記事(posts)・Search Console実績(seo_gsc_queries)・
// 検索需要CSV(seo_keyword_metrics)・順位CSV(seo_serp_rankings)を突き合わせ、
// seo_keyword_candidates(+evidence+既存記事紐付け)を更新する。
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
const { buildDictionaryEntries } = require('./lib/seo/keyword_extractor');
const { buildAreaDictionary, GENERIC_EXCLUSION_TERMS } = require('./lib/seo/dictionaries');
const { buildOwnCoverageIndex, getOwnCoverage, isOwnContentThinner } = require('./lib/seo/own_content_analyzer');
const { classifyKeywordGap } = require('./lib/seo/gap_classifier');
const { computePriorityScore, computeAreaRelevanceRatio, computeInquiryIntentRatio, isLowIntentKeyword } = require('./lib/seo/priority_scorer');
const { decideRecommendedAction } = require('./lib/seo/recommended_action');
const { logError } = require('./log_error');

const PAGES_DIR = path.join(ROOT, 'data', 'seo', 'pages');
const MAX_EVIDENCE_PER_CANDIDATE = 5;

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

function groupByTopic(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.topic_id)) groups.set(row.topic_id, []);
    groups.get(row.topic_id).push(row);
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

  const stats = { topics_extracted: 0, candidates_created: 0, candidates_updated: 0, error_count: 0 };

  try {
    const ownPosts = listPosts({}).filter((p) => p.status !== 'rejected');
    const ownCoverageIndex = buildOwnCoverageIndex(ownPosts, dictionaryEntries, seoConfig.extraction_weights, exclusionTerms);

    const topicRows = seoDb.listTopicCoverage();
    const topicGroups = groupByTopic(topicRows);
    const totalCompetitorsConsidered = seoDb.countAnalyzedCompetitors();
    stats.topics_extracted = topicGroups.size;

    for (const rows of topicGroups.values()) {
      const first = rows[0];
      const normalizedKeyword = first.normalized_keyword;
      const competitorIds = new Set(rows.map((r) => r.competitor_id));
      const competitorCount = competitorIds.size;
      const competitorDomains = Array.from(competitorIds).map((id) => competitorDomainById.get(id)).filter(Boolean);

      const ownCoverage = getOwnCoverage(ownCoverageIndex, normalizedKeyword);
      const ownHasArticle = Boolean(ownCoverage);

      const gscAgg = seoDb.getGscAggregateForKeyword(normalizedKeyword);
      const ownAvgPosition = gscAgg ? gscAgg.avgPosition : null;
      const ownImpressions = gscAgg ? gscAgg.impressions : null;
      const ownCtr = gscAgg ? gscAgg.ctr : null;

      const competitorBestPosition = seoDb.getCompetitorBestPosition(normalizedKeyword, competitorDomains);
      const searchDemand = seoDb.getKeywordDemand(normalizedKeyword);

      const bestEvidenceRow = rows.reduce((best, r) => ((r.score || 0) > (best.score || 0) ? r : best), rows[0]);
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

      const areaRelevanceRatio = computeAreaRelevanceRatio(normalizedKeyword, areaDictionary);
      const inquiryIntentRatio = computeInquiryIntentRatio(normalizedKeyword);
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
        isLowIntent: isLowIntentKeyword(normalizedKeyword),
        ownHasArticle,
      });

      if (dryRun) {
        console.log(
          `[seo_gap_calculate][dry-run] ${normalizedKeyword}: gap=${classification.gapType} score=${score} action=${recommendedAction}`
        );
        continue;
      }

      const candidateResult = seoDb.upsertKeywordCandidate(
        {
          normalized_keyword: normalizedKeyword,
          raw_keyword: first.raw_keyword,
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
          analysis_run_id: runId,
        },
        nowIso
      );

      if (candidateResult.isNew) stats.candidates_created += 1;
      else stats.candidates_updated += 1;

      const topEvidence = [...rows].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, MAX_EVIDENCE_PER_CANDIDATE);
      for (const row of topEvidence) {
        seoDb.insertCandidateEvidence(
          {
            candidate_id: candidateResult.id,
            competitor_page_id: row.page_id,
            evidence_type: row.extraction_method,
            detail: { url: row.canonical_url, title: row.page_title },
            confidence: row.confidence,
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
            match_reason: 'topic_keyword_match',
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
