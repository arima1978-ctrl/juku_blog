'use strict';

// Sprint 3.8: impact_calculator.js(期待流入・CV増計算)の単体テスト。
// DB非依存、純粋関数のみを対象。LLM呼び出し・外部通信は一切発生しない。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeExpectedImpact,
  estimateCtr,
  resolveTargetPosition,
  CTR_CURVE,
} = require('../scripts/lib/seo/impact_calculator');

test('estimateCtr: 順位帯ごとの想定CTRを返す', () => {
  assert.equal(estimateCtr(1), 0.2);
  assert.equal(estimateCtr(3), 0.2);
  assert.equal(estimateCtr(4), 0.1);
  assert.equal(estimateCtr(5), 0.1);
  assert.equal(estimateCtr(6), 0.03);
  assert.equal(estimateCtr(10), 0.03);
  assert.equal(estimateCtr(11), 0.01);
  assert.equal(estimateCtr(20), 0.01);
  assert.equal(estimateCtr(21), 0.005);
  assert.equal(estimateCtr(30), 0.005);
  assert.equal(estimateCtr(31), 0);
  assert.equal(estimateCtr(100), 0);
});

test('estimateCtr: 未ランク(null)は0', () => {
  assert.equal(estimateCtr(null), 0);
});

test('CTR_CURVEは仕様どおりの5段階である', () => {
  assert.deepEqual(CTR_CURVE, [
    { maxPosition: 3, ctr: 0.2 },
    { maxPosition: 5, ctr: 0.1 },
    { maxPosition: 10, ctr: 0.03 },
    { maxPosition: 20, ctr: 0.01 },
    { maxPosition: 30, ctr: 0.005 },
  ]);
});

// --- 解決策①: 順位押し上げロジック ---

test('resolveTargetPosition: 現在順位がデフォルト目標より下位(悪い)ならデフォルト目標を使う', () => {
  // improve_school_pageのデフォルト目標=5位。現在15位(デフォルトより下位)。
  assert.equal(resolveTargetPosition('improve_school_page', 15), 5);
});

test('resolveTargetPosition: 現在順位が未ランク(null)ならデフォルト目標を使う', () => {
  assert.equal(resolveTargetPosition('improve_school_page', null), 5);
});

test('resolveTargetPosition: 現在順位がデフォルト目標と同じならさらに1つ上を目指す', () => {
  // デフォルト目標=5位、現在5位 → 4位を目指す
  assert.equal(resolveTargetPosition('improve_school_page', 5), 4);
});

test('resolveTargetPosition: 現在順位がデフォルト目標より上位(良い)ならさらに1つ上を目指す', () => {
  // デフォルト目標=5位、現在3位 → 2位を目指す
  assert.equal(resolveTargetPosition('improve_school_page', 3), 2);
});

test('resolveTargetPosition: 現在1位でも1位未満にはならない(下限1でクランプ)', () => {
  assert.equal(resolveTargetPosition('improve_school_page', 1), 1);
});

test('resolveTargetPosition: task_typeごとのデフォルト目標順位', () => {
  assert.equal(resolveTargetPosition('improve_school_page', 20), 5);
  assert.equal(resolveTargetPosition('add_faq', 20), 5);
  assert.equal(resolveTargetPosition('add_internal_links', 20), 5);
  assert.equal(resolveTargetPosition('improve_existing_article', 20), 6);
  assert.equal(resolveTargetPosition('create_article', 20), 8);
});

test('resolveTargetPosition: 目標順位未定義のtask_type(monitor等)はnull', () => {
  assert.equal(resolveTargetPosition('monitor', 20), null);
  assert.equal(resolveTargetPosition('exclude', 20), null);
});

// --- computeExpectedImpact 全体 ---

test('computeExpectedImpact: search_demandがnullなら全項目null', () => {
  const result = computeExpectedImpact({ searchDemand: null, currentPosition: 15, taskType: 'improve_school_page', targetPageType: 'school_page' });
  assert.deepEqual(result, {
    expectedImpactClicks: null,
    expectedImpactCv: null,
    targetPosition: null,
    ctrBefore: null,
    ctrAfter: null,
    cvr: null,
  });
});

test('computeExpectedImpact: 校舎ページ・現在15位→目標5位の正常系計算', () => {
  const result = computeExpectedImpact({
    searchDemand: 1000,
    currentPosition: 15,
    taskType: 'improve_school_page',
    targetPageType: 'school_page',
  });
  // ctrBefore(15位)=0.01, ctrAfter(5位)=0.1
  assert.equal(result.ctrBefore, 0.01);
  assert.equal(result.ctrAfter, 0.1);
  assert.equal(result.targetPosition, 5);
  // trafficBefore=1000*0.01=10, trafficAfter=1000*0.1=100, clicks=90
  assert.equal(result.expectedImpactClicks, 90);
  // CVR school_page = 0.015 → 90*0.015 ≈ 1.35(浮動小数点誤差を許容)
  assert.ok(Math.abs(result.expectedImpactCv - 1.35) < 1e-9);
  assert.equal(result.cvr, 0.015);
});

test('computeExpectedImpact: ブログ(targetPageType=null)はCVRが低い(0.1%)', () => {
  const result = computeExpectedImpact({
    searchDemand: 1000,
    currentPosition: 15,
    taskType: 'create_article',
    targetPageType: null,
  });
  assert.equal(result.cvr, 0.001);
  // targetPosition(create_article, 現在15位 > デフォルト8) = 8
  assert.equal(result.targetPosition, 8);
  // ctrBefore(15)=0.01, ctrAfter(8)=0.03, clicks=1000*(0.03-0.01)=20
  assert.equal(result.expectedImpactClicks, 20);
  assert.equal(result.expectedImpactCv, 0.02); // 20*0.001
});

test('computeExpectedImpact: 未ランク(currentPosition=null)からの新規獲得も計算できる', () => {
  const result = computeExpectedImpact({
    searchDemand: 500,
    currentPosition: null,
    taskType: 'create_article',
    targetPageType: null,
  });
  assert.equal(result.ctrBefore, 0);
  assert.equal(result.targetPosition, 8);
  assert.equal(result.ctrAfter, 0.03);
  assert.equal(result.expectedImpactClicks, 15); // 500*0.03
});

test('computeExpectedImpact: 現状より改善しない(既に上位)場合でも負値にならない(0クランプ)', () => {
  // 現在1位、目標もresolveTargetPositionにより1位未満にはならないため差分は基本非負。
  // ここではCTRカーブの丸め誤差等でも負にならないことを確認する境界値。
  const result = computeExpectedImpact({
    searchDemand: 200,
    currentPosition: 1,
    taskType: 'improve_school_page',
    targetPageType: 'school_page',
  });
  assert.ok(result.expectedImpactClicks >= 0);
});

test('computeExpectedImpact: 目標順位未定義のtask_type(monitor)はclicks=0扱い', () => {
  const result = computeExpectedImpact({
    searchDemand: 1000,
    currentPosition: 15,
    taskType: 'monitor',
    targetPageType: null,
  });
  assert.equal(result.targetPosition, null);
  assert.equal(result.expectedImpactClicks, 0);
  assert.equal(result.expectedImpactCv, 0);
});
