'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyKeywordGap } = require('../scripts/lib/seo/gap_classifier');

test('missing: 競合(複数)が扱い自社に記事も検索実績も無い', () => {
  const result = classifyKeywordGap({ competitorCount: 3, totalCompetitorsConsidered: 3, ownHasArticle: false });
  assert.equal(result.gapType, 'missing');
});

test('missing: 競合1社のみでも自社に何もなければmissing扱い(totalCompetitorsConsidered未指定)', () => {
  const result = classifyKeywordGap({ competitorCount: 1, ownHasArticle: false });
  assert.equal(result.gapType, 'missing');
});

test('untapped: 一部の競合のみが扱い自社に何もない(totalCompetitorsConsidered指定あり)', () => {
  const result = classifyKeywordGap({ competitorCount: 1, totalCompetitorsConsidered: 5, ownHasArticle: false });
  assert.equal(result.gapType, 'untapped');
});

test('weak: 自社記事はあるが平均順位11位以下', () => {
  const result = classifyKeywordGap({ competitorCount: 2, ownHasArticle: true, ownAvgPosition: 15 });
  assert.equal(result.gapType, 'weak');
  assert.ok(result.reasons.includes('own_avg_position_11_or_worse'));
});

test('weak: 表示回数はあるがCTRが低い', () => {
  const result = classifyKeywordGap({ competitorCount: 1, ownHasArticle: true, ownAvgPosition: 5, ownImpressions: 500, ownCtr: 0.005 });
  assert.equal(result.gapType, 'weak');
  assert.ok(result.reasons.includes('impressions_present_but_low_ctr'));
});

test('weak: 自社記事が競合より情報量で劣ると判定された場合', () => {
  const result = classifyKeywordGap({ competitorCount: 1, ownHasArticle: true, ownAvgPosition: 3, ownContentThinnerThanCompetitor: true });
  assert.equal(result.gapType, 'weak');
});

test('weak: 競合の方が自社より順位が良い', () => {
  const result = classifyKeywordGap({ competitorCount: 1, ownHasArticle: true, ownAvgPosition: 8, competitorBestPosition: 3 });
  assert.equal(result.gapType, 'weak');
});

test('shared: 自社・競合ともに扱っており明確な優劣signalが無い', () => {
  const result = classifyKeywordGap({ competitorCount: 2, ownHasArticle: true, ownAvgPosition: 9, competitorBestPosition: 9 });
  assert.equal(result.gapType, 'shared');
});

test('strong: 自社が競合より上位かつ10位以内', () => {
  const result = classifyKeywordGap({ competitorCount: 2, ownHasArticle: true, ownAvgPosition: 3, competitorBestPosition: 7 });
  assert.equal(result.gapType, 'strong');
});

test('strong: 競合データが無いが自社が10位以内で十分な実績', () => {
  const result = classifyKeywordGap({ competitorCount: 0, ownHasArticle: true, ownAvgPosition: 4 });
  assert.equal(result.gapType, 'strong');
});

test('content_gap: テーマ単位で複数競合が扱い自社に該当記事が無い', () => {
  const result = classifyKeywordGap({ competitorCount: 3, ownHasArticle: false, matchType: 'theme' });
  assert.equal(result.gapType, 'content_gap');
});

test('データ不足: 自社に記事はあるが順位・表示回数データが無い場合、推測でstrong判定しない', () => {
  const result = classifyKeywordGap({ competitorCount: 2, ownHasArticle: true, ownAvgPosition: null, ownImpressions: null });
  assert.notEqual(result.gapType, 'strong');
  assert.equal(result.gapType, 'shared');
});

test('データ不足: 自社にも競合にも何の根拠も無い場合はgapType=nullで候補化しない', () => {
  const result = classifyKeywordGap({ competitorCount: 0, ownHasArticle: false });
  assert.equal(result.gapType, null);
});

test('競合複数社: competitorCountが総数と一致すればuntappedにならずmissingになる', () => {
  const result = classifyKeywordGap({ competitorCount: 4, totalCompetitorsConsidered: 4, ownHasArticle: false });
  assert.equal(result.gapType, 'missing');
});
