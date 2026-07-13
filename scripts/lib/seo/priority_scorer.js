'use strict';

// 優先度スコア(0〜100)の算出。各観点は0〜1の充足率(ratio)として受け取り、
// config/juku.yamlのseo.competitor_analysis.priority_score_weightsの配点を掛けて合計する。
// 内訳(breakdown)を必ず返し、「なぜその点数になったか」を後から確認できるようにする。
// 検索需要が0でも他の観点(特にarea_relevance)で高得点になり得る設計(地域密着キーワードの評価漏れ防止)。

const { HIGH_INTENT_TERMS, LOW_INTENT_TERMS } = require('./dictionaries');

function clampRatio(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// dimensions: { areaRelevance, inquiryIntent, competitorAdoption, competitorRank, searchDemand, ownRankImprovement, seasonality }
//   (それぞれ0〜1の充足率)
// weights: config/juku.yamlのpriority_score_weights({area_relevance, inquiry_intent, ...}、各項目の満点)
function computePriorityScore(dimensions, weights) {
  const dimensionToWeightKey = {
    areaRelevance: 'area_relevance',
    inquiryIntent: 'inquiry_intent',
    competitorAdoption: 'competitor_adoption',
    competitorRank: 'competitor_rank',
    searchDemand: 'search_demand',
    ownRankImprovement: 'own_rank_improvement',
    seasonality: 'seasonality',
  };

  const breakdown = {};
  let total = 0;
  for (const [dimensionKey, weightKey] of Object.entries(dimensionToWeightKey)) {
    const maxPoints = weights[weightKey] || 0;
    const ratio = clampRatio(dimensions[dimensionKey]);
    const points = Math.round(ratio * maxPoints);
    breakdown[weightKey] = { ratio, maxPoints, points };
    total += points;
  }

  const score = Math.max(0, Math.min(100, total));
  return { score, breakdown };
}

// 地域関連性の充足率算出。対象校舎と同一地域(neighborhoods/city)なら1.0、
// 同一都道府県内なら0.4、対象外なら0(除外候補として扱えるよう0を許容する)。
function computeAreaRelevanceRatio(keywordText, areaDictionary) {
  const text = keywordText || '';
  if (areaDictionary.neighborhoods.some((n) => text.includes(n))) return 1.0;
  if (areaDictionary.ward && text.includes(areaDictionary.ward)) return 0.9;
  if (areaDictionary.city && text.includes(areaDictionary.city)) return 0.9;
  if (areaDictionary.prefecture && text.includes(areaDictionary.prefecture)) return 0.4;
  return 0;
}

// 問い合わせ意図の充足率算出。高意図語を含めば加点、低意図語(求人等)を含めば0にする。
// 注意: 「高意図語を含まない」ことは「除外すべき」ことを意味しない(教科名・学年名・地域名
// 単体は高意図語リストに無いが、除外対象ではない)。除外判定には isLowIntentKeyword を使うこと。
function computeInquiryIntentRatio(keywordText) {
  const text = keywordText || '';
  if (LOW_INTENT_TERMS.some((term) => text.includes(term))) return 0;
  const matched = HIGH_INTENT_TERMS.filter((term) => text.includes(term)).length;
  if (matched === 0) return 0;
  return clampRatio(matched / 2); // 2語一致で満点相当(それ以上は頭打ち)
}

// 求人・アルバイト等、塾集客と無関係な低意図語を明示的に含むかどうか。
// 除外(exclude)判定はこちらを使う(computeInquiryIntentRatio===0は「高意図語が無い」だけの
// 中立ケースも含むため、除外判定には使えない)。
function isLowIntentKeyword(keywordText) {
  const text = keywordText || '';
  return LOW_INTENT_TERMS.some((term) => text.includes(term));
}

module.exports = { computePriorityScore, computeAreaRelevanceRatio, computeInquiryIntentRatio, isLowIntentKeyword };
