'use strict';

// Sprint 3.8: difficulty_score.js(自前競合レジストリのみによるDifficulty算出)の単体テスト。
// DB非依存、純粋関数のみを対象。LLM呼び出し・外部通信は一切発生しない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDifficultyScore, trustDiscountFor } = require('../scripts/lib/seo/difficulty_score');

test('competitorCount=0・競合種別なし: baseのみ(10点)', () => {
  const result = computeDifficultyScore({ competitorCount: 0, competitorTypeCounts: {}, currentPosition: null });
  assert.equal(result.difficulty, 10);
});

test('competitorCountに応じて1社ごとに+6点', () => {
  const result = computeDifficultyScore({ competitorCount: 3, competitorTypeCounts: {}, currentPosition: null });
  // base10 + 3*6 = 28
  assert.equal(result.difficulty, 28);
});

test('競合種別ごとの加点: major_chainは+15', () => {
  const result = computeDifficultyScore({
    competitorCount: 1,
    competitorTypeCounts: { major_chain: 1 },
    currentPosition: null,
  });
  // base10 + 1*6(count) + 1*15(major_chain) = 31
  assert.equal(result.difficulty, 31);
  assert.equal(result.breakdown.competitorTypeBonus.major_chain.points, 15);
});

test('競合種別ごとの加点: exam_specialistは+10', () => {
  const result = computeDifficultyScore({
    competitorCount: 1,
    competitorTypeCounts: { exam_specialist: 1 },
    currentPosition: null,
  });
  assert.equal(result.difficulty, 10 + 6 + 10);
});

test('競合種別ごとの加点: information_mediaは+8', () => {
  const result = computeDifficultyScore({
    competitorCount: 1,
    competitorTypeCounts: { information_media: 1 },
    currentPosition: null,
  });
  assert.equal(result.difficulty, 10 + 6 + 8);
});

test('競合種別ごとの加点: localは+2(小さめ)', () => {
  const result = computeDifficultyScore({
    competitorCount: 1,
    competitorTypeCounts: { local: 1 },
    currentPosition: null,
  });
  assert.equal(result.difficulty, 10 + 6 + 2);
});

test('複数種別が混在する場合はそれぞれ加算される', () => {
  const result = computeDifficultyScore({
    competitorCount: 3,
    competitorTypeCounts: { major_chain: 1, local: 2 },
    currentPosition: null,
  });
  // base10 + count(3*6=18) + major_chain(1*15) + local(2*2=4) = 47
  assert.equal(result.difficulty, 47);
});

test('基礎スコアの上限は100(割引前にクランプされる)', () => {
  const result = computeDifficultyScore({
    competitorCount: 20,
    competitorTypeCounts: { major_chain: 10 },
    currentPosition: null,
  });
  assert.equal(result.breakdown.baseScoreBeforeDiscount, 100);
  assert.equal(result.difficulty, 100); // 割引なしなのでそのまま100
});

// --- 解決策②: 既得権益ディスカウント ---

test('trustDiscountFor: 1〜10位は0.5(50%オフ)', () => {
  assert.equal(trustDiscountFor(1), 0.5);
  assert.equal(trustDiscountFor(10), 0.5);
});

test('trustDiscountFor: 11〜20位は0.7(30%オフ)', () => {
  assert.equal(trustDiscountFor(11), 0.7);
  assert.equal(trustDiscountFor(20), 0.7);
});

test('trustDiscountFor: 21〜30位は0.85(15%オフ)', () => {
  assert.equal(trustDiscountFor(21), 0.85);
  assert.equal(trustDiscountFor(30), 0.85);
});

test('trustDiscountFor: 31位以降は割引なし(1.0)', () => {
  assert.equal(trustDiscountFor(31), 1.0);
  assert.equal(trustDiscountFor(100), 1.0);
});

test('trustDiscountFor: 未ランク(null)は割引なし(1.0)', () => {
  assert.equal(trustDiscountFor(null), 1.0);
});

test('既得権益ディスカウントが最終スコアへ正しく反映される(1〜10位で50%オフ)', () => {
  const result = computeDifficultyScore({
    competitorCount: 3,
    competitorTypeCounts: { major_chain: 1 },
    currentPosition: 5,
  });
  // baseScoreBeforeDiscount = 10 + 18 + 15 = 43, discount=0.5 → round(21.5) = 22
  assert.equal(result.breakdown.baseScoreBeforeDiscount, 43);
  assert.equal(result.breakdown.trustDiscount, 0.5);
  assert.equal(result.difficulty, 22);
});

test('最終スコアは下限1・上限100でクランプされる', () => {
  const result = computeDifficultyScore({ competitorCount: 0, competitorTypeCounts: {}, currentPosition: 5 });
  // base=10, discount=0.5 → round(5) = 5(下限1は超えている)
  assert.equal(result.difficulty, 5);
  assert.ok(result.difficulty >= 1);
});

test('breakdownに算出根拠が保存される(監査用)', () => {
  const result = computeDifficultyScore({
    competitorCount: 2,
    competitorTypeCounts: { local: 2 },
    currentPosition: 15,
  });
  assert.equal(result.breakdown.base, 10);
  assert.equal(result.breakdown.competitorCount, 2);
  assert.equal(result.breakdown.countPoints, 12);
  assert.equal(result.breakdown.currentPosition, 15);
  assert.equal(result.breakdown.trustDiscount, 0.7);
});

test('引数省略時も例外を投げず安全なデフォルトで計算する', () => {
  const result = computeDifficultyScore({});
  assert.equal(result.difficulty, 10); // base only, no discount(currentPosition=undefined→null扱い)
});
