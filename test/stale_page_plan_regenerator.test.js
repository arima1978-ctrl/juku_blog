'use strict';

// Sprint 3.7: stale_page_plan_regenerator.js(Page Plan再計算・変化比較)の単体テスト。
// DB非依存、純粋関数のみを対象(既存のpage_task_grouper.js/page_plan_builder.jsを
// 再利用しているだけで、新しい分類ロジックは追加していない)。LLM呼び出し・外部通信なし。

const test = require('node:test');
const assert = require('node:assert/strict');
const { regeneratePagePlanContent, comparePagePlanChanges } = require('../scripts/lib/seo/stale_page_plan_regenerator');

const HASH_NEW = 'c'.repeat(64);
const PAGE_TYPE = 'school_page';
const PAGE_ID = 'regen-fixture';
const TARGET_URL = 'https://an-english.com/school/regen-fixture/';

function baseTask(overrides = {}) {
  return {
    taskId: 1,
    status: 'proposed',
    taskType: 'improve_school_page',
    targetUrl: TARGET_URL,
    targetPageType: PAGE_TYPE,
    targetPageId: PAGE_ID,
    targetPageName: '再生成テスト教室',
    targetKeyword: 'テスト 塾',
    opportunityScore: 70,
    sourceCandidateId: null,
    gapType: 'weak',
    dataConfidence: 80,
    searchIntent: 'general_service',
    templateType: 'area_juku',
    keywordComponents: null,
    gscImpressions: 100,
    gscAvgPosition: 10,
    ...overrides,
  };
}

const fetchedPageContext = { status: 'fetched', contentHash: HASH_NEW, title: 'title', headings: [], bodyExcerpt: '' };

test('regeneratePagePlanContent: 対象ページのTaskのみを再計算する(他ページは無視)', () => {
  const enrichedTasks = [
    baseTask({ taskId: 1 }),
    baseTask({ taskId: 2, targetPageId: 'other-page', targetKeyword: '別ページ 塾' }),
  ];
  const plan = regeneratePagePlanContent({ enrichedTasks, targetPageType: PAGE_TYPE, targetPageId: PAGE_ID, pageContext: fetchedPageContext });
  assert.ok(plan);
  assert.equal(plan.primaryTaskId, 1);
  assert.equal(plan.targetPageId, PAGE_ID);
});

test('regeneratePagePlanContent: 対象ページにTaskが無ければnullを返す', () => {
  const enrichedTasks = [baseTask({ taskId: 1, targetPageId: 'unrelated-page' })];
  const plan = regeneratePagePlanContent({ enrichedTasks, targetPageType: PAGE_TYPE, targetPageId: PAGE_ID, pageContext: fetchedPageContext });
  assert.equal(plan, null);
});

test('regeneratePagePlanContent: source_content_hashは渡されたpageContext由来になる', () => {
  const enrichedTasks = [baseTask({ taskId: 1 })];
  const plan = regeneratePagePlanContent({ enrichedTasks, targetPageType: PAGE_TYPE, targetPageId: PAGE_ID, pageContext: fetchedPageContext });
  assert.equal(plan.sourceContentHash, HASH_NEW);
});

test('regeneratePagePlanContent: Supportingは同じintent family重複がExcludedへ回る(既存grouperの挙動をそのまま利用)', () => {
  const enrichedTasks = [
    baseTask({ taskId: 1, dataConfidence: 90 }),
    baseTask({ taskId: 2, targetKeyword: 'テスト 個別指導', searchIntent: 'general_service', templateType: 'area_teaching_style', keywordComponents: { teaching_style: '個別指導' }, dataConfidence: 60 }),
  ];
  const plan = regeneratePagePlanContent({ enrichedTasks, targetPageType: PAGE_TYPE, targetPageId: PAGE_ID, pageContext: fetchedPageContext });
  assert.equal(plan.primaryTaskId, 1);
  assert.ok(plan.supportingTaskIds.includes(2) || plan.excludedTasks.some((e) => e.taskId === 2));
});

test('comparePagePlanChanges: Primary/Supporting/Excludedがすべて同一なら変化なし', () => {
  const currentPlan = {
    primary_task_id: 1,
    supporting_task_ids: [2],
    excluded_tasks: [{ taskId: 3, reason: 'duplicate_intent' }],
  };
  const regeneratedPlan = {
    primaryTaskId: 1,
    supportingTaskIds: [2],
    excludedTasks: [{ taskId: 3, reason: 'duplicate_intent' }],
  };
  const changes = comparePagePlanChanges(currentPlan, regeneratedPlan);
  assert.deepEqual(changes, { primaryChanged: false, supportingChanged: false, excludedChanged: false });
});

test('comparePagePlanChanges: Primaryが変わった場合を検出する', () => {
  const currentPlan = { primary_task_id: 1, supporting_task_ids: [], excluded_tasks: [] };
  const regeneratedPlan = { primaryTaskId: 2, supportingTaskIds: [], excludedTasks: [] };
  const changes = comparePagePlanChanges(currentPlan, regeneratedPlan);
  assert.equal(changes.primaryChanged, true);
});

test('comparePagePlanChanges: Supportingの順序違いは変化なしとして扱う(ソートして比較)', () => {
  const currentPlan = { primary_task_id: 1, supporting_task_ids: [3, 2], excluded_tasks: [] };
  const regeneratedPlan = { primaryTaskId: 1, supportingTaskIds: [2, 3], excludedTasks: [] };
  const changes = comparePagePlanChanges(currentPlan, regeneratedPlan);
  assert.equal(changes.supportingChanged, false);
});

test('comparePagePlanChanges: Excludedの構成人数が変われば変化ありとして検出する', () => {
  const currentPlan = { primary_task_id: 1, supporting_task_ids: [], excluded_tasks: [{ taskId: 5 }] };
  const regeneratedPlan = { primaryTaskId: 1, supportingTaskIds: [], excludedTasks: [{ taskId: 5 }, { taskId: 6 }] };
  const changes = comparePagePlanChanges(currentPlan, regeneratedPlan);
  assert.equal(changes.excludedChanged, true);
});

test('comparePagePlanChanges: currentPlan/regeneratedPlanが無い場合はnullを返す(呼び出し側でエラー扱いにできるように)', () => {
  const changes = comparePagePlanChanges(null, { primaryTaskId: 1 });
  assert.deepEqual(changes, { primaryChanged: null, supportingChanged: null, excludedChanged: null });
});
