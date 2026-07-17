'use strict';

// AI改善ドラフト生成の「準備段階」。SEO Task・候補・GSC実績・(登録済み校舎ページのみ)
// ページ本文からPromptを組み立てる決定的処理。LLM API・WordPressへは一切接続しない。
// DBへの書き込みも行わない(呼び出し元のCLIも含め、今回はプレビュー表示のみ)。

const { loadJukuConfig } = require('../config');
const { buildPrompt } = require('./draft_prompt_template');
const { fetchPageContext } = require('./page_context_provider');
const { listEnabledSchoolPages, getSchoolPageByUrl } = require('./school_page_registry');

function notFetchedContext(task) {
  return {
    status: 'not_fetched',
    url: task.target_url,
    title: null,
    headings: [],
    bodyExcerpt: null,
    fetchedAt: null,
    contentHash: null,
  };
}

// task.target_urlが登録済み校舎ページ(config/school_pages.yaml)と一致する場合のみ実際に
// 取得する。一致しなければ外部通信せず従来通りnot_fetchedを返す。
// 依存はすべて注入可能(テスト時に実ネットワーク接続を避けるため)。
async function buildPageContext(
  task,
  {
    fetchPage = fetchPageContext,
    getSchoolPage = getSchoolPageByUrl,
    listSchoolPages = listEnabledSchoolPages,
    loadConfig = loadJukuConfig,
  } = {}
) {
  if (!task.target_url) return notFetchedContext(task);

  // 2026-07-17判明の一連の「branchId無しでconfig読込」バグと同種のため、ここでも
  // task.branch_id(seo_tasksが持つ由来校舎)を明示的に渡す。
  const schoolPage = getSchoolPage(task.target_url, task.branch_id);
  if (!schoolPage) return notFetchedContext(task);

  const seoConfig = loadConfig(task.branch_id).seo.competitor_analysis;
  // 許可リストはconfig/school_pages.yaml由来のみで作る(競合サイトの許可リストとは分離)。
  const allowedBaseUrls = listSchoolPages(task.branch_id).map((p) => p.url);

  return fetchPage(task.target_url, {
    allowedBaseUrls,
    userAgent: seoConfig.user_agent,
    timeoutMs: seoConfig.request_timeout_ms,
    intervalMs: seoConfig.request_interval_ms,
    maxRetries: seoConfig.max_retries,
  });
}

// task: seo_tasksの1行(getTaskById相当、reasonは配列にparse済み)
// candidate: seo_keyword_candidatesの1行(source_candidate_idが無ければnull)
// gscMetrics: seoDb.getGscAggregateForKeywordの戻り値(無ければnull)
// pageContextDeps: buildPageContextへ渡す依存注入(テスト用)
async function buildDraftPreview({ task, candidate, gscMetrics }, { pageContextDeps } = {}) {
  const pageContext = await buildPageContext(task, pageContextDeps);

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
