'use strict';

// Sprint 3.8: 外部SEO APIを使わず、自前で登録している競合レジストリ(seo_competitors)
// のデータのみからDifficulty(1〜100)を算出する決定的処理。DB書き込み・LLM呼び出しは
// 一切行わない(competitorTypeCountsは呼び出し側がDBから解決して渡す)。

const BASE_SCORE = 10;
const PER_COMPETITOR_POINT = 6;

// 競合ドメイン種別ごとの加点(config/seo_competitors.yamlのcompetitor_type enumと対応)。
// subject_specialist/otherは未登録のため加点0(将来登録された場合の安全側デフォルト)。
const COMPETITOR_TYPE_BONUS = {
  major_chain: 15,
  exam_specialist: 10,
  information_media: 8,
  local: 2,
};

// 解決策②: 既得権益ディスカウント。既に一定順位に入っているキーワードは、
// Googleに評価されている証拠として難易度を割り引く(=既に取れているものは相対的に易しい)。
function trustDiscountFor(currentPosition) {
  if (currentPosition == null) return 1.0;
  if (currentPosition <= 10) return 0.5;
  if (currentPosition <= 20) return 0.7;
  if (currentPosition <= 30) return 0.85;
  return 1.0;
}

// competitorCount: seo_keyword_candidates.competitor_count相当(このキーワードに
//   言及している登録競合の総数)。
// competitorTypeCounts: { major_chain, exam_specialist, information_media, local, ... }
//   競合ドメイン種別ごとの件数(呼び出し側がseo_competitors.competitor_typeを引いて集計する)。
// currentPosition: own_avg_position相当(null=未ランク)。
function computeDifficultyScore({ competitorCount, competitorTypeCounts, currentPosition } = {}) {
  const safeCompetitorCount = competitorCount || 0;
  const safeTypeCounts = competitorTypeCounts || {};

  const countPoints = safeCompetitorCount * PER_COMPETITOR_POINT;

  const typeBonusBreakdown = {};
  let typeBonusTotal = 0;
  for (const [type, bonusPerCompetitor] of Object.entries(COMPETITOR_TYPE_BONUS)) {
    const count = safeTypeCounts[type] || 0;
    const points = count * bonusPerCompetitor;
    typeBonusBreakdown[type] = { count, bonusPerCompetitor, points };
    typeBonusTotal += points;
  }

  const baseScore = Math.min(100, BASE_SCORE + countPoints + typeBonusTotal);
  const trustDiscount = trustDiscountFor(currentPosition);
  const difficulty = Math.max(1, Math.min(100, Math.round(baseScore * trustDiscount)));

  return {
    difficulty,
    breakdown: {
      base: BASE_SCORE,
      competitorCount: safeCompetitorCount,
      countPoints,
      competitorTypeBonus: typeBonusBreakdown,
      baseScoreBeforeDiscount: baseScore,
      currentPosition: currentPosition ?? null,
      trustDiscount,
    },
  };
}

module.exports = {
  computeDifficultyScore,
  trustDiscountFor,
  BASE_SCORE,
  PER_COMPETITOR_POINT,
  COMPETITOR_TYPE_BONUS,
};
