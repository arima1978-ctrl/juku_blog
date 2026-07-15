'use strict';

// Sprint 3.7: 承認済み(またはレビュー中)のPage Planが、ページ本文の変更によって
// 内容が古くなっている(stale)かどうかを決定的に判定する共通ヘルパー。
// DB書き込み・LLM呼び出し・外部通信は一切行わない(pageContextは呼び出し側が
// 既存のbuildPageContext()等で取得済みのものを渡す)。
// 既存のDraft Preview(scripts/seo_page_draft_preview.js、Sprint 3.6)と、
// Sprint 3.7のstale Page Plan再生成CLIの両方から利用し、判定ロジックの重複を避ける。

// pagePlan: scripts/lib/seo_db.jsのgetSeoPagePlanById()相当(snake_case、
//   source_content_hashを持つオブジェクト)。
// pageContext: page_context_provider.js/draft_generator.jsのbuildPageContext()が
//   返す{status, contentHash, ...}。status !== 'fetched'の場合は判定不能とする。
// 戻り値:
//   determined: false の場合、pageContextが取得できておらず判定不能
//     (呼び出し側はPage Planを一切変更しないこと)。
//   determined: true の場合、staleがtrue/falseで結果が確定している。
function evaluatePagePlanStaleness(pagePlan, pageContext) {
  const previousContentHash = (pagePlan && pagePlan.source_content_hash) || null;

  if (!pageContext || pageContext.status !== 'fetched') {
    return {
      determined: false,
      stale: false,
      reason: null,
      previousContentHash,
      currentContentHash: null,
    };
  }

  const currentContentHash = pageContext.contentHash || null;
  const stale = previousContentHash !== currentContentHash;

  return {
    determined: true,
    stale,
    reason: stale ? 'content_hash_mismatch' : null,
    previousContentHash,
    currentContentHash,
  };
}

module.exports = { evaluatePagePlanStaleness };
