'use strict';

// AI Growth Director: seo_keyword_candidatesからSEO Task(改善作業単位)を生成する。
// features.growth_director.enabledがfalse(既定)の間は無処理で終了し、既存の記事生成
// フロー・競合キーワード分析(候補一覧)には一切影響しない。
//
// URL Allocator(scripts/lib/seo/url_allocator.js)がtask_typeを判定し、
// Opportunity Score(scripts/lib/seo/opportunity_score.js)が0-100点のスコアを算出する。
// Sprint 1では提案(proposed)を作るところまでで、記事生成・WordPress投稿へは接続しない。
//
// 使い方: node scripts/seo_task_generate.js [--dry-run]

const { loadJukuConfig } = require('./lib/config');
const { getPostById } = require('./lib/db');
const seoDb = require('./lib/seo_db');
const { allocateUrl } = require('./lib/seo/url_allocator');
const { isLowIntentKeyword } = require('./lib/seo/priority_scorer');
const {
  computeOpportunityScore,
  competitorAdoptionRatio,
  searchIntentRatio,
  ownCoverageGapRatio,
  effortEfficiencyRatio,
} = require('./lib/seo/opportunity_score');
const { logError } = require('./log_error');

// relatedPostId(弱い関連記事)の実データ判定はSprint 1のスコープ外(常にnull)。
// 将来、類似度の中間帯(強い一致ではないが関連はある)を検出するロジックを追加する想定。
function findRelatedPostId() {
  return null;
}

function resolveTargetUrl(existingPostId) {
  if (!existingPostId) return null;
  const post = getPostById(existingPostId);
  return post ? post.wp_link || null : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_task_generate] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  const gdConfig = config.seo.growth_director;
  const effortMinutesByTaskType = gdConfig.effort_minutes_by_task_type;
  const opportunityWeights = gdConfig.opportunity_score_weights;

  const candidates = seoDb.listKeywordCandidates({});
  if (candidates.length === 0) {
    console.log('[seo_task_generate] 対象のキーワード候補がありません');
    return;
  }

  const totalCompetitorsConsidered = seoDb.countAnalyzedCompetitors();
  const nowIso = new Date().toISOString();
  const stats = { tasks_created: 0, tasks_updated: 0, error_count: 0 };

  for (const candidate of candidates) {
    try {
      const isLowIntent = isLowIntentKeyword(candidate.normalized_keyword);
      const relatedPostId = findRelatedPostId(candidate);

      const allocation = allocateUrl({
        normalizedKeyword: candidate.normalized_keyword,
        templateType: candidate.template_type,
        gapType: candidate.gap_type,
        isLowIntent,
        existingPostId: candidate.existing_post_id,
        relatedPostId,
      });

      const estimatedEffortMinutes = effortMinutesByTaskType[allocation.taskType] ?? null;
      const areaRelevanceRatio =
        candidate.score_breakdown && candidate.score_breakdown.area_relevance
          ? candidate.score_breakdown.area_relevance.ratio
          : 0;

      const { score: opportunityScore, breakdown: opportunityBreakdown } = computeOpportunityScore(
        {
          competitorAdoption: competitorAdoptionRatio(candidate.competitor_count, totalCompetitorsConsidered),
          areaRelevance: areaRelevanceRatio,
          searchIntent: searchIntentRatio(candidate.search_intent),
          ownCoverageGap: ownCoverageGapRatio(candidate.gap_type),
          dataConfidence: (candidate.data_confidence ?? 0) / 100,
          effortEfficiency: effortEfficiencyRatio(estimatedEffortMinutes),
        },
        opportunityWeights
      );

      const reason = [
        ...allocation.reasons,
        candidate.competitor_count != null ? `競合${candidate.competitor_count}社` : null,
      ].filter(Boolean);

      if (dryRun) {
        console.log(
          `[seo_task_generate][dry-run] ${candidate.normalized_keyword}: task=${allocation.taskType} opportunity=${opportunityScore}`
        );
        continue;
      }

      const targetUrl = resolveTargetUrl(candidate.existing_post_id);
      const result = seoDb.upsertTask(
        {
          task_type: allocation.taskType,
          target_url: targetUrl,
          target_post_id: candidate.existing_post_id || null,
          target_keyword: candidate.normalized_keyword,
          source_candidate_id: candidate.id,
          priority_score: candidate.priority_score,
          opportunity_score: opportunityScore,
          opportunity_breakdown: opportunityBreakdown,
          estimated_effort_minutes: estimatedEffortMinutes,
          recommended_action: allocation.taskType,
          reason,
        },
        nowIso
      );

      if (result.isNew) stats.tasks_created += 1;
      else stats.tasks_updated += 1;
    } catch (err) {
      stats.error_count += 1;
      logError('seo_task_generate', `candidate_id=${candidate.id}: ${err.message}`);
    }
  }

  console.log(`[seo_task_generate] 完了(dry-run=${dryRun}): ${JSON.stringify(stats)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_task_generate] 予期しないエラー: ${err.message}`);
    logError('seo_task_generate', err.message);
    process.exit(1);
  });
}

module.exports = { main };
