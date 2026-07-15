'use strict';

// LLM応答(Claude Code subagent / 将来のAnthropic・OpenAI・Gemini API Provider /
// Fake Provider、いずれの呼び出し方式にも依存しない)の決定的な検証。
// 不正な値を黙って書き換えず、errors/warningsへ残すだけにする。

const SUMMARY_MAX_LENGTH = 30;
const GENERATED_TEXT_MAX_LENGTH = 300;

const TRUE_REQUIRED_FIELDS = ['summary', 'suggested_location', 'generated_text', 'change_reason', 'search_intent_alignment', 'warnings'];
const FALSE_REQUIRED_FIELDS = ['missing_context', 'required_checks', 'warnings'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResult(errors) {
  return { valid: false, errors, warnings: [], normalizedResponse: null };
}

// 機械的に判定可能な項目のみを対象にする(自然言語としての妥当性判断は行わない)。
function checkGeneratedTextSafety(generatedText, errors) {
  if (/<[a-z][\s\S]*>/i.test(generatedText)) {
    errors.push('generated_textにHTMLタグが含まれています');
  }
  if (/```/.test(generatedText)) {
    errors.push('generated_textにMarkdownコードフェンスが含まれています');
  }
  if (/opportunity score/i.test(generatedText)) {
    errors.push('generated_textに"Opportunity Score"という語が含まれています');
  }
  if (/検索順位\s*\d+\s*位|表示回数\s*\d+\s*回|クリック数\s*\d+\s*回|平均順位\s*\d+/.test(generatedText)) {
    errors.push('generated_textに検索順位・表示回数・クリック数等の内部指標らしき記述が含まれています');
  }
}

function validateTrueCase(response, errors, warnings) {
  TRUE_REQUIRED_FIELDS.forEach((field) => {
    if (!(field in response)) errors.push(`必須フィールドが欠落しています: ${field}`);
  });

  ['missing_context', 'required_checks'].forEach((field) => {
    if (field in response) warnings.push(`can_generate=trueに${field}が含まれています(無視します)`);
  });

  ['summary', 'suggested_location', 'generated_text', 'change_reason', 'search_intent_alignment'].forEach((field) => {
    if (field in response && typeof response[field] !== 'string') {
      errors.push(`${field}が文字列ではありません`);
    }
  });

  if ('warnings' in response && !Array.isArray(response.warnings)) {
    errors.push('warningsが配列ではありません');
  }

  const summary = typeof response.summary === 'string' ? response.summary : null;
  if (summary != null && summary.length > SUMMARY_MAX_LENGTH) {
    errors.push(`summaryが${SUMMARY_MAX_LENGTH}文字を超えています(実際: ${summary.length}文字)`);
  }

  const generatedText = typeof response.generated_text === 'string' ? response.generated_text : null;
  if (generatedText == null) {
    // 型不正は上のtypeofチェックで既にerrors計上済みのためここでは追加しない
  } else if (generatedText.trim() === '') {
    errors.push('generated_textが空です');
  } else {
    if (generatedText.length > GENERATED_TEXT_MAX_LENGTH) {
      errors.push(`generated_textが${GENERATED_TEXT_MAX_LENGTH}文字を超えています(実際: ${generatedText.length}文字)`);
    }
    checkGeneratedTextSafety(generatedText, errors);
  }
}

function validateFalseCase(response, errors, warnings) {
  FALSE_REQUIRED_FIELDS.forEach((field) => {
    if (!(field in response)) errors.push(`必須フィールドが欠落しています: ${field}`);
  });

  if ('generated_text' in response) {
    errors.push('can_generate=falseなのにgenerated_textが含まれています');
  }
  ['summary', 'suggested_location', 'change_reason', 'search_intent_alignment'].forEach((field) => {
    if (field in response) warnings.push(`can_generate=falseに${field}が含まれています(無視します)`);
  });

  ['missing_context', 'required_checks', 'warnings'].forEach((field) => {
    if (field in response && !Array.isArray(response[field])) {
      errors.push(`${field}が配列ではありません`);
    }
  });
}

// response: JSON.parse済みのLLM応答オブジェクト。options: 現状未使用(将来の拡張用)。
// 戻り値: { valid, errors, warnings, normalizedResponse }
// normalizedResponseはvalid=trueの場合のみ元のresponseをそのまま返す(値の書き換えはしない)。
// eslint-disable-next-line no-unused-vars
function validateDraftResponse(response, options = {}) {
  if (!isPlainObject(response)) {
    return invalidResult(['応答がJSONオブジェクトではありません']);
  }

  if (typeof response.can_generate !== 'boolean') {
    return invalidResult(['can_generateがboolean型ではありません(欠落または型不正)']);
  }

  const errors = [];
  const warnings = [];
  const requiredFields = response.can_generate ? TRUE_REQUIRED_FIELDS : FALSE_REQUIRED_FIELDS;
  const knownFields = new Set(['can_generate', ...requiredFields]);

  Object.keys(response).forEach((key) => {
    if (!knownFields.has(key)) {
      warnings.push(`不明なフィールドです(無視します): ${key}`);
    }
  });

  if (response.can_generate) {
    validateTrueCase(response, errors, warnings);
  } else {
    validateFalseCase(response, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedResponse: errors.length === 0 ? response : null,
  };
}

module.exports = {
  validateDraftResponse,
  SUMMARY_MAX_LENGTH,
  GENERATED_TEXT_MAX_LENGTH,
  // Sprint 3.6: page_draft_response_validator.jsが同じ機械的安全チェック
  // (HTML/コードフェンス/Opportunity Score/GSC内部指標の検出)を再利用するために公開する。
  checkGeneratedTextSafety,
};
