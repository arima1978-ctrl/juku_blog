'use strict';

// draft_response_validator.jsのユニットテスト。LLMの呼び出し方法(Claude Code subagent /
// 将来のAPI Provider / Fake Provider)には一切依存しない、決定的な検証のみを対象にする。

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDraftResponse, SUMMARY_MAX_LENGTH, GENERATED_TEXT_MAX_LENGTH } = require('../scripts/lib/seo/draft_response_validator');

function validTrueResponse(overrides = {}) {
  return {
    can_generate: true,
    summary: '短い要約',
    suggested_location: 'アクセス情報の下',
    generated_text: '本文改善案のテキストです。',
    change_reason: '検索意図に合わせるため',
    search_intent_alignment: '一致している',
    warnings: [],
    ...overrides,
  };
}

function validFalseResponse(overrides = {}) {
  return {
    can_generate: false,
    missing_context: ['本文が未取得'],
    required_checks: ['取得後に再確認'],
    warnings: [],
    ...overrides,
  };
}

test('正常なcan_generate=trueはvalid', () => {
  const result = validateDraftResponse(validTrueResponse());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.normalizedResponse, validTrueResponse());
});

test('正常なcan_generate=falseはvalid', () => {
  const result = validateDraftResponse(validFalseResponse());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('JSONオブジェクトでない場合はinvalid', () => {
  assert.equal(validateDraftResponse('文字列です').valid, false);
  assert.equal(validateDraftResponse([1, 2, 3]).valid, false);
  assert.equal(validateDraftResponse(null).valid, false);
});

test('can_generateが欠落・型不正はinvalid', () => {
  assert.equal(validateDraftResponse({}).valid, false);
  assert.equal(validateDraftResponse({ can_generate: 'true' }).valid, false); // 文字列は不可
  assert.equal(validateDraftResponse({ can_generate: null }).valid, false);
});

test('can_generate=trueで必須フィールド欠落はinvalid', () => {
  const response = validTrueResponse();
  delete response.generated_text;
  const result = validateDraftResponse(response);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('generated_text')));
});

test('summaryが30文字超過はinvalid', () => {
  const result = validateDraftResponse(validTrueResponse({ summary: 'あ'.repeat(SUMMARY_MAX_LENGTH + 1) }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('summary')));
});

test('summaryがちょうど30文字はvalid', () => {
  const result = validateDraftResponse(validTrueResponse({ summary: 'あ'.repeat(SUMMARY_MAX_LENGTH) }));
  assert.equal(result.valid, true);
});

test('generated_textが300文字超過はinvalid', () => {
  const result = validateDraftResponse(validTrueResponse({ generated_text: 'あ'.repeat(GENERATED_TEXT_MAX_LENGTH + 1) }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('generated_text') && e.includes('300')));
});

test('generated_textが空はinvalid', () => {
  const result = validateDraftResponse(validTrueResponse({ generated_text: '' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('空')));
});

test('can_generate=falseなのにgenerated_textありはinvalid', () => {
  const response = validFalseResponse({ generated_text: '勝手に生成された本文' });
  const result = validateDraftResponse(response);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('generated_text')));
});

test('generated_textにHTMLタグを含む場合はinvalid', () => {
  const result = validateDraftResponse(validTrueResponse({ generated_text: '<b>強調</b>されたテキストです。' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('HTMLタグ')));
});

test('generated_textにMarkdownコードフェンスを含む場合はinvalid', () => {
  const result = validateDraftResponse(validTrueResponse({ generated_text: '```改善案```です。' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('コードフェンス')));
});

test('generated_textに"Opportunity Score"という語を含む場合はinvalid', () => {
  const result = validateDraftResponse(validTrueResponse({ generated_text: '当校はOpportunity Scoreが高いです。' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Opportunity Score')));
});

test('generated_textにGSC内部指標(検索順位・表示回数等)を含む場合はinvalid', () => {
  const r1 = validateDraftResponse(validTrueResponse({ generated_text: '当校は検索順位3位です。' }));
  assert.equal(r1.valid, false);
  const r2 = validateDraftResponse(validTrueResponse({ generated_text: '表示回数398回を記録しました。' }));
  assert.equal(r2.valid, false);
});

test('不明なフィールドはerrorsではなくwarningsへ計上される(validのまま)', () => {
  const result = validateDraftResponse(validTrueResponse({ extra_unknown_field: '想定外の値' }));
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes('extra_unknown_field')));
});

test('warningsが配列でない場合はinvalid', () => {
  const result = validateDraftResponse(validTrueResponse({ warnings: '配列ではない文字列' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('warnings')));
});

test('missing_context/required_checksが配列でない場合はinvalid', () => {
  const result = validateDraftResponse(validFalseResponse({ missing_context: '配列ではない' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('missing_context')));
});

test('無効な場合はnormalizedResponseがnullになる(値を書き換えて返さない)', () => {
  const result = validateDraftResponse(validTrueResponse({ generated_text: '' }));
  assert.equal(result.normalizedResponse, null);
});
