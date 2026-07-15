'use strict';

// Sprint 3.9: weekly_task_curator.js(3段階フォールバックによるWeekly選定)の単体テスト。
// DB非依存、純粋関数のみを対象。LLM呼び出し・外部通信は一切発生しない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { curateWeeklyTasks } = require('../scripts/lib/seo/weekly_task_curator');

function task(overrides = {}) {
  return {
    id: 1,
    task_type: 'improve_school_page',
    roi_priority_score: 50,
    opportunity_score: 50,
    expected_impact_cv: 1.0,
    estimated_effort_minutes: 10,
    ...overrides,
  };
}

test('strict: roi_priority_score降順で、工数予算・同タイプ上限内に収まる上位を選ぶ', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: 90, task_type: 'improve_school_page', estimated_effort_minutes: 10 }),
    task({ id: 2, roi_priority_score: 80, task_type: 'create_article', estimated_effort_minutes: 10 }),
    task({ id: 3, roi_priority_score: 70, task_type: 'add_faq', estimated_effort_minutes: 10 }),
    task({ id: 4, roi_priority_score: 60, task_type: 'add_internal_links', estimated_effort_minutes: 10 }),
  ];
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.curationTier, 'strict');
  assert.deepEqual(result.selectedTasks.map((t) => t.id), [1, 2, 3, 4]);
  assert.equal(result.totalEffortMinutes, 40);
});

test('strict: 工数予算(60分)を超える候補はスキップし、収まる次点を採用する', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: 90, task_type: 'create_article', estimated_effort_minutes: 30 }),
    task({ id: 2, roi_priority_score: 85, task_type: 'improve_existing_article', estimated_effort_minutes: 30 }),
    task({ id: 3, roi_priority_score: 80, task_type: 'add_faq', estimated_effort_minutes: 30 }), // 累計90分になるためスキップ
    task({ id: 4, roi_priority_score: 70, task_type: 'add_internal_links', estimated_effort_minutes: 5 }), // 累計65分になるためスキップ
    task({ id: 5, roi_priority_score: 60, task_type: 'monitor', estimated_effort_minutes: 0 }), // 累計60分、収まる
  ];
  const result = curateWeeklyTasks(candidates);
  assert.deepEqual(result.selectedTasks.map((t) => t.id), [1, 2, 5]);
  assert.equal(result.totalEffortMinutes, 60);
});

test('strict: 同タイプは最大2件まで(3件目はスキップされる)', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: 90, task_type: 'create_article', estimated_effort_minutes: 10 }),
    task({ id: 2, roi_priority_score: 85, task_type: 'create_article', estimated_effort_minutes: 10 }),
    task({ id: 3, roi_priority_score: 80, task_type: 'create_article', estimated_effort_minutes: 10 }), // 同タイプ3件目、strictではスキップ
    task({ id: 4, roi_priority_score: 70, task_type: 'add_faq', estimated_effort_minutes: 10 }),
  ];
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.curationTier, 'strict');
  assert.deepEqual(result.selectedTasks.map((t) => t.id), [1, 2, 4]);
  assert.equal(result.taskTypeBreakdown.create_article, 2);
});

test('relaxed_diversity: strictで3件未満なら同タイプ上限を3件まで緩和する', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: 90, task_type: 'create_article', estimated_effort_minutes: 10 }),
    task({ id: 2, roi_priority_score: 85, task_type: 'create_article', estimated_effort_minutes: 10 }),
    task({ id: 3, roi_priority_score: 80, task_type: 'create_article', estimated_effort_minutes: 10 }),
  ];
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.curationTier, 'relaxed_diversity');
  assert.deepEqual(result.selectedTasks.map((t) => t.id), [1, 2, 3]);
  assert.equal(result.taskTypeBreakdown.create_article, 3);
});

test('fallback_pool_used: relaxed_diversityでも3件未満ならroi_priority_score無し候補(opportunity_score降順)で穴埋めする', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: 90, task_type: 'create_article', estimated_effort_minutes: 10 }),
    task({ id: 2, roi_priority_score: null, opportunity_score: 70, task_type: 'add_faq', estimated_effort_minutes: 5 }),
    task({ id: 3, roi_priority_score: null, opportunity_score: 60, task_type: 'add_internal_links', estimated_effort_minutes: 5 }),
  ];
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.curationTier, 'fallback_pool_used');
  assert.deepEqual(result.selectedTasks.map((t) => t.id), [1, 2, 3]);
});

test('fallback_pool_used: 予備候補内でもopportunity_score降順で並ぶ', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: 90, task_type: 'create_article', estimated_effort_minutes: 10 }),
    task({ id: 2, roi_priority_score: null, opportunity_score: 40, task_type: 'add_faq', estimated_effort_minutes: 5 }),
    task({ id: 3, roi_priority_score: null, opportunity_score: 80, task_type: 'add_internal_links', estimated_effort_minutes: 5 }),
  ];
  const result = curateWeeklyTasks(candidates);
  assert.deepEqual(result.selectedTasks.map((t) => t.id), [1, 3, 2]);
});

test('候補が1件も無い場合はエラーを投げず空の結果を返す', () => {
  const result = curateWeeklyTasks([]);
  assert.deepEqual(result.selectedTasks, []);
  assert.equal(result.totalExpectedCv, 0);
  assert.equal(result.totalEffortMinutes, 0);
  assert.equal(result.curationTier, 'fallback_pool_used'); // 3段階すべて試したが空のまま
});

test('候補が3件未満しか無い場合は無理に埋めず、ある分だけ返す', () => {
  const candidates = [task({ id: 1, roi_priority_score: 90, estimated_effort_minutes: 10 })];
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.selectedTasks.length, 1);
  assert.equal(result.curationTier, 'fallback_pool_used');
});

test('最大5件を超えては選定しない(高ROI候補が6件あっても5件まで)', () => {
  const candidates = Array.from({ length: 6 }, (_, i) =>
    task({ id: i + 1, roi_priority_score: 100 - i, task_type: `type_${i}`, estimated_effort_minutes: 1 })
  );
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.selectedTasks.length, 5);
});

test('totalExpectedCv/totalEffortMinutes/taskTypeBreakdownが選定結果と一致する', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: 90, task_type: 'improve_school_page', expected_impact_cv: 1.5, estimated_effort_minutes: 10 }),
    task({ id: 2, roi_priority_score: 80, task_type: 'create_article', expected_impact_cv: 0.5, estimated_effort_minutes: 30 }),
    task({ id: 3, roi_priority_score: 70, task_type: 'add_faq', expected_impact_cv: 0.2, estimated_effort_minutes: 5 }),
  ];
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.totalExpectedCv, 2.2);
  assert.equal(result.totalEffortMinutes, 45);
  assert.deepEqual(result.taskTypeBreakdown, { improve_school_page: 1, create_article: 1, add_faq: 1 });
});

test('expected_impact_cvがnullの候補はtotalExpectedCvの合計に0として扱われる', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: null, opportunity_score: 90, expected_impact_cv: null, estimated_effort_minutes: 10 }),
    task({ id: 2, roi_priority_score: null, opportunity_score: 80, expected_impact_cv: null, estimated_effort_minutes: 10 }),
    task({ id: 3, roi_priority_score: null, opportunity_score: 70, expected_impact_cv: null, estimated_effort_minutes: 10 }),
  ];
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.totalExpectedCv, 0);
});

test('estimated_effort_minutesがnullの候補は0分として扱われる', () => {
  const candidates = [task({ id: 1, roi_priority_score: 90, estimated_effort_minutes: null })];
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.totalEffortMinutes, 0);
});

test('effortBudgetMinutes/maxPerTaskType/targetCountはoptionsで上書きできる', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: 90, task_type: 'create_article', estimated_effort_minutes: 20 }),
    task({ id: 2, roi_priority_score: 80, task_type: 'create_article', estimated_effort_minutes: 20 }),
    task({ id: 3, roi_priority_score: 70, task_type: 'create_article', estimated_effort_minutes: 20 }),
  ];
  const result = curateWeeklyTasks(candidates, { effortBudgetMinutes: 120, maxPerTaskType: 5, targetCount: { min: 1, max: 3 } });
  assert.equal(result.curationTier, 'strict');
  assert.equal(result.selectedTasks.length, 3);
});

test('境界値: 工数がちょうど予算(60分)に収まる場合は選定される', () => {
  const candidates = [
    task({ id: 1, roi_priority_score: 90, task_type: 'create_article', estimated_effort_minutes: 30 }),
    task({ id: 2, roi_priority_score: 80, task_type: 'add_faq', estimated_effort_minutes: 30 }),
  ];
  const result = curateWeeklyTasks(candidates);
  assert.equal(result.totalEffortMinutes, 60);
  assert.equal(result.selectedTasks.length, 2);
});
