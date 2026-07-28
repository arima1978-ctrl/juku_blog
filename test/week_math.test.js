'use strict';

// 週次スナップショットの対象週計算(2026-07-29、実インシデント回帰テスト)。
// 「今日を含む週」を対象にすると記録時点でその週の後半3日分のGSCデータが必ず欠ける
// バグがあった。曜日を問わず常に「先週(完全に終わっている週)」を返すことを検証する。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getLastCompleteWeekStart, weekEndOfLocal } = require('../scripts/lib/seo/week_math');

test('getLastCompleteWeekStart: 日曜(週次バッチの実行曜日)に実行すると先週の月曜を返す', () => {
  // 2026-08-02は日曜日。先週(完全な週)は2026-07-20(月)〜07-26(日)。
  assert.equal(getLastCompleteWeekStart(new Date(2026, 7, 2)), '2026-07-20');
});

test('getLastCompleteWeekStart: 月曜に実行しても先週の月曜を返す(今週ではない)', () => {
  // 2026-07-27は月曜日。今週(7/27〜8/2)はまだ始まったばかりで完全ではないため、
  // 先週(7/20〜7/26)を返すべき。
  assert.equal(getLastCompleteWeekStart(new Date(2026, 6, 27)), '2026-07-20');
});

test('getLastCompleteWeekStart: 水曜に実行しても先週の月曜を返す(今週の火曜日を誤って返さない)', () => {
  // 2026-07-29は水曜日。
  assert.equal(getLastCompleteWeekStart(new Date(2026, 6, 29)), '2026-07-20');
});

test('getLastCompleteWeekStart: 土曜に実行しても先週の月曜を返す(週の残り1日を待たない)', () => {
  // 2026-08-01は土曜日。今週(7/27〜8/2)はまだ完全ではない。
  assert.equal(getLastCompleteWeekStart(new Date(2026, 7, 1)), '2026-07-20');
});

test('getLastCompleteWeekStart: 月をまたいでも正しく計算する', () => {
  // 2026-08-03は月曜日。先週は2026-07-27(月)〜08-02(日)。
  assert.equal(getLastCompleteWeekStart(new Date(2026, 7, 3)), '2026-07-27');
});

test('getLastCompleteWeekStart: 年をまたいでも正しく計算する', () => {
  // 2027-01-04は月曜日。先週は2026-12-28(月)〜2027-01-03(日)。
  assert.equal(getLastCompleteWeekStart(new Date(2027, 0, 4)), '2026-12-28');
});

test('weekEndOfLocal: 月曜から6日後(日曜)を返す', () => {
  assert.equal(weekEndOfLocal('2026-07-20'), '2026-07-26');
});

test('weekEndOfLocal: 月をまたいでも正しく計算する', () => {
  assert.equal(weekEndOfLocal('2026-07-27'), '2026-08-02');
});

test('getLastCompleteWeekStart: 曜日によらず常に「今週」より前の週を返す(今週・未来の週を誤って選ばない)', () => {
  for (let dow = 0; dow < 7; dow += 1) {
    // 2026-07-26(日)を起点に、7日間の各曜日で検証する
    const now = new Date(2026, 6, 26 - dow);
    const weekStart = getLastCompleteWeekStart(now);
    const weekEnd = weekEndOfLocal(weekStart);
    assert.ok(new Date(`${weekEnd}T23:59:59`) < now, `weekEnd(${weekEnd})はnow(${now.toDateString()})より前であるべき`);
    // 対象週は常に7日以上の幅を持つ「先週」であり、「今週」を指してはいけない
    const daysBeforeNow = Math.round((now - new Date(`${weekStart}T00:00:00`)) / (1000 * 60 * 60 * 24));
    assert.ok(daysBeforeNow >= 7, `weekStart(${weekStart})はnow(${now.toDateString()})の7日以上前であるべき(実際: ${daysBeforeNow}日前)`);
  }
});

test('getLastCompleteWeekStart: 日曜(週次バッチの実際の実行曜日)では、GSC反映遅延3日を安全に上回る', () => {
  // このプロジェクトの週次バッチは日曜01:00にのみ実行される(他の曜日には実行されない)ため、
  // GSC反映遅延に対する安全マージンは日曜起点でのみ保証されていればよい。
  const now = new Date(2026, 7, 2); // 日曜日
  const weekStart = getLastCompleteWeekStart(now);
  const weekEnd = weekEndOfLocal(weekStart);
  const daysSinceWeekEnd = Math.round((now - new Date(`${weekEnd}T00:00:00`)) / (1000 * 60 * 60 * 24));
  assert.ok(daysSinceWeekEnd >= 3, `日曜起点ではweekEnd(${weekEnd})がnowの3日以上前であるべき(実際: ${daysSinceWeekEnd}日前)`);
});
