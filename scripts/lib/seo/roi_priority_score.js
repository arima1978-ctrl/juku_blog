'use strict';

// Sprint 3.8: Impact(expected_impact_cv)とDifficultyを掛け合わせ、バッチ内で
// 0〜100へmin-max正規化した「ROI優先度スコア」を算出する決定的処理。DB書き込み・
// LLM呼び出しは一切行わない。既存のopportunity_score(加算式、priority_scoreとは
// 独立)とはさらに別の第3の軸であり、いずれの既存スコアも変更・置換しない。
//
// 将来の改善候補(2026-07-29ユーザー指摘): 現状このスコアはキーワードの季節性を
// 考慮しない。実例: 「春期講習」(3月が旬)が「自立学習」(通年テーマ)より高スコアに
// なったが、7月公開では季節外れで実質選びにくい。expected_impact_cv/difficultyの
// 算出時点でキーワードの旬(publish_windowに類する概念)を加味する改善は未着手。

// difficulty(1〜100)を「易しさ」の比率へ変換する。difficulty=1(最も易しい)→ほぼ1.0、
// difficulty=100(最も難しい)→0.01。
function computeDifficultyFactor(difficulty) {
  return (101 - difficulty) / 100;
}

// expectedImpactCv/difficultyのいずれかがnull(算出不能)ならnullを返す(0にしない)。
function computeRawRoiScore(expectedImpactCv, difficulty) {
  if (expectedImpactCv == null || difficulty == null) return null;
  return expectedImpactCv * computeDifficultyFactor(difficulty);
}

// rawScores: (number|null)の配列。バッチ(今回生成されたTask全件)内でmin-max正規化し、
// 0〜100の整数配列(入力と同じ長さ・同じ順序)を返す。
//   - null要素は結果でもnullのまま(算出不能なものを順位付けの対象にしない)。
//   - 有効値が1件も無ければ全てnullを返す。
//   - 有効値の最大値と最小値が等しい(分母0)場合は、有効値全てに50を割り当てる。
function normalizeRoiScoresInBatch(rawScores) {
  const validValues = (rawScores || []).filter((v) => v != null);

  if (validValues.length === 0) {
    return (rawScores || []).map(() => null);
  }

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);

  if (max === min) {
    return rawScores.map((v) => (v == null ? null : 50));
  }

  return rawScores.map((v) => (v == null ? null : Math.round((100 * (v - min)) / (max - min))));
}

module.exports = { computeDifficultyFactor, computeRawRoiScore, normalizeRoiScoresInBatch };
