'use strict';

// URL Allocator: キーワード(複合キーワード候補)をどのURL種別・作業種別で対応すべきかを
// 決定的なルールのみで判定する(AIには依存しない)。今回は判定ロジックのみを実装し、
// 実際のURL解決(既存記事のURLを引く等)はscripts/seo_task_generate.js側で行う。
//
// task_type: create_article/improve_existing_article/improve_school_page/
//            add_internal_links/add_faq/monitor/exclude

const { FAQ_TERMS } = require('./dictionaries');
const { SCHOOL_PAGE_TEMPLATES } = require('./recommended_action');

function containsFaqTerm(keyword) {
  const text = keyword || '';
  return FAQ_TERMS.some((term) => text.includes(term));
}

// input:
//   normalizedKeyword: 対象キーワード(複合キーワード文字列)
//   templateType: compound_keyword_builder.jsのtemplate_type(無ければnull)
//   gapType: gap_classifier.jsの判定結果
//   isLowIntent: priority_scorer.jsのisLowIntentKeyword()の結果
//   existingPostId: 強く一致する既存記事のpost_id(無ければnull)
//   relatedPostId: 関連はするが完全一致ではない既存記事のpost_id(無ければnull。現状は
//     判定元データが無いため呼び出し側は常にnullを渡す想定。将来の拡張ポイント)
//   ownAvgPosition: 自社の平均掲載順位(参考情報。判定には使うが無くても動作する)
//
// 戻り値: { taskType, reasons }
function allocateUrl(input) {
  const {
    normalizedKeyword,
    templateType = null,
    gapType,
    isLowIntent = false,
    existingPostId = null,
    relatedPostId = null,
  } = input;

  if (isLowIntent) {
    return { taskType: 'exclude', reasons: ['low_intent_keyword'] };
  }

  if (containsFaqTerm(normalizedKeyword)) {
    return { taskType: 'add_faq', reasons: ['faq_term_detected'] };
  }

  if (gapType === 'strong') {
    return { taskType: 'monitor', reasons: ['own_already_strong'] };
  }

  if (SCHOOL_PAGE_TEMPLATES.has(templateType)) {
    return existingPostId
      ? { taskType: 'improve_school_page', reasons: ['school_page_template', 'existing_school_page_found'] }
      : { taskType: 'create_article', reasons: ['school_page_template', 'no_existing_school_page'] };
  }

  if (existingPostId) {
    return { taskType: 'improve_existing_article', reasons: ['existing_article_match'] };
  }

  if (relatedPostId) {
    return { taskType: 'add_internal_links', reasons: ['related_article_found_not_exact_match'] };
  }

  if (gapType === 'missing' || gapType === 'untapped' || gapType === 'content_gap') {
    return { taskType: 'create_article', reasons: [`gap_type_${gapType}`] };
  }

  return { taskType: 'monitor', reasons: [`gap_type_${gapType}`] };
}

module.exports = { allocateUrl, containsFaqTerm };
