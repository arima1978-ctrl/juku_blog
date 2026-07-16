'use strict';

// Sprint 3.3/3.3.1: 同一ページを対象とするSEO Taskのグルーピング結果をプレビュー表示する
// CLI(dry-run)。scripts/lib/seo/page_task_grouper.js(骨格分類)と
// scripts/lib/seo/supporting_task_fact_checker.js(Supporting Taskの事実確認)を
// 組み合わせて呼び出すだけで、DB書き込み・LLM呼び出し・WordPress接続は一切行わない。
// ページ本文取得は既存scripts/lib/seo/draft_generator.jsのbuildPageContext
// (fetcher.js + page_context_provider.js)のみを利用し、新しいfetch処理は追加しない。
//
// 使い方:
//   node scripts/seo_page_task_group_preview.js --format=json
//   node scripts/seo_page_task_group_preview.js --page-type=school_page --page-id=obata --format=json
//   node scripts/seo_page_task_group_preview.js --format=json --output=data/reports/page_task_groups.json

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { buildPageContext } = require('./lib/seo/draft_generator');
const { groupTasksByPage, applySupportingFactChecks, toDisplayTask } = require('./lib/seo/page_task_grouper');

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    pageType: get('--page-type='),
    pageId: get('--page-id='),
    format: get('--format=') || 'text',
    output: get('--output='),
  };
}

// seo_tasks/seo_keyword_candidates/GSC実績から、page_task_grouper.jsが必要とする
// 拡張Taskオブジェクトへ変換する(DBアクセスはここに閉じ込め、grouper自体は純粋関数に保つ)。
function buildEnrichedTasks(branchId) {
  const tasks = seoDb.listTasks({ status: 'proposed', taskType: 'improve_school_page', branchId });
  return tasks.map((task) => {
    const candidate = task.source_candidate_id ? seoDb.getKeywordCandidateById(task.source_candidate_id) : null;
    const gsc = seoDb.getGscAggregateForKeyword(task.target_keyword);
    return {
      taskId: task.id,
      branchId: task.branch_id,
      status: task.status,
      taskType: task.task_type,
      targetUrl: task.target_url,
      targetPageType: task.target_page_type,
      targetPageId: task.target_page_id,
      targetPageName: task.target_page_name,
      targetKeyword: task.target_keyword,
      opportunityScore: task.opportunity_score,
      sourceCandidateId: task.source_candidate_id,
      gapType: candidate ? candidate.gap_type : null,
      dataConfidence: candidate ? candidate.data_confidence : null,
      searchIntent: candidate ? candidate.search_intent : null,
      templateType: candidate ? candidate.template_type : null,
      keywordComponents: candidate ? candidate.keyword_components : null,
      gscImpressions: gsc ? gsc.impressions : null,
      gscAvgPosition: gsc ? gsc.avgPosition : null,
    };
  });
}

function excludedTaskToDisplay(e) {
  return {
    taskId: e.taskId,
    targetKeyword: e.targetKeyword,
    reason: e.reason,
    ...(e.duplicateOf ? { duplicateOf: e.duplicateOf } : {}),
    ...(e.intentFamily ? { intentFamily: e.intentFamily } : {}),
    ...(e.factStatus ? { factStatus: e.factStatus, factEvidence: e.factEvidence } : {}),
  };
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。DB書き込みなし。
// pageContextDepsを注入可能にし、テストでは実ネットワーク接続を避ける(既定は実際のbuildPageContext)。
async function resolveGroupPreview({ pageType, pageId, pageContextDeps } = {}) {
  let enrichedTasks = buildEnrichedTasks();
  if (pageType) enrichedTasks = enrichedTasks.filter((t) => t.targetPageType === pageType);
  if (pageId) enrichedTasks = enrichedTasks.filter((t) => t.targetPageId === pageId);

  const result = groupTasksByPage(enrichedTasks);

  const factCheckedGroups = [];
  for (const group of result.groups) {
    // target_url不一致(null)の場合はpage_context取得自体を試みない(どのページか確定できないため)。
    const pageContext = group.targetUrl
      ? await buildPageContext({ target_url: group.targetUrl }, pageContextDeps)
      : { status: 'not_fetched' };
    factCheckedGroups.push(applySupportingFactChecks(group, pageContext));
  }

  return {
    generatedAt: new Date().toISOString(),
    groupCount: factCheckedGroups.length,
    groups: factCheckedGroups.map((g) => ({
      groupKey: g.groupKey,
      targetPageType: g.targetPageType,
      targetPageId: g.targetPageId,
      targetPageName: g.targetPageName,
      targetUrl: g.targetUrl,
      taskCount: g.tasks.length,
      primaryTask: g.primaryTask ? toDisplayTask(g.primaryTask) : null,
      supportingTasks: g.supportingTasks.map(toDisplayTask),
      excludedTasks: g.excludedTasks.map(excludedTaskToDisplay),
      warnings: g.warnings,
    })),
    ungrouped: result.ungrouped,
    warnings: factCheckedGroups.flatMap((g) => g.warnings.map((w) => ({ groupKey: g.groupKey, ...w }))),
  };
}

function formatText(preview) {
  const lines = [`generatedAt: ${preview.generatedAt}`, `groupCount: ${preview.groupCount}`, ''];
  preview.groups.forEach((g) => {
    lines.push(`--- ${g.groupKey} (${g.targetPageName || '-'}, ${g.targetUrl || '(target_url不一致)'}) ---`);
    lines.push(`  Primary: ${g.primaryTask ? `${g.primaryTask.taskId} ${g.primaryTask.targetKeyword}` : '(なし)'}`);
    lines.push(`  Supporting: ${g.supportingTasks.map((t) => `${t.taskId} ${t.targetKeyword}(${t.factStatus || '-'})`).join(', ') || '(なし)'}`);
    lines.push(`  Excluded: ${g.excludedTasks.map((t) => `${t.taskId} ${t.targetKeyword}(${t.reason})`).join(', ') || '(なし)'}`);
    if (g.warnings.length > 0) lines.push(`  Warnings: ${JSON.stringify(g.warnings)}`);
    lines.push('');
  });
  if (preview.ungrouped.length > 0) {
    lines.push(`ungrouped: ${preview.ungrouped.map((t) => `${t.taskId}(${t.reason})`).join(', ')}`);
  }
  if (preview.warnings.length > 0) {
    lines.push(`warnings: ${JSON.stringify(preview.warnings)}`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_page_task_group_preview] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  const preview = await resolveGroupPreview({ pageType: args.pageType, pageId: args.pageId });
  const output = args.format === 'json' ? JSON.stringify(preview, null, 2) : formatText(preview);

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_page_task_group_preview] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_page_task_group_preview] 予期しないエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, resolveGroupPreview, buildEnrichedTasks, formatText };
