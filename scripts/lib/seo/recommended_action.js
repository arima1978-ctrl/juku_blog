'use strict';

// 推奨アクションの決定(MVP版)。決定的なルールのみを使い、LLMには依存しない。
// add_internal_links/merge_articlesは自動判定が難しいため引き続き自動付与せず、
// ダッシュボード上で人間が手動選択できる選択肢として提供する。
//
// isLowIntent(求人語等の明示的な低意図語を含むか)で除外判定する。
// 「高意図語が無い」だけでは除外しない(過去のバグ修正経緯はgit履歴参照)。

// これらのテンプレートは「地域名/駅名+塾」「地域名+無料体験」に相当し、
// 原則として新規ブログ記事ではなく校舎ページの改善を優先する
// (design doc: 設計案2026-07-13の「2-1 複合キーワード生成」「2-3 推奨アクション判定」参照)。
// station_juku相当は現状area_jukuに統合されている(駅名辞書が地域辞書と同一のため)。
const SCHOOL_PAGE_TEMPLATES = new Set(['area_juku', 'area_muryou_taiken']);

// これらは新規ブログ記事候補として明示的に指定されたテンプレート。
const BLOG_ARTICLE_TEMPLATES = new Set(['school_teiki_test', 'area_koko_nyushi', 'area_teiki_test']);

function decideRecommendedAction({ gapType, isLowIntent, ownHasArticle, templateType, existingPostId }) {
  if (isLowIntent) return 'exclude';
  if (gapType === 'strong') return 'monitor';
  if (gapType === 'weak' && ownHasArticle) return 'improve_existing_article';

  if (SCHOOL_PAGE_TEMPLATES.has(templateType)) {
    // 既存の校舎ページ(existing_post_id)があれば改善、無ければまず作る
    return existingPostId ? 'improve_school_page' : 'create_article';
  }

  if (BLOG_ARTICLE_TEMPLATES.has(templateType)) return 'create_article';

  // area_grade_juku/area_teaching_style/area_subject_juku/area_season_course/school_juku等、
  // 未指定テンプレートの既定値(設計案の未確定事項dの既定対応)。
  if (gapType === 'missing' || gapType === 'untapped' || gapType === 'content_gap') return 'create_article';
  return 'monitor'; // shared 等
}

module.exports = { decideRecommendedAction, SCHOOL_PAGE_TEMPLATES, BLOG_ARTICLE_TEMPLATES };
