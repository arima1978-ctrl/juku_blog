'use strict';

// Sprint 3.6: Page Plan + Prompt + 検証済みLLM応答 + pageContextから、
// seo_page_draftsへ保存可能なプレーンオブジェクトを組み立てる決定的処理。
// DB書き込みは一切行わない(このモジュールはオブジェクトを組み立てるだけ)。

const ALLOWED_PAGE_DRAFT_STATUSES = new Set(['generated', 'reviewing', 'approved', 'rejected']);
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

// pagePlan: scripts/lib/seo_db.jsのgetSeoPagePlanById()相当(snake_case)。
// response: page_draft_response_validator.validatePageDraftResponse()でvalid=trueだったJSON。
// validationResult: 上記validate関数の戻り値そのもの({valid, errors, warnings})。
// pageContext: プロンプト生成時に実際に使用したpageContext(本文全文はここでは保持しない)。
function buildPageDraft({ pagePlan, prompt, promptVersion, response, validationResult, generator, model, pageContext, draftVersion }) {
  return {
    pagePlanId: pagePlan.id,
    draftVersion,
    draftType: 'page_improvement',

    summary: response.summary,
    suggestedLocation: response.suggested_location,
    generatedText: response.generated_text,
    changeReason: response.change_reason,
    searchIntentAlignment: response.search_intent_alignment,

    coveredTaskIds: response.covered_task_ids || [],
    coveredKeywords: response.covered_keywords || [],
    excludedTaskIds: response.excluded_task_ids || [],
    excludedIntents: response.excluded_intents || [],

    warnings: response.warnings || [],

    promptSnapshot: prompt,
    promptVersion,
    generator,
    model: model || null,

    sourceContentHash: pageContext && pageContext.status === 'fetched' ? pageContext.contentHash || null : null,
    pagePlanUpdatedAt: pagePlan.updated_at,

    validationResult,
    validationStatus: validationResult && validationResult.valid ? 'valid' : 'invalid',

    status: 'generated',
    editedText: null,
  };
}

// 保存時バリデーション(DB非依存の構造チェックのみ)。
// approved確認・stale確認(page_plan.updated_at/source_content_hash照合)はDB参照が要るため、
// 呼び出し側(scripts/lib/seo_db.jsのinsertSeoPageDraft)がこの関数の結果と合わせて確認すること。
function validatePageDraftShape(draft) {
  const errors = [];
  if (!draft || typeof draft !== 'object') {
    return { valid: false, errors: ['draftはオブジェクトである必要があります'] };
  }

  if (draft.pagePlanId == null) errors.push('pagePlanIdは必須です');
  if (!Number.isInteger(draft.draftVersion) || draft.draftVersion < 1) errors.push('draftVersionは1以上の整数である必要があります');
  if (!draft.summary) errors.push('summaryは必須です');
  if (!draft.suggestedLocation) errors.push('suggestedLocationは必須です');
  if (!draft.generatedText) errors.push('generatedTextは必須です');
  if (!draft.changeReason) errors.push('changeReasonは必須です');
  if (!draft.searchIntentAlignment) errors.push('searchIntentAlignmentは必須です');
  if (!Array.isArray(draft.coveredTaskIds)) errors.push('coveredTaskIdsは配列である必要があります');
  if (!Array.isArray(draft.coveredKeywords)) errors.push('coveredKeywordsは配列である必要があります');
  if (!Array.isArray(draft.excludedTaskIds)) errors.push('excludedTaskIdsは配列である必要があります');
  if (!Array.isArray(draft.excludedIntents)) errors.push('excludedIntentsは配列である必要があります');
  if (!Array.isArray(draft.warnings)) errors.push('warningsは配列である必要があります');
  if (!draft.promptSnapshot) errors.push('promptSnapshotは必須です');
  if (!draft.promptVersion) errors.push('promptVersionは必須です');
  if (!draft.generator) errors.push('generatorは必須です');
  if (!draft.validationResult) errors.push('validationResultは必須です');
  if (!draft.validationStatus) errors.push('validationStatusは必須です');
  if (!draft.pagePlanUpdatedAt) errors.push('pagePlanUpdatedAtは必須です');
  if (draft.status && !ALLOWED_PAGE_DRAFT_STATUSES.has(draft.status)) errors.push(`statusが不正です: ${draft.status}`);
  if (draft.sourceContentHash != null && !SHA256_HEX_PATTERN.test(draft.sourceContentHash)) {
    errors.push('sourceContentHashはnullまたはSHA-256形式(64桁16進数)である必要があります');
  }

  try {
    JSON.stringify(draft);
  } catch {
    errors.push('draftをJSON.stringifyできません');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { buildPageDraft, validatePageDraftShape, ALLOWED_PAGE_DRAFT_STATUSES };
