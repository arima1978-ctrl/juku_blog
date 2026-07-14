'use strict';

// AI改善ドラフト生成の「準備段階」。SEO Task・候補・GSC実績からPromptを組み立てるだけの
// 決定的処理であり、LLM API・外部サイト・WordPressへは一切接続しない。
// DBへの書き込みも行わない(呼び出し元のCLIも含め、今回はプレビュー表示のみ)。

const { buildPrompt } = require('./draft_prompt_template');

// ページ本文取得は今回のSprintでは実装しない。常に「未取得」固定のスケルトンを返す
// (将来、本文取得を実装する際にこの関数の中身だけを差し替える想定)。
function buildPageContext(task) {
  return {
    url: task.target_url,
    title: null,
    headings: [],
    bodyExcerpt: null,
    fetchedAt: null,
    contentHash: null,
    status: 'not_fetched',
  };
}

// task: seo_tasksの1行(getTaskById相当、reasonは配列にparse済み)
// candidate: seo_keyword_candidatesの1行(source_candidate_idが無ければnull)
// gscMetrics: seoDb.getGscAggregateForKeywordの戻り値(無ければnull)
function buildDraftPreview({ task, candidate, gscMetrics }) {
  const pageContext = buildPageContext(task);

  const { prompt, mode, promptVersion } = buildPrompt({
    targetUrl: task.target_url,
    targetPageName: task.target_page_name,
    targetKeyword: task.target_keyword,
    targetArea: candidate ? candidate.target_area : null,
    gapType: candidate ? candidate.gap_type : null,
    opportunityScore: task.opportunity_score,
    reason: task.reason,
    gscMetrics,
    pageContext,
  });

  return {
    task_id: task.id,
    task_type: task.task_type,
    target_keyword: task.target_keyword,
    target_url: task.target_url,
    target_page_name: task.target_page_name,
    gap_type: candidate ? candidate.gap_type : null,
    opportunity_score: task.opportunity_score,
    data_confidence: candidate ? candidate.data_confidence : null,
    gsc_metrics: gscMetrics,
    page_context: pageContext,
    page_context_status: pageContext.status,
    prompt_version: promptVersion,
    prompt_mode: mode,
    prompt,
  };
}

module.exports = { buildPageContext, buildDraftPreview };
