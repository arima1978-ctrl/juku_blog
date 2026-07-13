'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDataConfidence } = require('../scripts/lib/seo/data_confidence');

test('computeDataConfidence: 全項目満点なら100点', () => {
  const { score, breakdown } = computeDataConfidence({
    competitorCount: 5,
    evidencePageCount: 5,
    sameZone: 'title',
    hasGscData: true,
    hasSearchDemandData: true,
    hasSerpData: true,
  });
  assert.equal(score, 100);
  assert.equal(breakdown.competitor_adoption.points, 20);
  assert.equal(breakdown.zone_cooccurrence.points, 20);
});

test('computeDataConfidence: 全データ無しなら0点(priority_scoreには影響しない、というのはこの関数の外側の設計方針)', () => {
  const { score } = computeDataConfidence({});
  assert.equal(score, 0);
});

test('computeDataConfidence: competitorCount/evidencePageCountは5件で頭打ち', () => {
  const { breakdown } = computeDataConfidence({ competitorCount: 100, evidencePageCount: 100 });
  assert.equal(breakdown.competitor_adoption.points, 20);
  assert.equal(breakdown.evidence_page_count.points, 20);
});

test('computeDataConfidence: 同一ゾーン共起が無くてもページ内共起があれば10点', () => {
  const { breakdown } = computeDataConfidence({ evidencePageCount: 1, sameZone: null });
  assert.equal(breakdown.zone_cooccurrence.points, 10);
});

test('computeDataConfidence: GSC/検索需要/順位データそれぞれ個別に加点される', () => {
  const withGsc = computeDataConfidence({ hasGscData: true });
  const withDemand = computeDataConfidence({ hasSearchDemandData: true });
  const withSerp = computeDataConfidence({ hasSerpData: true });
  assert.equal(withGsc.score, 15);
  assert.equal(withDemand.score, 15);
  assert.equal(withSerp.score, 10);
});
