'use strict';

// data_confidence(0〜100点)の算出。priority_scoreとは完全に独立した軸であり、
// 「どれだけ確からしいデータに基づく判定か」だけを表す。データが無い項目は単に
// 0点になるだけで、priority_score側には一切影響させない(データ不足を理由に
// priority_scoreを不当に下げない、という設計方針を維持するため)。

const MAX_POINTS = {
  competitor_adoption: 20,
  evidence_page_count: 20,
  zone_cooccurrence: 20,
  gsc_data: 15,
  search_demand_data: 15,
  serp_data: 10,
};

// input:
//   competitorCount: この複合キーワードを扱っている競合数
//   evidencePageCount: 根拠ページ数(競合ページの延べ件数)
//   sameZone: 複合キーワードの構成語がtitle/H1/H2の同一ゾーンで共起していればゾーン名、なければnull
//   hasGscData / hasSearchDemandData / hasSerpData: 各データソースの有無
function computeDataConfidence({
  competitorCount = 0,
  evidencePageCount = 0,
  sameZone = null,
  hasGscData = false,
  hasSearchDemandData = false,
  hasSerpData = false,
}) {
  const breakdown = {
    competitor_adoption: { points: Math.min(competitorCount, 5) * 4, maxPoints: MAX_POINTS.competitor_adoption },
    evidence_page_count: { points: Math.min(evidencePageCount, 5) * 4, maxPoints: MAX_POINTS.evidence_page_count },
    zone_cooccurrence: { points: sameZone ? 20 : (evidencePageCount > 0 ? 10 : 0), maxPoints: MAX_POINTS.zone_cooccurrence },
    gsc_data: { points: hasGscData ? 15 : 0, maxPoints: MAX_POINTS.gsc_data },
    search_demand_data: { points: hasSearchDemandData ? 15 : 0, maxPoints: MAX_POINTS.search_demand_data },
    serp_data: { points: hasSerpData ? 10 : 0, maxPoints: MAX_POINTS.serp_data },
  };

  const total = Object.values(breakdown).reduce((sum, b) => sum + b.points, 0);
  return { score: Math.max(0, Math.min(100, total)), breakdown };
}

module.exports = { computeDataConfidence };
