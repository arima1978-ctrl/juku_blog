'use strict';

// Sprint 3.4: Page Task Grouper + Supporting Fact Checkの結果を、
// ページ単位のPage Planとして組み立て、既定ではdry-run表示のみ行う(DB保存なし)。
// --save明示時のみseo_page_plansへupsertする。
// Task生成・GSC同期・WordPress・Draft生成・Claude subagent・LLM APIへは一切接続しない。
//
// 使い方:
//   node scripts/seo_page_plan_generate.js --page-type=school_page --page-id=obata --dry-run --format=json
//   node scripts/seo_page_plan_generate.js --page-type=school_page --page-id=obata --save --format=json

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { buildPageContext } = require('./lib/seo/draft_generator');
const { groupTasksByPage, applySupportingFactChecks } = require('./lib/seo/page_task_grouper');
const { buildPagePlan } = require('./lib/seo/page_plan_builder');
const { buildEnrichedTasks } = require('./seo_page_task_group_preview');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    pageType: get('--page-type='),
    pageId: get('--page-id='),
    dryRun: has('--dry-run'),
    save: has('--save'),
    format: get('--format=') || 'text',
    output: get('--output='),
  };
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。
// save=falseの場合はDBへ一切書き込まない(seoDb.upsertSeoPagePlanを呼ばない)。
// pageContextDepsを注入可能にし、テストでは実ネットワーク接続を避ける。
async function resolvePagePlans({ pageType, pageId, save = false, pageContextDeps, nowIso } = {}) {
  let enrichedTasks = buildEnrichedTasks();
  if (pageType) enrichedTasks = enrichedTasks.filter((t) => t.targetPageType === pageType);
  if (pageId) enrichedTasks = enrichedTasks.filter((t) => t.targetPageId === pageId);

  const grouped = groupTasksByPage(enrichedTasks);
  const stamp = nowIso || new Date().toISOString();

  const plans = [];
  for (const group of grouped.groups) {
    const pageContext = group.targetUrl
      ? await buildPageContext({ target_url: group.targetUrl }, pageContextDeps)
      : { status: 'not_fetched' };
    const factChecked = applySupportingFactChecks(group, pageContext);
    const plan = buildPagePlan(factChecked, pageContext);
    if (!plan) continue;

    const saveResult = save ? seoDb.upsertSeoPagePlan(plan, stamp) : null;
    plans.push({ plan, saveResult });
  }

  return { generatedAt: stamp, saved: save, planCount: plans.length, plans, ungrouped: grouped.ungrouped };
}

function formatText(result) {
  const lines = [`generatedAt: ${result.generatedAt}`, `saved: ${result.saved}`, `planCount: ${result.planCount}`, ''];
  result.plans.forEach(({ plan, saveResult }) => {
    lines.push(`--- ${plan.groupKey} (${plan.targetPageName || '-'}) ---`);
    lines.push(`  Primary: ${plan.primaryTaskId} ${plan.primaryKeyword}`);
    lines.push(`  Supporting: ${plan.supportingKeywords.join(', ') || '(なし)'}`);
    lines.push(`  Excluded: ${plan.excludedTasks.map((e) => `${e.taskId}(${e.reason})`).join(', ') || '(なし)'}`);
    lines.push(`  sourceContentHash: ${plan.sourceContentHash || '(なし)'}`);
    lines.push(`  status: ${plan.status}`);
    if (saveResult) {
      lines.push(
        saveResult.locked
          ? `  save: plan_locked_status(既存status=${saveResult.lockedStatus}のため更新せず)`
          : `  save: id=${saveResult.id} isNew=${saveResult.isNew}`
      );
    }
    lines.push('');
  });
  if (result.ungrouped.length > 0) {
    lines.push(`ungrouped: ${result.ungrouped.map((t) => `${t.taskId}(${t.reason})`).join(', ')}`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_page_plan_generate] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  if (args.dryRun && args.save) {
    console.error('[seo_page_plan_generate] --dry-runと--saveは同時に指定できません');
    process.exit(1);
  }

  const save = args.save === true; // どちらも未指定の場合は安全側でdry-run(save=false)

  const result = await resolvePagePlans({ pageType: args.pageType, pageId: args.pageId, save });
  const output = args.format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_page_plan_generate] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_page_plan_generate] 予期しないエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, resolvePagePlans, formatText, parseArgs };
