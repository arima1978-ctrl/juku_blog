'use strict';

// Sprint 3.4: page_plan_builder.jsの単体テスト(DB非依存、純粋関数のみを対象)。

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPagePlan, buildSelectionBreakdown, buildFactCheckSummary, validatePagePlanShape } = require('../scripts/lib/seo/page_plan_builder');

function fakeGroup(overrides = {}) {
  return {
    groupKey: 'school_page:obata',
    targetPageType: 'school_page',
    targetPageId: 'obata',
    targetPageName: '小幡教室',
    targetUrl: 'https://an-english.com/school/obata/',
    tasks: [],
    primaryTask: {
      taskId: 61, targetKeyword: '守山区 塾', searchIntent: 'general_service',
      gapType: 'weak', opportunityScore: 74, dataConfidence: 75, gscImpressions: 398,
    },
    supportingTasks: [
      {
        taskId: 64, targetKeyword: '守山区 個別指導', searchIntent: 'general_service',
        factStatus: 'verified', factEvidence: { serviceTerm: '個別指導', matchedTerms: ['個別指導'], evidenceSources: ['title'] },
      },
    ],
    excludedTasks: [
      { taskId: 62, targetKeyword: '小幡 塾', reason: 'duplicate_intent', duplicateOf: 61, intentFamily: 'area_juku' },
      {
        taskId: 69, targetKeyword: '守山区 集団指導', reason: 'supporting_fact_unverified',
        factStatus: 'unverified', factEvidence: { serviceTerm: '集団指導', matchedTerms: [], evidenceSources: [] },
        factReason: 'no_matching_term_in_page_content',
      },
    ],
    warnings: [{ type: 'supporting_fact_unverified', taskId: 69 }],
    ...overrides,
  };
}

// --- buildPagePlan ---

test('buildPagePlan: groupからPage Planを生成できる', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.equal(plan.groupKey, 'school_page:obata');
  assert.equal(plan.targetPageType, 'school_page');
  assert.equal(plan.targetPageId, 'obata');
  assert.equal(plan.status, 'proposed');
});

test('buildPagePlan: Primaryを保存する(primaryTaskId/primaryKeyword)', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.equal(plan.primaryTaskId, 61);
  assert.equal(plan.primaryKeyword, '守山区 塾');
});

test('buildPagePlan: Supportingを保存する(supportingTaskIds/supportingKeywords)', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.deepEqual(plan.supportingTaskIds, [64]);
  assert.deepEqual(plan.supportingKeywords, ['守山区 個別指導']);
});

test('buildPagePlan: Excludedの理由を保存する(reason/duplicateOf/factStatus等)', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  const e62 = plan.excludedTasks.find((e) => e.taskId === 62);
  const e69 = plan.excludedTasks.find((e) => e.taskId === 69);
  assert.equal(e62.reason, 'duplicate_intent');
  assert.equal(e62.duplicateOf, 61);
  assert.equal(e69.reason, 'supporting_fact_unverified');
  assert.equal(e69.factStatus, 'unverified');
});

test('buildPagePlan: factCheckSummaryを保存する', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.equal(plan.factCheckSummary.verified.length, 1);
  assert.equal(plan.factCheckSummary.verified[0].taskId, 64);
  assert.equal(plan.factCheckSummary.unverified.length, 1);
  assert.equal(plan.factCheckSummary.unverified[0].taskId, 69);
  assert.equal(plan.factCheckSummary.unverified[0].reason, 'no_matching_term_in_page_content');
  assert.equal(plan.factCheckSummary.conflicting.length, 0);
});

test('buildPagePlan: selectionBreakdownを保存する(確定順序の各値を含む)', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.deepEqual(plan.selectionBreakdown, {
    searchIntentPriority: 0,
    dataConfidence: 75,
    gscImpressions: 398,
    gapTypePriority: 0, // weak
    opportunityScore: 74,
    taskId: 61,
  });
});

test('buildPagePlan: selectionBreakdownにaverage_position相当の値を含まない', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.equal('avgPosition' in plan.selectionBreakdown, false);
  assert.equal('gscAvgPosition' in plan.selectionBreakdown, false);
});

test('buildPagePlan: sourceContentHashを保存する(pageContext.contentHashをそのまま)', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.equal(plan.sourceContentHash, 'abc123');
});

test('buildPagePlan: pageContext未取得時はsourceContentHash=null', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'not_fetched' });
  assert.equal(plan.sourceContentHash, null);
});

test('buildPagePlan: pageContext自体がnullでも安全にsourceContentHash=null', () => {
  const plan = buildPagePlan(fakeGroup(), null);
  assert.equal(plan.sourceContentHash, null);
});

test('buildPagePlan: warningsを保存する', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.equal(plan.warnings.length, 1);
  assert.equal(plan.warnings[0].type, 'supporting_fact_unverified');
});

test('buildPagePlan: Primaryが無い場合はnullを返す', () => {
  const plan = buildPagePlan(fakeGroup({ primaryTask: null }), { status: 'fetched', contentHash: 'abc123' });
  assert.equal(plan, null);
});

test('buildPagePlan: 同一TaskがPrimaryとSupportingに重複しない(生成時点で重複が無いことを確認)', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.ok(!plan.supportingTaskIds.includes(plan.primaryTaskId));
});

test('buildPagePlan: combinedSearchIntentsはPrimary+Supportingのsearch_intentを重複無く含む', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  assert.deepEqual(plan.combinedSearchIntents, ['general_service']);
});

// --- validatePagePlanShape ---

test('validatePagePlanShape: 正常なPlanはvalid=true', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'a'.repeat(64) });
  const result = validatePagePlanShape(plan);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validatePagePlanShape: 必須項目欠落を検出する', () => {
  const result = validatePagePlanShape({ supportingTaskIds: [], excludedTasks: [], warnings: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('groupKey')));
  assert.ok(result.errors.some((e) => e.includes('primaryTaskId')));
});

test('validatePagePlanShape: 不正statusを検出する', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  const result = validatePagePlanShape({ ...plan, status: 'in_progress' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('status')));
});

test('validatePagePlanShape: primaryとsupportingの重複を検出する', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  const result = validatePagePlanShape({ ...plan, supportingTaskIds: [61, 64] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('重複')));
});

test('validatePagePlanShape: supportingとexcludedの重複を検出する', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  const result = validatePagePlanShape({ ...plan, supportingTaskIds: [64, 69] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('重複')));
});

test('validatePagePlanShape: 不正なsourceContentHashを検出する', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'not-a-sha256' });
  const result = validatePagePlanShape(plan);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('sourceContentHash')));
});

test('validatePagePlanShape: sourceContentHash=nullは許可する', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'not_fetched' });
  const result = validatePagePlanShape(plan);
  assert.equal(result.valid, true);
});

test('validatePagePlanShape: 正しいSHA-256形式のsourceContentHashは許可する', () => {
  const validHash = 'a'.repeat(64);
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: validHash });
  const result = validatePagePlanShape(plan);
  assert.equal(result.valid, true);
});

test('validatePagePlanShape: duplicateOfが不正(Primary/Supportingに存在しない)場合を検出する', () => {
  const plan = buildPagePlan(fakeGroup(), { status: 'fetched', contentHash: 'abc123' });
  const tampered = {
    ...plan,
    excludedTasks: plan.excludedTasks.map((e) => (e.taskId === 62 ? { ...e, duplicateOf: 99999 } : e)),
  };
  const result = validatePagePlanShape(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('duplicateOf')));
});
