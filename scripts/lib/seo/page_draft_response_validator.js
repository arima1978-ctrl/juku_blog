'use strict';

// Sprint 3.6: 統合Draft(ページ単位、複数Taskを1つの文章へ統合したもの)の
// 決定的な検証。Claude Code subagent / 将来のAPI Provider / Fake Providerいずれの
// 呼び出し方式にも依存しない。不正な値を黙って書き換えず、errors/warningsへ残すだけ。
// 既存のTask単位Validator(draft_response_validator.js)とHTML/コードフェンス/
// Opportunity Score/GSC内部指標の検出ロジック(checkGeneratedTextSafety)を共有し、
// 重複実装を避ける。

const { checkGeneratedTextSafety } = require('./draft_response_validator');

const SUMMARY_MAX_LENGTH = 30;
const SUGGESTED_LOCATION_MAX_LENGTH = 100;
const GENERATED_TEXT_MAX_LENGTH = 300;
const CHANGE_REASON_MAX_LENGTH = 300;
const SEARCH_INTENT_ALIGNMENT_MAX_LENGTH = 300;

// 統合Draftはcan_generate=trueのみを想定する(Page Plan自体がPrimary Task確定済みのため、
// Task単位Draftのcontext_missing相当の「情報不足で生成できない」ケースは無い設計)。
const REQUIRED_FIELDS = [
  'summary', 'suggested_location', 'generated_text', 'change_reason', 'search_intent_alignment',
  'covered_task_ids', 'covered_keywords', 'excluded_task_ids', 'excluded_intents', 'warnings',
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResult(errors) {
  return { valid: false, errors, warnings: [], normalizedResponse: null };
}

// generated_textに限らず、公開文章系フィールド全てに適用する統合Draft特有のチェック。
// Task ID/Page Plan IDのラベル露出・内部status/分類ラベルの英語トークン露出を検出する。
// (数値そのもの(例: 住所の "10-8"）との衝突を避けるため、ラベル文言のみを対象にする)
function checkPageDraftInternalLeakage(text, fieldName, errors) {
  if (/task\s*id|タスクid|page\s*plan\s*id|ページプランid/i.test(text)) {
    errors.push(`${fieldName}にTask ID・Page Plan IDに関する記述が含まれています`);
  }
  if (/\b(unverified|conflicting|duplicate_intent|separate_section_intent|supporting_fact_unverified)\b/i.test(text)) {
    errors.push(`${fieldName}に内部分類ラベル(fact check status等)が含まれています`);
  }
}

// excludedKeywords: Page PlanのExcluded Taskのキーワード文字列一覧(options経由、任意)。
// generated_text/summary内に、除外されたはずのキーワードがそのまま出現していないか警告する
// (誤検知の可能性があるため、今回はerrorではなくwarningとする)。
function checkExcludedKeywordLeakage(response, excludedKeywords, warnings) {
  if (!Array.isArray(excludedKeywords) || excludedKeywords.length === 0) return;
  const haystack = `${response.summary || ''} ${response.generated_text || ''}`;
  excludedKeywords.forEach((keyword) => {
    if (keyword && haystack.includes(keyword)) {
      warnings.push(`除外されたキーワード「${keyword}」がsummary/generated_textに含まれている可能性があります`);
    }
  });
}

// response: JSON.parse済みのLLM応答オブジェクト。
// options:
//   primaryTaskId            Page PlanのPrimary Task ID(covered_task_idsに必須)
//   supportingTaskIds        Page PlanのSupporting Task ID一覧(covered候補として許可)
//   excludedTaskIds          Page PlanのExcluded Task ID一覧(coveredに混入してはならない)
//   unverifiedSupportingTaskIds  factStatus!=='verified'のSupporting Task ID一覧
//                            (Excludedへ既に回っている前提だが、二重チェックとして保持)
//   excludedKeywords         Excluded Taskのキーワード文字列一覧(警告用、任意)
// 戻り値: { valid, errors, warnings, normalizedResponse }
function validatePageDraftResponse(response, options = {}) {
  const {
    primaryTaskId,
    supportingTaskIds = [],
    excludedTaskIds = [],
    unverifiedSupportingTaskIds = [],
    excludedKeywords = [],
  } = options;

  if (!isPlainObject(response)) {
    return invalidResult(['応答がJSONオブジェクトではありません']);
  }
  if (response.can_generate !== true) {
    return invalidResult(['can_generateはtrueである必要があります(統合Draftはcan_generate=trueのみ想定)']);
  }

  const errors = [];
  const warnings = [];
  const knownFields = new Set(['can_generate', ...REQUIRED_FIELDS]);

  Object.keys(response).forEach((key) => {
    if (!knownFields.has(key)) warnings.push(`不明なフィールドです(無視します): ${key}`);
  });

  REQUIRED_FIELDS.forEach((field) => {
    if (!(field in response)) errors.push(`必須フィールドが欠落しています: ${field}`);
  });

  ['summary', 'suggested_location', 'generated_text', 'change_reason', 'search_intent_alignment'].forEach((field) => {
    if (field in response && typeof response[field] !== 'string') errors.push(`${field}が文字列ではありません`);
  });
  ['covered_task_ids', 'covered_keywords', 'excluded_task_ids', 'excluded_intents', 'warnings'].forEach((field) => {
    if (field in response && !Array.isArray(response[field])) errors.push(`${field}が配列ではありません`);
  });

  const summary = typeof response.summary === 'string' ? response.summary : null;
  if (summary != null) {
    if (summary.trim() === '') errors.push('summaryが空です');
    else if (summary.length > SUMMARY_MAX_LENGTH) errors.push(`summaryが${SUMMARY_MAX_LENGTH}文字を超えています(実際: ${summary.length}文字)`);
    checkPageDraftInternalLeakage(summary, 'summary', errors);
  }

  const suggestedLocation = typeof response.suggested_location === 'string' ? response.suggested_location : null;
  if (suggestedLocation != null) {
    if (suggestedLocation.trim() === '') errors.push('suggested_locationが空です');
    else if (suggestedLocation.length > SUGGESTED_LOCATION_MAX_LENGTH) {
      errors.push(`suggested_locationが${SUGGESTED_LOCATION_MAX_LENGTH}文字を超えています(実際: ${suggestedLocation.length}文字)`);
    }
  }

  const generatedText = typeof response.generated_text === 'string' ? response.generated_text : null;
  if (generatedText != null) {
    if (generatedText.trim() === '') {
      errors.push('generated_textが空です');
    } else {
      if (generatedText.length > GENERATED_TEXT_MAX_LENGTH) {
        errors.push(`generated_textが${GENERATED_TEXT_MAX_LENGTH}文字を超えています(実際: ${generatedText.length}文字)`);
      }
      checkGeneratedTextSafety(generatedText, errors);
      checkPageDraftInternalLeakage(generatedText, 'generated_text', errors);
    }
  }

  const changeReason = typeof response.change_reason === 'string' ? response.change_reason : null;
  if (changeReason != null && changeReason.length > CHANGE_REASON_MAX_LENGTH) {
    errors.push(`change_reasonが${CHANGE_REASON_MAX_LENGTH}文字を超えています(実際: ${changeReason.length}文字)`);
  }

  const searchIntentAlignment = typeof response.search_intent_alignment === 'string' ? response.search_intent_alignment : null;
  if (searchIntentAlignment != null && searchIntentAlignment.length > SEARCH_INTENT_ALIGNMENT_MAX_LENGTH) {
    errors.push(`search_intent_alignmentが${SEARCH_INTENT_ALIGNMENT_MAX_LENGTH}文字を超えています(実際: ${searchIntentAlignment.length}文字)`);
  }

  if (Array.isArray(response.covered_task_ids)) {
    const covered = response.covered_task_ids;
    if (primaryTaskId != null && !covered.includes(primaryTaskId)) {
      errors.push('covered_task_idsにPrimary Task IDが含まれていません');
    }

    const allowedTaskIds = new Set([primaryTaskId, ...supportingTaskIds].filter((id) => id != null));
    const excludedSet = new Set(excludedTaskIds);
    const unverifiedSet = new Set(unverifiedSupportingTaskIds);

    covered.forEach((id) => {
      if (!allowedTaskIds.has(id)) errors.push(`covered_task_idsにPage Plan対象外のTask ID(${id})が含まれています`);
      if (excludedSet.has(id)) errors.push(`covered_task_idsにExcluded Task ID(${id})が含まれています`);
      if (unverifiedSet.has(id)) errors.push(`covered_task_idsに未検証(unverified)のSupporting Task ID(${id})が含まれています`);
    });
  }

  if (Array.isArray(response.excluded_task_ids)) {
    if (Array.isArray(response.covered_task_ids)) {
      const coveredSet = new Set(response.covered_task_ids);
      response.excluded_task_ids.forEach((id) => {
        if (coveredSet.has(id)) errors.push(`Task ID(${id})がcovered_task_idsとexcluded_task_idsの両方に含まれています`);
      });
    }
    const allowedExcludedIds = new Set(excludedTaskIds);
    response.excluded_task_ids.forEach((id) => {
      if (!allowedExcludedIds.has(id)) warnings.push(`excluded_task_idsにPage PlanのExcluded一覧に無いTask ID(${id})が含まれています`);
    });
  }

  if (errors.length === 0) {
    checkExcludedKeywordLeakage(response, excludedKeywords, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedResponse: errors.length === 0 ? response : null,
  };
}

module.exports = {
  validatePageDraftResponse,
  SUMMARY_MAX_LENGTH,
  SUGGESTED_LOCATION_MAX_LENGTH,
  GENERATED_TEXT_MAX_LENGTH,
  CHANGE_REASON_MAX_LENGTH,
  SEARCH_INTENT_ALIGNMENT_MAX_LENGTH,
};
