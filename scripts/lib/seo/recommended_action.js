'use strict';

// 推奨アクションの決定(MVP版)。決定的なルールのみを使い、LLMには依存しない。
// improve_school_page/add_internal_links/merge_articlesは自動判定が難しいため
// MVPでは自動付与せず、ダッシュボード上で人間が手動選択できる選択肢として提供する
// (未確定事項としてユーザーへ報告済み)。
//
// isLowIntent(求人語等の明示的な低意図語を含むか)で除外判定する。
// 「高意図語が無い」だけでは除外しない(教科名・学年名・地域名単体は高意図語リストに
// 無いが、除外すべきではない正当な候補のため。過去にこれを誤ってinquiryIntentRatio===0で
// 除外判定していたバグを修正した経緯がある)。
function decideRecommendedAction({ gapType, isLowIntent, ownHasArticle }) {
  if (isLowIntent) return 'exclude';
  if (gapType === 'strong') return 'monitor';
  if (gapType === 'weak' && ownHasArticle) return 'improve_existing_article';
  if (gapType === 'missing' || gapType === 'untapped' || gapType === 'content_gap') return 'create_article';
  return 'monitor'; // shared 等
}

module.exports = { decideRecommendedAction };
