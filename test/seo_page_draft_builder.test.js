'use strict';

// Sprint 3.6: page_draft_builder.jsの単体テスト(DB非依存、純粋関数のみを対象)。

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPageDraft, validatePageDraftShape } = require('../scripts/lib/seo/page_draft_builder');

function fakePagePlan(overrides = {}) {
  return { id: 1, updated_at: '2026-07-14T09:05:28.593Z', ...overrides };
}

function fakeResponse(overrides = {}) {
  return {
    can_generate: true,
    summary: '守山区向け導入文',
    suggested_location: '見出し直後',
    generated_text: '小幡教室は守山区にあり、個別指導のコースを開講しています。',
    change_reason: '導入部が無いため追加する',
    search_intent_alignment: '守山区・個別指導の検索意図に合致する',
    covered_task_ids: [61, 64],
    covered_keywords: ['守山区 塾', '守山区 個別指導'],
    excluded_task_ids: [62],
    excluded_intents: ['duplicate_intent'],
    warnings: [],
    ...overrides,
  };
}

function fakeValidationResult(overrides = {}) {
  return { valid: true, errors: [], warnings: [], normalizedResponse: fakeResponse(), ...overrides };
}

test('buildPageDraft: Draft objectを生成する', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(),
    prompt: 'テストPrompt全文',
    promptVersion: 'page-draft-v1',
    response: fakeResponse(),
    validationResult: fakeValidationResult(),
    generator: 'claude-code-subagent',
    model: 'sonnet',
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) },
    draftVersion: 1,
  });
  assert.equal(draft.pagePlanId, 1);
  assert.equal(draft.draftVersion, 1);
  assert.equal(draft.draftType, 'page_improvement');
  assert.equal(draft.summary, '守山区向け導入文');
  assert.equal(draft.status, 'generated');
  assert.equal(draft.editedText, null);
});

test('buildPageDraft: prompt snapshotを保存する', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'テストPrompt全文', promptVersion: 'page-draft-v1',
    response: fakeResponse(), validationResult: fakeValidationResult(), generator: 'claude-code-subagent',
    model: 'sonnet', pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 1,
  });
  assert.equal(draft.promptSnapshot, 'テストPrompt全文');
  assert.equal(draft.promptVersion, 'page-draft-v1');
});

test('buildPageDraft: versionを保持する', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 3,
  });
  assert.equal(draft.draftVersion, 3);
});

test('buildPageDraft: sourceContentHashをpageContext.contentHashから保存する', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'b'.repeat(64) }, draftVersion: 1,
  });
  assert.equal(draft.sourceContentHash, 'b'.repeat(64));
});

test('buildPageDraft: pageContext未取得時はsourceContentHash=null', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'not_fetched' }, draftVersion: 1,
  });
  assert.equal(draft.sourceContentHash, null);
});

test('buildPageDraft: Page Plan updated_atを保存する', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan({ updated_at: '2026-07-14T10:00:00.000Z' }), prompt: 'x', promptVersion: 'page-draft-v1',
    response: fakeResponse(), validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 1,
  });
  assert.equal(draft.pagePlanUpdatedAt, '2026-07-14T10:00:00.000Z');
});

test('buildPageDraft: validation結果を保存する', () => {
  const validationResult = fakeValidationResult({ warnings: ['注意事項1'] });
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult, generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 1,
  });
  assert.deepEqual(draft.validationResult, validationResult);
  assert.equal(draft.validationStatus, 'valid');
});

test('buildPageDraft: validation invalidの場合はvalidationStatus=invalid', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult({ valid: false, errors: ['test error'] }), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 1,
  });
  assert.equal(draft.validationStatus, 'invalid');
});

test('buildPageDraft: editedTextは常にnull', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 1,
  });
  assert.equal(draft.editedText, null);
});

test('buildPageDraft: covered/excluded task idsを保存する', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 1,
  });
  assert.deepEqual(draft.coveredTaskIds, [61, 64]);
  assert.deepEqual(draft.excludedTaskIds, [62]);
});

// --- validatePageDraftShape ---

test('validatePageDraftShape: 正常なdraftはvalid=true', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 1,
  });
  const result = validatePageDraftShape(draft);
  assert.equal(result.valid, true);
});

test('validatePageDraftShape: 必須項目欠落を検出する', () => {
  const result = validatePageDraftShape({ draftVersion: 1 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('pagePlanId')));
  assert.ok(result.errors.some((e) => e.includes('summary')));
});

test('validatePageDraftShape: draftVersionが1未満は拒否', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 0,
  });
  const result = validatePageDraftShape(draft);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('draftVersion')));
});

test('validatePageDraftShape: 不正statusを検出する', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'a'.repeat(64) }, draftVersion: 1,
  });
  const result = validatePageDraftShape({ ...draft, status: 'in_progress' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('status')));
});

test('validatePageDraftShape: 不正なsourceContentHashを検出する', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'fetched', contentHash: 'not-a-valid-hash' }, draftVersion: 1,
  });
  const result = validatePageDraftShape(draft);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('sourceContentHash')));
});

test('validatePageDraftShape: sourceContentHash=nullは許可する', () => {
  const draft = buildPageDraft({
    pagePlan: fakePagePlan(), prompt: 'x', promptVersion: 'page-draft-v1', response: fakeResponse(),
    validationResult: fakeValidationResult(), generator: 'test', model: null,
    pageContext: { status: 'not_fetched' }, draftVersion: 1,
  });
  const result = validatePageDraftShape(draft);
  assert.equal(result.valid, true);
});
