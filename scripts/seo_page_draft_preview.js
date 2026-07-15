'use strict';

// Sprint 3.6: 承認済み(approved)Page Planから統合Draft用Promptをプレビュー表示するCLI。
// 実際の生成(Claude Code subagent実行)は行わない。DB書き込みも行わない、決定的な
// 読み取り専用コマンド(pageContext取得のみ既存page_context_provider.js経由で発生する)。
//
// 使い方:
//   node scripts/seo_page_draft_preview.js --plan-id=1 --format=json
//   node scripts/seo_page_draft_preview.js --plan-id=1 --format=json --output=data/seo_drafts/page_plan_1.prompt.json

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { buildPageContext } = require('./lib/seo/draft_generator');
const { buildPageDraftPrompt } = require('./lib/seo/page_draft_prompt_builder');
const { evaluatePagePlanStaleness } = require('./lib/seo/page_plan_staleness');

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    planId: get('--plan-id=') !== undefined ? Number(get('--plan-id=')) : undefined,
    format: get('--format=') || 'text',
    output: get('--output='),
  };
}

function primaryTaskForPrompt(plan) {
  return { taskId: plan.primary_task_id, targetKeyword: plan.primary_keyword };
}

function supportingTasksForPrompt(plan) {
  const verifiedIds = new Set((plan.fact_check_summary && plan.fact_check_summary.verified ? plan.fact_check_summary.verified : []).map((v) => v.taskId));
  return (plan.supporting_task_ids || []).map((taskId, index) => ({
    taskId,
    targetKeyword: (plan.supporting_keywords || [])[index],
    factStatus: verifiedIds.has(taskId) ? 'verified' : undefined,
  }));
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。DB書き込みなし。
// approved確認 → pageContext取得 → stale判定、の順に決定的へ判定する。
// pageContextDepsを注入可能にし、テストでは実ネットワーク接続を避ける。
async function resolveDraftPreview({ planId, pageContextDeps } = {}) {
  const plan = seoDb.getSeoPagePlanById(planId);
  if (!plan) {
    return { ok: false, errorCode: 'not_found', message: `page plan id=${planId} が見つかりません` };
  }

  if (plan.status !== 'approved') {
    return {
      ok: false,
      errorCode: 'page_plan_not_approved',
      message: `Page Plan status="${plan.status}"のためDraftを生成できません(approvedのみ生成対象です)`,
      planId,
      planStatus: plan.status,
    };
  }

  const pageContext = plan.target_url
    ? await buildPageContext({ target_url: plan.target_url }, pageContextDeps)
    : { status: 'not_fetched' };

  const staleness = evaluatePagePlanStaleness(plan, pageContext);

  if (!staleness.determined) {
    return {
      ok: false,
      errorCode: 'page_context_not_available',
      message: 'ページ本文を取得できないため生成できません(Page Planは自動再生成しません)',
      planId,
      pageContextStatus: pageContext.status,
    };
  }

  if (staleness.stale) {
    return {
      ok: false,
      errorCode: 'page_plan_content_stale',
      message: 'Page Plan作成後にページ本文が変更されているため生成できません(Page Planは自動再生成しません)',
      planId,
      pagePlanContentHash: staleness.previousContentHash,
      currentContentHash: staleness.currentContentHash,
    };
  }

  const { prompt, promptVersion, inputSummary } = buildPageDraftPrompt({
    pagePlan: {
      id: plan.id,
      targetUrl: plan.target_url,
      targetPageName: plan.target_page_name,
      combinedSearchIntents: plan.combined_search_intents,
      selectionBreakdown: plan.selection_breakdown,
      factCheckSummary: plan.fact_check_summary,
      sourceContentHash: plan.source_content_hash,
      updatedAt: plan.updated_at,
    },
    primaryTask: primaryTaskForPrompt(plan),
    supportingTasks: supportingTasksForPrompt(plan),
    excludedTasks: plan.excluded_tasks || [],
    pageContext,
  });

  return {
    ok: true,
    planId: plan.id,
    planStatus: plan.status,
    promptVersion,
    inputSummary,
    prompt,
  };
}

function formatText(result) {
  if (!result.ok) {
    return [`ok: false`, `errorCode: ${result.errorCode}`, `message: ${result.message}`].join('\n');
  }
  return [
    `planId: ${result.planId}`,
    `planStatus: ${result.planStatus}`,
    `promptVersion: ${result.promptVersion}`,
    '',
    '--- prompt ---',
    result.prompt,
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_page_draft_preview] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }
  if (!args.planId || Number.isNaN(args.planId)) {
    console.error('使い方: node scripts/seo_page_draft_preview.js --plan-id=<id> [--format=json|text] [--output=<path>]');
    process.exit(1);
  }

  const result = await resolveDraftPreview({ planId: args.planId });
  const output = args.format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_page_draft_preview] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }

  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_page_draft_preview] 予期しないエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, resolveDraftPreview, primaryTaskForPrompt, supportingTasksForPrompt, formatText, parseArgs };
