'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeOpportunityScore,
  competitorAdoptionRatio,
  searchIntentRatio,
  ownCoverageGapRatio,
  effortEfficiencyRatio,
} = require('../scripts/lib/seo/opportunity_score');
const { loadJukuConfig } = require('../scripts/lib/config');

const WEIGHTS = loadJukuConfig().seo.growth_director.opportunity_score_weights;

test('computeOpportunityScore: 全軸満点なら100点', () => {
  const { score } = computeOpportunityScore(
    { competitorAdoption: 1, areaRelevance: 1, searchIntent: 1, ownCoverageGap: 1, dataConfidence: 1, effortEfficiency: 1 },
    WEIGHTS
  );
  assert.equal(score, 100);
});

test('computeOpportunityScore: 全軸0なら0点', () => {
  const { score } = computeOpportunityScore({}, WEIGHTS);
  assert.equal(score, 0);
});

test('computeOpportunityScore: priority_scoreの重み設定とは独立して動作する(config.seo.competitor_analysisに影響しない)', () => {
  const config = loadJukuConfig();
  assert.notEqual(config.seo.growth_director, config.seo.competitor_analysis);
});

test('competitorAdoptionRatio: 5社中3社なら0.6', () => {
  assert.equal(competitorAdoptionRatio(3, 5), 0.6);
});

test('competitorAdoptionRatio: 総数10社でも5社で頭打ちにする', () => {
  assert.equal(competitorAdoptionRatio(5, 10), 1);
});

test('searchIntentRatio: trial_inquiryが最も高くgeneral_serviceは中程度', () => {
  assert.ok(searchIntentRatio('trial_inquiry') > searchIntentRatio('general_service'));
});

test('ownCoverageGapRatio: missing/untappedは1.0、strongは0', () => {
  assert.equal(ownCoverageGapRatio('missing'), 1.0);
  assert.equal(ownCoverageGapRatio('untapped'), 1.0);
  assert.equal(ownCoverageGapRatio('strong'), 0);
});

test('effortEfficiencyRatio: 工数が小さいほど高スコア', () => {
  assert.ok(effortEfficiencyRatio(5) > effortEfficiencyRatio(30));
  assert.equal(effortEfficiencyRatio(5), 1.0);
  assert.equal(effortEfficiencyRatio(60), 0.2);
});

test('computeOpportunityScore: 内訳(breakdown)にratio/maxPoints/pointsが含まれる', () => {
  const { breakdown } = computeOpportunityScore({ competitorAdoption: 0.5 }, WEIGHTS);
  assert.equal(breakdown.competitor_adoption.ratio, 0.5);
  assert.equal(breakdown.competitor_adoption.maxPoints, 20);
  assert.equal(breakdown.competitor_adoption.points, 10);
});
