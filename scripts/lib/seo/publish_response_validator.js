'use strict';

// Sprint 4.1: LLM応答(Claude Code subagent等が出力したJSONファイル)のうち、
// create_article Taskの「WordPress新規投稿として公開可能な完成原稿」を検証する。
// 既存のdraft_response_validator.js(can_generate=true時にgenerated_text<=300文字の
// 「既存ページへの追記案」を検証するもの)とはスキーマが異なる別物(全文記事なので
// HTMLタグは許容し、代わりにタイトル・本文の必須項目と内部指標の非露出を確認する)。
// 決定的な検証のみを行い、DB・WordPress・LLM・外部サイトへは一切接続しない。

const { checkGeneratedTextSafety } = require('./draft_response_validator');

const TITLE_MAX_LENGTH = 60;
const TRUE_REQUIRED_FIELDS = ['title', 'body_html', 'meta_description', 'warnings'];
const FALSE_REQUIRED_FIELDS = ['missing_context', 'required_checks', 'warnings'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResult(errors) {
  return { valid: false, errors, warnings: [], normalizedResponse: null };
}

// body_htmlは実際にWordPressへ投稿するHTMLのため、draft_response_validatorの
// 「HTMLタグ禁止」チェックはそのまま適用できない。内部指標の露出・キーワード
// スタッフィング的な語のみ、generated_text向けのロジックをテキスト部分に流用する。
function checkArticleBodySafety(bodyHtml, errors) {
  const textOnly = bodyHtml.replace(/<[^>]*>/g, ' ');
  checkGeneratedTextSafetyIgnoringHtml(textOnly, errors);
}

// checkGeneratedTextSafety はHTMLタグ検出も行うため、タグを除去したテキストに対して
// 内部指標・Markdownコードフェンスの検出のみを流用する(HTMLタグ自体は許容するため)。
function checkGeneratedTextSafetyIgnoringHtml(text, errors) {
  const dummyErrors = [];
  checkGeneratedTextSafety(text, dummyErrors);
  dummyErrors
    .filter((e) => !e.includes('HTMLタグ'))
    .forEach((e) => errors.push(e));
}

function validateTrueCase(response, errors, warnings) {
  TRUE_REQUIRED_FIELDS.forEach((field) => {
    if (!(field in response)) errors.push(`必須フィールドが欠落しています: ${field}`);
  });

  ['missing_context', 'required_checks'].forEach((field) => {
    if (field in response) warnings.push(`can_generate=trueに${field}が含まれています(無視します)`);
  });

  ['title', 'body_html', 'meta_description'].forEach((field) => {
    if (field in response && typeof response[field] !== 'string') {
      errors.push(`${field}が文字列ではありません`);
    }
  });
  if ('warnings' in response && !Array.isArray(response.warnings)) {
    errors.push('warningsが配列ではありません');
  }

  const title = typeof response.title === 'string' ? response.title : null;
  if (title != null) {
    if (title.trim() === '') errors.push('titleが空です');
    else if (title.length > TITLE_MAX_LENGTH) {
      errors.push(`titleが${TITLE_MAX_LENGTH}文字を超えています(実際: ${title.length}文字)`);
    }
  }

  const bodyHtml = typeof response.body_html === 'string' ? response.body_html : null;
  if (bodyHtml != null) {
    if (bodyHtml.trim() === '') errors.push('body_htmlが空です');
    else checkArticleBodySafety(bodyHtml, errors);
  }
}

function validateFalseCase(response, errors, warnings) {
  FALSE_REQUIRED_FIELDS.forEach((field) => {
    if (!(field in response)) errors.push(`必須フィールドが欠落しています: ${field}`);
  });

  ['title', 'body_html', 'meta_description'].forEach((field) => {
    if (field in response) warnings.push(`can_generate=falseに${field}が含まれています(無視します)`);
  });

  ['missing_context', 'required_checks', 'warnings'].forEach((field) => {
    if (field in response && !Array.isArray(response[field])) {
      errors.push(`${field}が配列ではありません`);
    }
  });
}

// response: JSON.parse済みのLLM応答オブジェクト。
// 戻り値: { valid, errors, warnings, normalizedResponse }
function validatePublishResponse(response) {
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

module.exports = { validatePublishResponse, TITLE_MAX_LENGTH };
