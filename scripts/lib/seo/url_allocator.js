'use strict';

// URL Allocator: キーワード(複合キーワード候補)をどのURL種別・作業種別で対応すべきかを
// 決定的なルールのみで判定する(AIには依存しない)。今回は判定ロジックのみを実装し、
// 実際のURL解決(既存記事のURLを引く等)はscripts/seo_task_generate.js側で行う。
//
// task_type: create_article/improve_existing_article/improve_school_page/
//            add_internal_links/add_faq/monitor/exclude

const { FAQ_TERMS } = require('./dictionaries');

function containsFaqTerm(keyword) {
  const text = keyword || '';
  return FAQ_TERMS.some((term) => text.includes(term));
}

// Task割当における「校舎ページ対応テンプレート」。recommended_action.jsのSCHOOL_PAGE_TEMPLATES
// (候補側: 既存記事の有無で判定)とは責務が異なるため、あえて独立して定義する
// (Task側は「登録済みの自社校舎ページ(config/school_pages.yaml)の有無」で判定するため)。
// area_juku: 地域名+塾/駅名相当(station_juku)は地域辞書と同一のためarea_jukuに統合済み。
// area_teaching_style: 地域名+指導形態(例: 個別指導)。area_muryou_taiken: 地域名+無料体験。
const SCHOOL_PAGE_ELIGIBLE_TEMPLATES = new Set(['area_juku', 'area_teaching_style', 'area_muryou_taiken']);

// input:
//   normalizedKeyword: 対象キーワード(複合キーワード文字列)
//   templateType: compound_keyword_builder.jsのtemplate_type(無ければnull)
//   gapType: gap_classifier.jsの判定結果
//   isLowIntent: priority_scorer.jsのisLowIntentKeyword()の結果
//   existingPostId: 強く一致する既存記事のpost_id(無ければnull)
//   relatedPostId: 関連はするが完全一致ではない既存記事のpost_id(無ければnull。現状は
//     判定元データが無いため呼び出し側は常にnullを渡す想定。将来の拡張ポイント)
//   existingSchoolPageUrl/existingSchoolPageId/existingSchoolPageName: target_areaに一致する
//     自社校舎ページ(school_page_registry.js)。無ければnull
//
// 戻り値: { taskType, targetUrl, targetPageId, targetPageName, reasons }
function allocateUrl(input) {
  const {
    normalizedKeyword,
    templateType = null,
    gapType,
    isLowIntent = false,
    existingPostId = null,
    relatedPostId = null,
    existingSchoolPageUrl = null,
    existingSchoolPageId = null,
    existingSchoolPageName = null,
  } = input;

  if (isLowIntent) {
    return { taskType: 'exclude', targetUrl: null, targetPageId: null, targetPageName: null, reasons: ['low_intent_keyword'] };
  }

  if (containsFaqTerm(normalizedKeyword)) {
    return { taskType: 'add_faq', targetUrl: null, targetPageId: null, targetPageName: null, reasons: ['faq_term_detected'] };
  }

  // 校舎ページ対応テンプレートは、gap_type(優先度)より前に判定する。
  // 「どのページ・施策で対応すべきか」(URL Allocatorの責務)と「どの程度優先すべきか」
  // (gap_type/Opportunity Scoreの責務)を分離するため、順位が良い(gap_type=strong)ことを
  // 理由に対象ページの割当自体をmonitorへ変更しない(2026-07-14 設計変更)。
  if (SCHOOL_PAGE_ELIGIBLE_TEMPLATES.has(templateType)) {
    if (existingSchoolPageUrl) {
      return {
        taskType: 'improve_school_page',
        targetUrl: existingSchoolPageUrl,
        targetPageId: existingSchoolPageId,
        targetPageName: existingSchoolPageName,
        reasons: ['school_page_template', 'existing_school_page_found'],
      };
    }
    // 校舎ページ/地域LPが未登録の場合はcreate_articleにフォールバックしない
    // (校舎ページ対応テンプレートはブログ記事ではなく校舎ページ/地域LPで対応する想定のため)。
    return {
      taskType: 'monitor',
      targetUrl: null,
      targetPageId: null,
      targetPageName: null,
      reasons: ['school_page_template', 'no_registered_school_page_or_landing_page'],
    };
  }

  if (gapType === 'strong') {
    return { taskType: 'monitor', targetUrl: null, targetPageId: null, targetPageName: null, reasons: ['own_already_strong'] };
  }

  if (existingPostId) {
    return { taskType: 'improve_existing_article', targetUrl: null, targetPageId: null, targetPageName: null, reasons: ['existing_article_match'] };
  }

  if (relatedPostId) {
    return { taskType: 'add_internal_links', targetUrl: null, targetPageId: null, targetPageName: null, reasons: ['related_post_found_not_exact_match'] };
  }

  if (gapType === 'missing' || gapType === 'untapped' || gapType === 'content_gap') {
    return { taskType: 'create_article', targetUrl: null, targetPageId: null, targetPageName: null, reasons: [`gap_type_${gapType}`] };
  }

  return { taskType: 'monitor', targetUrl: null, targetPageId: null, targetPageName: null, reasons: [`gap_type_${gapType}`] };
}

module.exports = { allocateUrl, containsFaqTerm, SCHOOL_PAGE_ELIGIBLE_TEMPLATES };
