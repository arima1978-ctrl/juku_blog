'use strict';

// Sprint 3.9: AI Weekly Director。毎週、着手すべき最もROIの高い3〜5件のTaskを選定し、
// 各Taskに対するDraft/Page Plan PromptをPre-generateして週次バンドルとして保持する。
// Claude Code subagentは一切起動しない(Promptファイルの生成・保存までがこのCLIの
// 責務。実際の文章生成は既存方針どおり、人間が別途subagentを実行する)。
// 既定でdry-run(DB非更新)。`--save`明示時のみseo_weekly_recommendationsへ保存する。
//
// 使い方:
//   node scripts/seo_weekly_director.js --dry-run
//   node scripts/seo_weekly_director.js --save
//   node scripts/seo_weekly_director.js --dry-run --format=json --output=data/reports/weekly_2026-07-13.json

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const branchesDb = require('./lib/branches_db');
const { curateWeeklyTasks } = require('./lib/seo/weekly_task_curator');
const { dispatchWeeklyDrafts } = require('./lib/seo/weekly_draft_dispatcher');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    dryRun: has('--dry-run'),
    save: has('--save'),
    format: get('--format=') || 'text',
    output: get('--output='),
  };
}

// 実行日が含まれる週の月曜日(YYYY-MM-DD)を返す。ローカル時刻ベースで判定する
// (例: 2026-07-15(水)なら2026-07-13(月))。
function mondayOfWeek(date) {
  const d = new Date(date.getTime());
  const day = d.getDay(); // 0=日,1=月,...,6=土
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// タスク本体の情報とdispatch結果(draftStatus/draftPromptPath等)をtaskId単位でマージする。
function mergeItems(selectedTasks, dispatchedItems) {
  const dispatchedByTaskId = new Map(dispatchedItems.map((item) => [item.taskId, item]));
  return selectedTasks.map((task) => {
    const dispatched = dispatchedByTaskId.get(task.id) || {};
    return {
      taskId: task.id,
      taskType: task.task_type,
      targetKeyword: task.target_keyword,
      roiPriorityScore: task.roi_priority_score,
      opportunityScore: task.opportunity_score,
      difficultyScore: task.difficulty_score,
      expectedImpactCv: task.expected_impact_cv,
      expectedImpactClicks: task.expected_impact_clicks,
      estimatedEffortMinutes: task.estimated_effort_minutes,
      draftStatus: dispatched.draftStatus ?? null,
      draftPromptPath: dispatched.draftPromptPath ?? null,
      pagePlanId: dispatched.pagePlanId ?? null,
      pagePlanStatus: dispatched.pagePlanStatus ?? null,
    };
  });
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。
// save=falseの場合はDBへ一切書き込まない(seoDb.upsertWeeklyRecommendationを呼ばない)。
// 依存注入(seoDbImpl/curateWeeklyTasksImpl/dispatchWeeklyDraftsImpl/pageContextDeps/now)
// により、テストでは実DB・実ネットワーク接続・実際の日付判定を避けられる。
async function resolveWeeklyDirector({
  save = false,
  curationOptions,
  seoDbImpl = seoDb,
  branchesDbImpl = branchesDb,
  curateWeeklyTasksImpl = curateWeeklyTasks,
  dispatchWeeklyDraftsImpl = dispatchWeeklyDrafts,
  pageContextDeps,
  outputDir,
  now = new Date(),
  nowIso,
  branchId,
} = {}) {
  const batchDate = mondayOfWeek(now);
  const stamp = nowIso || now.toISOString();

  // 複数校舎管理: branchIdが明示指定されればその校舎を対象にする(ダッシュボード/APIから
  // 特定の校舎向けに生成する場合)。未指定時は従来通り現在アクティブな校舎にフォールバックする
  // (CLI/cronの既存挙動を変えないためのデフォルト)。
  const activeBranchId =
    branchId !== undefined && branchId !== null
      ? branchId
      : ((branchesDbImpl.getActiveBranch() || {}).id ?? null);

  const candidateTasks = seoDbImpl.listTasks({ status: 'proposed', branchId: activeBranchId });
  const curation = curateWeeklyTasksImpl(candidateTasks, curationOptions);

  const dispatchedItems = await dispatchWeeklyDraftsImpl(curation.selectedTasks, batchDate, {
    seoDbImpl,
    pageContextDeps,
    outputDir,
  });

  const items = mergeItems(curation.selectedTasks, dispatchedItems);

  const result = {
    batchDate,
    curationTier: curation.curationTier,
    totalExpectedCv: curation.totalExpectedCv,
    totalEffortMinutes: curation.totalEffortMinutes,
    taskTypeBreakdown: curation.taskTypeBreakdown,
    items,
    saved: false,
  };

  if (!save) {
    return result;
  }

  const saveResult = seoDbImpl.upsertWeeklyRecommendation(
    {
      batchDate,
      branchId: activeBranchId,
      taskIds: curation.selectedTasks.map((t) => t.id),
      items,
      totalExpectedCv: curation.totalExpectedCv,
      totalEffortMinutes: curation.totalEffortMinutes,
      taskTypeBreakdown: curation.taskTypeBreakdown,
      curationTier: curation.curationTier,
      curationParams: curationOptions || {},
    },
    stamp
  );

  return { ...result, saved: true, saveResult };
}

function formatText(result) {
  const lines = [
    `batchDate: ${result.batchDate}`,
    `curationTier: ${result.curationTier}`,
    `totalExpectedCv: ${result.totalExpectedCv != null ? result.totalExpectedCv.toFixed(2) : '-'}`,
    `totalEffortMinutes: ${result.totalEffortMinutes}`,
    `taskTypeBreakdown: ${JSON.stringify(result.taskTypeBreakdown)}`,
    `saved: ${result.saved}`,
  ];
  if (result.saveResult) {
    lines.push(
      result.saveResult.locked
        ? `saveResult: locked(既存status=${result.saveResult.lockedStatus}のため更新せず)`
        : `saveResult: id=${result.saveResult.id} isNew=${result.saveResult.isNew}`
    );
  }
  lines.push('', '--- 今週の仕事 ---');
  result.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. [task_id=${item.taskId}] ${item.taskType} 「${item.targetKeyword}」`,
      `   roi=${item.roiPriorityScore ?? '-'} opportunity=${item.opportunityScore} difficulty=${item.difficultyScore ?? '-'} effort=${item.estimatedEffortMinutes ?? '-'}分`,
      `   expected_impact_cv=${item.expectedImpactCv != null ? item.expectedImpactCv.toFixed(2) : '-'}`,
      `   draftStatus=${item.draftStatus}${item.draftPromptPath ? ` (${item.draftPromptPath})` : ''}`
    );
  });
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_weekly_director] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  if (args.dryRun && args.save) {
    console.error('[seo_weekly_director] --dry-runと--saveは同時に指定できません');
    process.exit(1);
  }

  const save = args.save === true; // どちらも未指定の場合は安全側でdry-run(save=false)

  const gdConfig = config.seo.growth_director;
  const curationOptions = {
    targetCount: { min: 3, max: 5 },
    effortBudgetMinutes: (gdConfig.weekly_director && gdConfig.weekly_director.effort_budget_minutes) || 60,
    maxPerTaskType: (gdConfig.weekly_director && gdConfig.weekly_director.max_per_task_type) || 2,
  };

  const result = await resolveWeeklyDirector({ save, curationOptions });
  const output = args.format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_weekly_director] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_weekly_director] 予期しないエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, resolveWeeklyDirector, mondayOfWeek, mergeItems, formatText, parseArgs };
