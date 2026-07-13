'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computePriorityScore, computeAreaRelevanceRatio, computeInquiryIntentRatio } = require('../scripts/lib/seo/priority_scorer');
const { loadJukuConfig } = require('../scripts/lib/config');

const WEIGHTS = loadJukuConfig().seo.competitor_analysis.priority_score_weights;

test('computePriorityScore: 全観点満点なら100点、内訳も満点になる', () => {
  const { score, breakdown } = computePriorityScore(
    {
      areaRelevance: 1,
      inquiryIntent: 1,
      competitorAdoption: 1,
      competitorRank: 1,
      searchDemand: 1,
      ownRankImprovement: 1,
      seasonality: 1,
    },
    WEIGHTS
  );
  assert.equal(score, 100);
  assert.equal(breakdown.area_relevance.points, 25);
  assert.equal(breakdown.inquiry_intent.points, 25);
});

test('computePriorityScore: 全観点0なら0点', () => {
  const { score } = computePriorityScore({}, WEIGHTS);
  assert.equal(score, 0);
});

test('computePriorityScore: 検索需要0でも地域関連性・問い合わせ意図が高ければ高得点になる(需要0だけで除外しない)', () => {
  const { score } = computePriorityScore(
    { areaRelevance: 1, inquiryIntent: 1, searchDemand: 0 },
    WEIGHTS
  );
  assert.ok(score >= 50); // area(25)+intent(25)だけで50点相当
});

test('computePriorityScore: 内訳(breakdown)にratio/maxPoints/pointsが含まれる', () => {
  const { breakdown } = computePriorityScore({ areaRelevance: 0.5 }, WEIGHTS);
  assert.equal(breakdown.area_relevance.ratio, 0.5);
  assert.equal(breakdown.area_relevance.maxPoints, 25);
  assert.equal(breakdown.area_relevance.points, 13); // Math.round(0.5*25)
});

test('computePriorityScore: 設定(config)から重みを変更すればスコアも変わる', () => {
  const customWeights = { ...WEIGHTS, area_relevance: 50 };
  const { score } = computePriorityScore({ areaRelevance: 1 }, customWeights);
  assert.equal(score, 50);
});

test('computeAreaRelevanceRatio: 対象地域(neighborhoods)を含めば満点', () => {
  const areaDict = { neighborhoods: ['小幡'], ward: '守山区', city: '名古屋市守山区', prefecture: '愛知県' };
  assert.equal(computeAreaRelevanceRatio('小幡 塾', areaDict), 1.0);
});

test('computeAreaRelevanceRatio: 対象外地域(何も一致しない)は0', () => {
  const areaDict = { neighborhoods: ['小幡'], ward: '守山区', city: '名古屋市守山区', prefecture: '愛知県' };
  assert.equal(computeAreaRelevanceRatio('東京都 塾', areaDict), 0);
});

test('computeInquiryIntentRatio: 求人等の低意図語を含めば0(高意図語と両方あっても0)', () => {
  assert.equal(computeInquiryIntentRatio('塾 講師募集'), 0);
});

test('computeInquiryIntentRatio: 高意図語(無料体験等)を含めば加点', () => {
  assert.ok(computeInquiryIntentRatio('無料体験 塾') > 0);
});
