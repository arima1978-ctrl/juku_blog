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
const { findSchoolPageByArea } = require('./lib/seo/school_page_registry');
const { isLowIntentKeyword } = require('./lib/seo/priority_scorer');
const {
  computeOpportunityScore,
  competitorAdoptionRatio,
  searchIntentRatio,
  ownCoverageGapRatio,
  effortEfficiencyRatio,
} = require('./lib/seo/opportunity_score');
const { computeExpectedImpact } = require('./lib/seo/impact_calculator');
const { computeDifficultyScore } = require('./lib/seo/difficulty_score');
const { computeRawRoiScore, normalizeRoiScoresInBatch } = require('./lib/seo/roi_priority_score');
const { logError } = require('./log_error');

// Sprint 3.8: candidate.normalized_keywordに言及している登録競合(seo_competitors)を
// competitor_type別に集計し、Map<normalized_keyword, {type: count}>を返す。
// difficulty_score.jsへ渡す入力をDBから組み立てるためのヘルパー(このスクリプト内に閉じる。
// difficulty_score.js自体はDB非依存の純粋関数のまま維持する)。
function buildCompetitorTypeCountsByKeyword(seoDbImpl = seoDb) {
  const rows = seoDbImpl.listCompoundKeywordCoverage();
  const competitorTypeById = new Map(seoDbImpl.listCompetitors().map((c) => [c.id, c.competitor_type]));

  const competitorIdsByKeyword = new Map();
  rows.forEach((row) => {
    if (!competitorIdsByKeyword.has(row.compound_keyword)) {
      competitorIdsByKeyword.set(row.compound_keyword, new Set());
    }
    competitorIdsByKeyword.get(row.compound_keyword).add(row.competitor_id);
  });

  const typeCountsByKeyword = new Map();
  competitorIdsByKeyword.forEach((competitorIds, keyword) => {
    const typeCounts = {};
    competitorIds.forEach((id) => {
      const type = competitorTypeById.get(id) || 'other';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    typeCountsByKeyword.set(keyword, typeCounts);
  });

  return typeCountsByKeyword;
}

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

// 1候補分のTaskペイロードを組み立てる(DB書き込みは行わない)。school_page_registry.js
// への依存を注入可能にすることで、実ファイル(config/school_pages.yaml)や
// フィーチャーフラグを操作せずにユニットテストできるようにする。
function buildTaskForCandidate(
  candidate,
  {
    effortMinutesByTaskType,
    opportunityWeights,
    totalCompetitorsConsidered,
    findSchoolPage = findSchoolPageByArea,
    competitorTypeCountsByKeyword = new Map(),
  }
) {
  const isLowIntent = isLowIntentKeyword(candidate.normalized_keyword);
  const relatedPostId = findRelatedPostId(candidate);
  const schoolPage = findSchoolPage(candidate.target_area);

  const allocation = allocateUrl({
    normalizedKeyword: candidate.normalized_keyword,
    templateType: candidate.template_type,
    gapType: candidate.gap_type,
    isLowIntent,
    existingPostId: candidate.existing_post_id,
    relatedPostId,
    existingSchoolPageUrl: schoolPage ? schoolPage.url : null,
    existingSchoolPageId: schoolPage ? schoolPage.id : null,
    existingSchoolPageName: schoolPage ? schoolPage.name : null,
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

  // 校舎ページ一致(allocation.targetUrl)を優先し、無ければ既存記事のURLを解決する。
  const targetUrl = allocation.targetUrl || resolveTargetUrl(candidate.existing_post_id);
  const targetPageType = allocation.targetUrl ? 'school_page' : null;

  // Sprint 3.8: Impact(期待流入・CV増)とDifficulty(1〜100)を算出する。
  // 既存のopportunity_score(加算式)とは完全に別軸の指標であり、置き換えない。
  const { expectedImpactClicks, expectedImpactCv } = computeExpectedImpact({
    searchDemand: candidate.search_demand,
    currentPosition: candidate.own_avg_position,
    taskType: allocation.taskType,
    targetPageType,
  });

  const competitorTypeCounts = competitorTypeCountsByKeyword.get(candidate.normalized_keyword) || {};
  const { difficulty: difficultyScore, breakdown: difficultyBreakdown } = computeDifficultyScore({
    competitorCount: candidate.competitor_count,
    competitorTypeCounts,
    currentPosition: candidate.own_avg_position,
  });

  // roi_priority_scoreはバッチ全体が揃った後でないと正規化できないため、ここでは
  // 生スコア(_rawRoiScore)のみ計算する。main()がバッチ全件を集めてから
  // normalizeRoiScoresInBatch()で確定させ、DB保存直前にこのフィールドを取り除く。
  const rawRoiScore = computeRawRoiScore(expectedImpactCv, difficultyScore);

  return {
    task_type: allocation.taskType,
    target_url: targetUrl,
    target_post_id: candidate.existing_post_id || null,
    target_page_type: targetPageType,
    target_page_id: allocation.targetPageId || null,
    target_page_name: allocation.targetPageName || null,
    target_keyword: candidate.normalized_keyword,
    source_candidate_id: candidate.id,
    priority_score: candidate.priority_score,
    opportunity_score: opportunityScore,
    opportunity_breakdown: opportunityBreakdown,
    estimated_effort_minutes: estimatedEffortMinutes,
    recommended_action: allocation.taskType,
    reason,
    difficulty_score: difficultyScore,
    difficulty_breakdown: difficultyBreakdown,
    expected_impact_clicks: expectedImpactClicks,
    expected_impact_cv: expectedImpactCv,
    roi_priority_score: null, // main()がバッチ正規化後に確定させる
    roi_score_computed_at: null, // 同上
    _rawRoiScore: rawRoiScore, // DB非保存の中間値(main()がnormalizeの入力に使い、保存前に削除する)
  };
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
  const competitorTypeCountsByKeyword = buildCompetitorTypeCountsByKeyword();
  const nowIso = new Date().toISOString();
  const stats = { tasks_created: 0, tasks_updated: 0, error_count: 0 };

  // Sprint 3.8: roi_priority_scoreはバッチ全体のImpact/Difficultyが出揃わないと
  // 正規化(min-max)できないため、まず全候補分のTaskペイロードを組み立ててから、
  // バッチ単位でROIスコアを確定させ、その後で保存/プレビューを行う(2段階処理)。
  const built = [];
  for (const candidate of candidates) {
    try {
      const taskPayload = buildTaskForCandidate(candidate, {
        effortMinutesByTaskType,
        opportunityWeights,
        totalCompetitorsConsidered,
        competitorTypeCountsByKeyword,
      });
      built.push({ candidate, taskPayload });
    } catch (err) {
      stats.error_count += 1;
      logError('seo_task_generate', `candidate_id=${candidate.id}: ${err.message}`);
    }
  }

  const rawRoiScores = built.map(({ taskPayload }) => taskPayload._rawRoiScore);
  const normalizedRoiScores = normalizeRoiScoresInBatch(rawRoiScores);

  built.forEach(({ taskPayload }, index) => {
    const roiScore = normalizedRoiScores[index];
    taskPayload.roi_priority_score = roiScore;
    taskPayload.roi_score_computed_at = roiScore == null ? null : nowIso;
    delete taskPayload._rawRoiScore;
  });

  for (const { candidate, taskPayload } of built) {
    if (dryRun) {
      const impactCv = taskPayload.expected_impact_cv != null ? taskPayload.expected_impact_cv.toFixed(2) : '算出不可';
      const impactClicks = taskPayload.expected_impact_clicks != null ? taskPayload.expected_impact_clicks.toFixed(1) : '算出不可';
      const roiScore = taskPayload.roi_priority_score != null ? taskPayload.roi_priority_score : '算出不可';
      console.log(
        `[seo_task_generate][dry-run] ${candidate.normalized_keyword}: task=${taskPayload.task_type} ` +
          `opportunity=${taskPayload.opportunity_score} | difficulty=${taskPayload.difficulty_score} ` +
          `impact_clicks=${impactClicks} impact_cv=${impactCv} roi_score=${roiScore}`
      );
      continue;
    }

    try {
      const result = seoDb.upsertTask(taskPayload, nowIso);
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

module.exports = { main, buildTaskForCandidate, buildCompetitorTypeCountsByKeyword };
