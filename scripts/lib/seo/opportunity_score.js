'use strict';

// Opportunity Score(0〜100)。priority_scoreとは完全に独立したスコアで、
// 「今すぐ着手する価値があるか」を表す。数式のみで算出し、AIには数値を決めさせない。
// config/juku.yamlのseo.growth_director.opportunity_score_weightsで配点を調整できる。

function clampRatio(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const DIMENSION_TO_WEIGHT_KEY = {
  competitorAdoption: 'competitor_adoption',
  areaRelevance: 'area_relevance',
  searchIntent: 'search_intent',
  ownCoverageGap: 'own_coverage_gap',
  dataConfidence: 'data_confidence',
  effortEfficiency: 'effort_efficiency',
};

// dimensions: 各軸0〜1の充足率。weights: config/juku.yamlのopportunity_score_weights
function computeOpportunityScore(dimensions, weights) {
  const breakdown = {};
  let total = 0;
  for (const [dimensionKey, weightKey] of Object.entries(DIMENSION_TO_WEIGHT_KEY)) {
    const maxPoints = weights[weightKey] || 0;
    const ratio = clampRatio(dimensions[dimensionKey]);
    const points = Math.round(ratio * maxPoints);
    breakdown[weightKey] = { ratio, maxPoints, points };
    total += points;
  }
  return { score: Math.max(0, Math.min(100, total)), breakdown };
}

// 競合採用数の充足率(5社で頭打ち。priority_scorer.jsのcompetitor_adoptionと同じ考え方)
function competitorAdoptionRatio(competitorCount, totalCompetitorsConsidered) {
  if (!totalCompetitorsConsidered) return 0;
  return clampRatio((competitorCount || 0) / Math.min(totalCompetitorsConsidered, 5));
}

// search_intentラベル(seo_gap_calculate.jsのSEARCH_INTENT_BY_TEMPLATE参照)から充足率を算出。
// 問い合わせに直結する意図ほど高いスコアにする。
const SEARCH_INTENT_RATIO = {
  trial_inquiry: 1.0,
  exam_prep: 0.8,
  seasonal_course: 0.7,
  general_service: 0.5,
};
function searchIntentRatio(searchIntent) {
  return SEARCH_INTENT_RATIO[searchIntent] ?? 0.3;
}

// gap_typeから「自社がまだカバーできていない度合い」を算出。カバーできていないほど機会が大きい。
const OWN_COVERAGE_GAP_RATIO = {
  missing: 1.0,
  untapped: 1.0,
  content_gap: 1.0,
  weak: 0.5,
  shared: 0.3,
  strong: 0,
};
function ownCoverageGapRatio(gapType) {
  return OWN_COVERAGE_GAP_RATIO[gapType] ?? 0.3;
}

// 見積り工数(分)が小さいほど高スコア(工数対効果が良い)。
function effortEfficiencyRatio(estimatedEffortMinutes) {
  if (estimatedEffortMinutes == null) return 0.5; // 不明な場合は中立
  if (estimatedEffortMinutes <= 5) return 1.0;
  if (estimatedEffortMinutes <= 10) return 0.8;
  if (estimatedEffortMinutes <= 15) return 0.6;
  if (estimatedEffortMinutes <= 30) return 0.4;
  return 0.2;
}

module.exports = {
  computeOpportunityScore,
  competitorAdoptionRatio,
  searchIntentRatio,
  ownCoverageGapRatio,
  effortEfficiencyRatio,
};
