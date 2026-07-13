'use strict';

// GSC実績 → classifyKeywordGap(gap_type) → computeDataConfidence/computeOpportunityScore
// という既存の間接パイプライン(計算式は今回変更しない)が、実際のGSC同期データを通しても
// 正しく連動することを確認する結合テスト。dataConfidence(データの有無)とownCoverageGap
// (実際の順位等の方向性)は別軸であり、GSCデータの有無だけで両方が同じように
// 二重に動いてしまわないことも確認する。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_seo_gsc_opportunity_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { syncGscData } = require('../scripts/seo_gsc_sync');
const { classifyKeywordGap } = require('../scripts/lib/seo/gap_classifier');
const { computeDataConfidence } = require('../scripts/lib/seo/data_confidence');
const { computeOpportunityScore, ownCoverageGapRatio } = require('../scripts/lib/seo/opportunity_score');
const { loadJukuConfig } = require('../scripts/lib/config');

const WEIGHTS = loadJukuConfig().seo.growth_director.opportunity_score_weights;

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

function makeFakeProvider(rowsByDate) {
  return {
    async querySearchAnalytics({ startDate, endDate, dimensions, startRow }) {
      if (startRow > 0) return { rows: [], dimensions };
      const dateIndex = dimensions.indexOf('date');
      const rows = Object.entries(rowsByDate)
        .filter(([date]) => date >= startDate && date <= endDate)
        .map(([date, r]) => {
          const keys = [];
          keys[dateIndex] = date;
          keys[dimensions.indexOf('query')] = r.query;
          return { keys, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
        });
      return { rows, dimensions };
    },
  };
}

function runPipeline(aggregate, competitorCount) {
  const gap = classifyKeywordGap({
    competitorCount,
    totalCompetitorsConsidered: 5,
    ownAvgPosition: aggregate ? aggregate.avgPosition : null,
    ownImpressions: aggregate ? aggregate.impressions : null,
    ownCtr: aggregate ? aggregate.ctr : null,
    competitorBestPosition: 8,
  });
  const confidence = computeDataConfidence({ competitorCount, hasGscData: !!aggregate });
  const { score, breakdown } = computeOpportunityScore(
    {
      competitorAdoption: 0.6,
      areaRelevance: 0.5,
      searchIntent: 0.5,
      ownCoverageGap: ownCoverageGapRatio(gap.gapType),
      dataConfidence: confidence.score / 100,
      effortEfficiency: 0.5,
    },
    WEIGHTS
  );
  return { gapType: gap.gapType, confidence, score, breakdown };
}

test('GSCデータ無し: gap_typeはmissing/untapped系、ownCoverageGapは高くdata_confidenceのgsc_dataは0点', () => {
  const result = runPipeline(null, 2);
  assert.ok(['missing', 'untapped'].includes(result.gapType));
  assert.equal(result.breakdown.own_coverage_gap.ratio, 1.0);
  assert.equal(result.confidence.breakdown.gsc_data.points, 0);
});

test('GSCデータあり・弱い(11位以下): gap_type=weak、ownCoverageGapは中程度、data_confidenceのgsc_dataは15点', async () => {
  const provider = makeFakeProvider({
    '2026-10-01': { query: '守山区 個別指導', clicks: 1, impressions: 100, ctr: 0.01, position: 15 },
  });
  await syncGscData({ provider, siteProperty: 'https://an-english.com/', start: '2026-10-01', end: '2026-10-01', dryRun: false });
  const aggregate = seoDb.getGscAggregateForKeyword('守山区 個別指導');

  const result = runPipeline(aggregate, 2);
  assert.equal(result.gapType, 'weak');
  assert.equal(result.breakdown.own_coverage_gap.ratio, 0.5);
  assert.equal(result.confidence.breakdown.gsc_data.points, 15);
});

test('GSCデータあり・強い(10位以内で競合より上位): gap_type=strong、ownCoverageGapは0だがdata_confidenceのgsc_dataは同じ15点のまま(二重計上ではない)', async () => {
  const provider = makeFakeProvider({
    '2026-10-01': { query: '瓢箪山 塾', clicks: 20, impressions: 100, ctr: 0.2, position: 3 },
  });
  await syncGscData({ provider, siteProperty: 'https://an-english.com/', start: '2026-10-01', end: '2026-10-01', dryRun: false });
  const aggregate = seoDb.getGscAggregateForKeyword('瓢箪山 塾');

  const result = runPipeline(aggregate, 2);
  assert.equal(result.gapType, 'strong');
  assert.equal(result.breakdown.own_coverage_gap.ratio, 0); // strongはOpportunity上の優先度を下げる
  assert.equal(result.confidence.breakdown.gsc_data.points, 15); // データの有無という別軸は変わらない(二重計上ではない)
});

test('gap_typeの変化に応じてOpportunity Scoreの合計点も変化する(weak→strongで下がる)', async () => {
  const providerWeak = makeFakeProvider({ '2026-10-02': { query: '小幡 塾 弱い', clicks: 1, impressions: 100, ctr: 0.01, position: 15 } });
  await syncGscData({ provider: providerWeak, siteProperty: 'https://an-english.com/', start: '2026-10-02', end: '2026-10-02', dryRun: false });
  const weakResult = runPipeline(seoDb.getGscAggregateForKeyword('小幡 塾 弱い'), 2);

  const providerStrong = makeFakeProvider({ '2026-10-02': { query: '小幡 塾 強い', clicks: 20, impressions: 100, ctr: 0.2, position: 3 } });
  await syncGscData({ provider: providerStrong, siteProperty: 'https://an-english.com/', start: '2026-10-02', end: '2026-10-02', dryRun: false });
  const strongResult = runPipeline(seoDb.getGscAggregateForKeyword('小幡 塾 強い'), 2);

  assert.ok(strongResult.score < weakResult.score);
});
