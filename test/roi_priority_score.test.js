'use strict';

// Sprint 3.8: roi_priority_score.js(Impact×Difficulty合成・バッチ正規化)の単体テスト。
// DB非依存、純粋関数のみを対象。LLM呼び出し・外部通信は一切発生しない。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeDifficultyFactor,
  computeRawRoiScore,
  normalizeRoiScoresInBatch,
} = require('../scripts/lib/seo/roi_priority_score');

test('computeDifficultyFactor: difficulty=1(最易)はほぼ1.0', () => {
  assert.equal(computeDifficultyFactor(1), 1.0);
});

test('computeDifficultyFactor: difficulty=100(最難)は0.01', () => {
  assert.equal(computeDifficultyFactor(100), 0.01);
});

test('computeDifficultyFactor: difficulty=50は0.51', () => {
  assert.equal(computeDifficultyFactor(50), 0.51);
});

test('computeRawRoiScore: Impact×DifficultyFactorの単純な積', () => {
  // expectedImpactCv=10, difficulty=1 → factor=1.0 → raw=10
  assert.equal(computeRawRoiScore(10, 1), 10);
  // expectedImpactCv=10, difficulty=100 → factor=0.01 → raw=0.1
  assert.equal(computeRawRoiScore(10, 100), 0.1);
});

test('computeRawRoiScore: expectedImpactCvがnullならnull', () => {
  assert.equal(computeRawRoiScore(null, 50), null);
});

test('computeRawRoiScore: difficultyがnullならnull', () => {
  assert.equal(computeRawRoiScore(10, null), null);
});

test('normalizeRoiScoresInBatch: 通常のmin-max正規化(0〜100)', () => {
  const result = normalizeRoiScoresInBatch([0, 5, 10]);
  assert.deepEqual(result, [0, 50, 100]);
});

test('normalizeRoiScoresInBatch: 順序を保持する', () => {
  const result = normalizeRoiScoresInBatch([10, 0, 5]);
  assert.deepEqual(result, [100, 0, 50]);
});

test('normalizeRoiScoresInBatch: null要素はnullのまま結果に残る(正規化対象から除外)', () => {
  const result = normalizeRoiScoresInBatch([0, null, 10]);
  assert.deepEqual(result, [0, null, 100]);
});

test('normalizeRoiScoresInBatch: 全て同値(分母0)の場合は有効値すべてに50を割り当てる', () => {
  const result = normalizeRoiScoresInBatch([5, 5, 5]);
  assert.deepEqual(result, [50, 50, 50]);
});

test('normalizeRoiScoresInBatch: 全て同値かつnullが混在する場合、nullはnullのまま・有効値は50', () => {
  const result = normalizeRoiScoresInBatch([5, null, 5]);
  assert.deepEqual(result, [50, null, 50]);
});

test('normalizeRoiScoresInBatch: 有効値が1件も無ければ全てnullを返す', () => {
  const result = normalizeRoiScoresInBatch([null, null, null]);
  assert.deepEqual(result, [null, null, null]);
});

test('normalizeRoiScoresInBatch: 空配列は空配列を返す', () => {
  const result = normalizeRoiScoresInBatch([]);
  assert.deepEqual(result, []);
});

test('normalizeRoiScoresInBatch: 単一の有効値のみ(分母0)は50を割り当てる', () => {
  const result = normalizeRoiScoresInBatch([7]);
  assert.deepEqual(result, [50]);
});

test('normalizeRoiScoresInBatch: 負の値を含んでも正しく正規化する', () => {
  const result = normalizeRoiScoresInBatch([-5, 0, 5]);
  assert.deepEqual(result, [0, 50, 100]);
});
