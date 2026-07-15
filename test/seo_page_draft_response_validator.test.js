'use strict';

// Sprint 3.6: page_draft_response_validator.jsの単体テスト(DB非依存、純粋関数のみを対象)。

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePageDraftResponse } = require('../scripts/lib/seo/page_draft_response_validator');

const BASE_OPTIONS = {
  primaryTaskId: 61,
  supportingTaskIds: [64],
  excludedTaskIds: [62, 63, 65, 66, 67, 68, 69],
  unverifiedSupportingTaskIds: [],
  excludedKeywords: ['小幡 塾', '瓢箪山 無料体験'],
};

function validResponse(overrides = {}) {
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

test('正常: 必須項目を満たすとvalid=true', () => {
  const result = validatePageDraftResponse(validResponse(), BASE_OPTIONS);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('必須項目欠落を検出する', () => {
  const response = validResponse();
  delete response.summary;
  const result = validatePageDraftResponse(response, BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('summary')));
});

test('can_generate!==trueは即invalid', () => {
  const result = validatePageDraftResponse({ can_generate: false }, BASE_OPTIONS);
  assert.equal(result.valid, false);
});

test('文字数: summaryが30字を超えると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ summary: 'あ'.repeat(31) }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('summary')));
});

test('文字数: suggested_locationが100字を超えると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ suggested_location: 'あ'.repeat(101) }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('suggested_location')));
});

test('文字数: generated_textが300字を超えると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ generated_text: 'あ'.repeat(301) }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('generated_text')));
});

test('文字数: change_reasonが300字を超えると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ change_reason: 'あ'.repeat(301) }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('change_reason')));
});

test('文字数: search_intent_alignmentが300字を超えると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ search_intent_alignment: 'あ'.repeat(301) }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('search_intent_alignment')));
});

test('配列型: covered_task_idsが配列でない場合は拒否', () => {
  const result = validatePageDraftResponse(validResponse({ covered_task_ids: 61 }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('covered_task_ids')));
});

test('Primary covered必須: covered_task_idsにPrimaryが無いと拒否', () => {
  const result = validatePageDraftResponse(validResponse({ covered_task_ids: [64] }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Primary Task ID')));
});

test('不正Task ID: Page Plan対象外のTask IDがcoveredに含まれると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ covered_task_ids: [61, 99999] }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('対象外のTask ID')));
});

test('covered/excluded重複: 同じTask IDが両方に含まれると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ covered_task_ids: [61, 64, 62], excluded_task_ids: [62] }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('covered_task_idsとexcluded_task_idsの両方')));
});

test('unverified covered拒否: unverifiedのSupporting Task IDがcoveredに含まれると拒否', () => {
  const options = { ...BASE_OPTIONS, unverifiedSupportingTaskIds: [64] };
  const result = validatePageDraftResponse(validResponse(), options);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('未検証(unverified)')));
});

test('duplicate covered拒否: Excluded(duplicate_intent含む)Task IDがcoveredに含まれると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ covered_task_ids: [61, 64, 68] }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Excluded Task ID')));
});

test('HTML禁止: generated_textにHTMLタグを含むと拒否', () => {
  const result = validatePageDraftResponse(validResponse({ generated_text: '<b>個別指導</b>を実施' }), BASE_OPTIONS);
  assert.equal(result.valid, false);
});

test('コードフェンス禁止: generated_textにMarkdownコードフェンスを含むと拒否', () => {
  const result = validatePageDraftResponse(validResponse({ generated_text: '```個別指導```' }), BASE_OPTIONS);
  assert.equal(result.valid, false);
});

test('Opportunity Score禁止: generated_textに含むと拒否', () => {
  const result = validatePageDraftResponse(validResponse({ generated_text: 'Opportunity Scoreが高いため個別指導を追加' }), BASE_OPTIONS);
  assert.equal(result.valid, false);
});

test('GSC内部指標禁止: generated_textに含むと拒否', () => {
  const result = validatePageDraftResponse(validResponse({ generated_text: '表示回数398回の個別指導コース' }), BASE_OPTIONS);
  assert.equal(result.valid, false);
});

test('Task ID本文露出禁止: generated_textに"Task ID"の記述があると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ generated_text: 'Task ID 61番の個別指導コース案内' }), BASE_OPTIONS);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Task ID')));
});

test('Page Plan ID本文露出禁止: summaryに"Page Plan ID"の記述があると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ summary: 'Page Plan ID=1の改善' }), BASE_OPTIONS);
  assert.equal(result.valid, false);
});

test('内部statusラベル露出禁止: generated_textに"duplicate_intent"等が含まれると拒否', () => {
  const result = validatePageDraftResponse(validResponse({ generated_text: 'duplicate_intentのため個別指導のみ案内' }), BASE_OPTIONS);
  assert.equal(result.valid, false);
});

test('Excluded keyword混入警告: generated_textに除外キーワードが含まれると警告する', () => {
  const result = validatePageDraftResponse(validResponse({ generated_text: '小幡 塾として個別指導を実施しています' }), BASE_OPTIONS);
  assert.equal(result.valid, true); // 警告扱いのためvalidのまま
  assert.ok(result.warnings.some((w) => w.includes('小幡 塾')));
});

test('不明なフィールドは警告のみでvalidを妨げない', () => {
  const result = validatePageDraftResponse(validResponse({ unexpected_field: 'x' }), BASE_OPTIONS);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes('unexpected_field')));
});

test('値を勝手に修正しない: normalizedResponseは入力と同一参照(valid時)', () => {
  const response = validResponse();
  const result = validatePageDraftResponse(response, BASE_OPTIONS);
  assert.equal(result.normalizedResponse, response);
});

test('invalid時はnormalizedResponseがnull', () => {
  const result = validatePageDraftResponse(validResponse({ summary: '' }), BASE_OPTIONS);
  assert.equal(result.normalizedResponse, null);
});

test('excluded_task_idsにPage PlanのExcluded一覧に無いIDが含まれると警告(エラーにはしない)', () => {
  const result = validatePageDraftResponse(validResponse({ excluded_task_ids: [999999] }), BASE_OPTIONS);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes('999999')));
});

test('応答がオブジェクトでない場合はinvalid', () => {
  const result = validatePageDraftResponse('not an object', BASE_OPTIONS);
  assert.equal(result.valid, false);
});
