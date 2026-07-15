'use strict';

// Sprint 3.7: page_plan_staleness.js(stale判定共通ヘルパー)の単体テスト。
// DB非依存、純粋関数のみを対象。LLM呼び出し・外部通信は一切発生しない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePagePlanStaleness } = require('../scripts/lib/seo/page_plan_staleness');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('hash一致: staleではない', () => {
  const result = evaluatePagePlanStaleness({ source_content_hash: HASH_A }, { status: 'fetched', contentHash: HASH_A });
  assert.equal(result.determined, true);
  assert.equal(result.stale, false);
  assert.equal(result.reason, null);
  assert.equal(result.previousContentHash, HASH_A);
  assert.equal(result.currentContentHash, HASH_A);
});

test('hash不一致: staleと判定される', () => {
  const result = evaluatePagePlanStaleness({ source_content_hash: HASH_A }, { status: 'fetched', contentHash: HASH_B });
  assert.equal(result.determined, true);
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'content_hash_mismatch');
  assert.equal(result.previousContentHash, HASH_A);
  assert.equal(result.currentContentHash, HASH_B);
});

test('pageContext未取得(not_fetched): 判定不能', () => {
  const result = evaluatePagePlanStaleness({ source_content_hash: HASH_A }, { status: 'not_fetched' });
  assert.equal(result.determined, false);
  assert.equal(result.stale, false);
  assert.equal(result.currentContentHash, null);
});

test('pageContext未取得(blocked等の他status): 判定不能', () => {
  const result = evaluatePagePlanStaleness({ source_content_hash: HASH_A }, { status: 'blocked_ssrf' });
  assert.equal(result.determined, false);
});

test('pageContextがnull: 判定不能', () => {
  const result = evaluatePagePlanStaleness({ source_content_hash: HASH_A }, null);
  assert.equal(result.determined, false);
  assert.equal(result.previousContentHash, HASH_A);
});

test('source_content_hashがnull・pageContextのcontentHashがある: staleと判定される', () => {
  const result = evaluatePagePlanStaleness({ source_content_hash: null }, { status: 'fetched', contentHash: HASH_A });
  assert.equal(result.determined, true);
  assert.equal(result.stale, true);
  assert.equal(result.previousContentHash, null);
});

test('source_content_hashがnull・pageContextのcontentHashもnull: staleではない(両方nullは一致扱い)', () => {
  const result = evaluatePagePlanStaleness({ source_content_hash: null }, { status: 'fetched', contentHash: null });
  assert.equal(result.determined, true);
  assert.equal(result.stale, false);
});

test('不正な(形式不明の)hash文字列でも単純な文字列比較として判定する', () => {
  const result = evaluatePagePlanStaleness({ source_content_hash: 'not-a-valid-sha256' }, { status: 'fetched', contentHash: 'also-not-valid' });
  assert.equal(result.determined, true);
  assert.equal(result.stale, true);
});

test('pagePlanがnullでも例外を投げず判定不能を返す', () => {
  const result = evaluatePagePlanStaleness(null, { status: 'fetched', contentHash: HASH_A });
  assert.equal(result.determined, true); // pageContextはfetchedなので判定は行われる
  assert.equal(result.previousContentHash, null);
  assert.equal(result.stale, true); // null !== HASH_A
});
