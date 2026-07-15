'use strict';

// Sprint 3.7: 承認後にページ本文が変わり内容が古くなった(stale)Page Planを、
// 最新のSEO Tasks・pageContextから再計算し、人間の再レビューへ戻すCLI。
// 既定でdry-run(DB非更新)。`--save`明示時のみ、以下を1つのDBトランザクションで反映する:
//   現在status → stale(履歴INSERT) → 内容UPDATE → stale → proposed(履歴INSERT)
// 新しい分類ロジックは作らず、既存のPage Task Grouper/Supporting Fact Check/
// Page Plan Builderをそのまま再利用する。Claude Code subagent・LLM API・
// WordPress・Draft生成・Task/Candidate変更は一切行わない。
// 短期案(Sprint 3.7)ではPage Planのバージョン管理は行わず、同じPage Plan行を
// 上書きする(詳細はdocs/growth_director.md参照)。
//
// 使い方:
//   node scripts/seo_page_plan_regenerate.js --plan-id=1 --expected-status=approved \
//     --actor=admin --reason="現在ページの本文が承認時から変更されたため再分析" --dry-run
//   node scripts/seo_page_plan_regenerate.js --plan-id=1 --expected-status=approved \
//     --actor=admin --reason="現在ページの本文が承認時から変更されたため再分析" --save

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { buildPageContext } = require('./lib/seo/draft_generator');
const { evaluatePagePlanStaleness } = require('./lib/seo/page_plan_staleness');
const { regeneratePagePlanContent, comparePagePlanChanges } = require('./lib/seo/stale_page_plan_regenerator');
const { buildEnrichedTasks } = require('./seo_page_task_group_preview');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    planId: get('--plan-id=') !== undefined ? Number(get('--plan-id=')) : undefined,
    expectedStatus: get('--expected-status='),
    actor: get('--actor='),
    reason: get('--reason='),
    dryRun: has('--dry-run'),
    save: has('--save'),
    format: get('--format=') || 'text',
    output: get('--output='),
  };
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。
// save=falseの場合はDBへ一切書き込まない(regenerateStaleSeoPagePlanを呼ばない)。
// enrichedTasksProvider/pageContextDepsを注入可能にし、テストでは実DB・実ネットワーク
// 接続を避ける。
async function resolveStalePagePlanRegenerate({
  planId,
  expectedStatus,
  actor,
  reason,
  save = false,
  pageContextDeps,
  enrichedTasksProvider = buildEnrichedTasks,
  nowIso,
} = {}) {
  const stamp = nowIso || new Date().toISOString();
  const plan = seoDb.getSeoPagePlanById(planId);

  if (!plan) {
    return { ok: false, errorCode: 'not_found', message: `page plan id=${planId} が見つかりません` };
  }

  const conflict = plan.status !== expectedStatus;
  if (conflict) {
    return {
      ok: false,
      errorCode: 'page_plan_status_conflict',
      message: `期待したstatus(${expectedStatus})と実際のstatus(${plan.status})が一致しません`,
      pagePlanId: planId,
      currentStatus: plan.status,
      expectedStatus,
      saved: false,
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
      message: 'ページ本文を取得できないためstale判定できません(Page Planは変更しません)',
      pagePlanId: planId,
      currentStatus: plan.status,
      saved: false,
    };
  }

  if (!staleness.stale) {
    return {
      ok: true,
      saved: false,
      pagePlanId: planId,
      currentStatus: plan.status,
      stale: false,
      message: 'source_content_hashが現在のページ本文と一致しているため再生成は不要です',
      previousContentHash: staleness.previousContentHash,
      currentContentHash: staleness.currentContentHash,
    };
  }

  const enrichedTasks = enrichedTasksProvider();
  const regeneratedPlan = regeneratePagePlanContent({
    enrichedTasks,
    targetPageType: plan.target_page_type,
    targetPageId: plan.target_page_id,
    pageContext,
  });

  if (!regeneratedPlan) {
    return {
      ok: false,
      errorCode: 'no_primary_candidate',
      message: '対象ページのPrimary候補となるTaskが現在存在しないため再計算できません',
      pagePlanId: planId,
      currentStatus: plan.status,
      staleReason: staleness.reason,
      saved: false,
    };
  }

  const changes = comparePagePlanChanges(plan, regeneratedPlan);

  const base = {
    ok: true,
    pagePlanId: planId,
    currentStatus: plan.status,
    stale: true,
    staleReason: staleness.reason,
    previousContentHash: staleness.previousContentHash,
    currentContentHash: staleness.currentContentHash,
    currentPlan: plan,
    regeneratedPlan,
    changes,
  };

  if (!save) {
    return { ...base, saved: false };
  }

  const staleMetadata = {
    previousContentHash: staleness.previousContentHash,
    currentContentHash: staleness.currentContentHash,
    staleReason: staleness.reason,
  };

  const saveResult = seoDb.regenerateStaleSeoPagePlan(
    {
      pagePlanId: planId,
      expectedCurrentStatus: expectedStatus,
      expectedUpdatedAt: plan.updated_at,
      actor,
      reason,
      staleMetadata,
      regeneratedPlan,
    },
    stamp
  );

  return { ...base, saved: true, saveResult };
}

function formatText(result) {
  const lines = [
    `ok: ${result.ok}`,
    `pagePlanId: ${result.pagePlanId ?? '-'}`,
    `currentStatus: ${result.currentStatus ?? '-'}`,
    `stale: ${result.stale}`,
    `saved: ${result.saved}`,
  ];
  if (result.errorCode) lines.push(`errorCode: ${result.errorCode}`, `message: ${result.message}`);
  if (result.message && !result.errorCode) lines.push(`message: ${result.message}`);
  if (result.staleReason) lines.push(`staleReason: ${result.staleReason}`);
  if (result.previousContentHash !== undefined) lines.push(`previousContentHash: ${result.previousContentHash}`);
  if (result.currentContentHash !== undefined) lines.push(`currentContentHash: ${result.currentContentHash}`);
  if (result.changes) lines.push(`changes: ${JSON.stringify(result.changes)}`);
  if (result.saveResult) lines.push(`saveResult.finalStatus: ${result.saveResult.finalStatus}`, `saveResult.reviews: ${JSON.stringify(result.saveResult.reviews.map((r) => ({ from: r.from_status, to: r.to_status })))}`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_page_plan_regenerate] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  if (args.dryRun && args.save) {
    console.error('[seo_page_plan_regenerate] --dry-runと--saveは同時に指定できません');
    process.exit(1);
  }
  if (!args.planId || Number.isNaN(args.planId) || !args.expectedStatus || !args.actor || !args.reason) {
    console.error(
      '使い方: node scripts/seo_page_plan_regenerate.js --plan-id=<id> --expected-status=<status> --actor=<name> --reason=<text> [--dry-run|--save] [--format=json|text] [--output=<path>]'
    );
    process.exit(1);
  }

  const save = args.save === true; // どちらも未指定の場合は安全側でdry-run(save=false)

  const result = await resolveStalePagePlanRegenerate({
    planId: args.planId,
    expectedStatus: args.expectedStatus,
    actor: args.actor,
    reason: args.reason,
    save,
  });

  const output = args.format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_page_plan_regenerate] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }

  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_page_plan_regenerate] 予期しないエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, resolveStalePagePlanRegenerate, formatText, parseArgs };
