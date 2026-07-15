'use strict';

// Sprint 3.5: Page Plan(seo_page_plans)の人間レビュー状態遷移をCLIから行う。
// 既定でdry-run(DB非更新)。`--save`明示時のみ、scripts/lib/seo_db.jsの
// transitionSeoPagePlanStatus()経由でDBへ反映する(status更新+レビュー履歴INSERTは
// 同一トランザクション)。Draft生成・Claude subagent・LLM API・WordPress・GSC同期・
// Task status変更は一切行わない。
//
// 使い方:
//   node scripts/seo_page_plan_review.js --plan-id=1 --expected-status=proposed \
//     --next-status=reviewing --actor=admin --reason="内容確認を開始" --dry-run
//   node scripts/seo_page_plan_review.js --plan-id=1 --expected-status=proposed \
//     --next-status=reviewing --actor=admin --reason="内容確認を開始" --save

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { validatePagePlanTransition } = require('./lib/seo/page_plan_review');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    planId: get('--plan-id=') !== undefined ? Number(get('--plan-id=')) : undefined,
    expectedStatus: get('--expected-status='),
    nextStatus: get('--next-status='),
    actor: get('--actor='),
    reason: get('--reason='),
    dryRun: has('--dry-run'),
    save: has('--save'),
    format: get('--format=') || 'text',
    output: get('--output='),
  };
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。
// save=falseの場合はDBへ一切書き込まない(status・レビュー履歴とも不変)。
function resolvePagePlanReview({ planId, expectedStatus, nextStatus, actor, reason, save = false, nowIso } = {}) {
  const stamp = nowIso || new Date().toISOString();
  const plan = seoDb.getSeoPagePlanById(planId);

  if (!plan) {
    return { ok: false, errorCode: 'not_found', message: `page plan id=${planId} が見つかりません` };
  }

  // dry-runでも実際に検証結果を提示するため、DB上の現在statusを使ってバリデーションする
  // (expectedStatusとの不一致自体もdry-runの時点で分かるようにする)。
  const validation = validatePagePlanTransition({ currentStatus: plan.status, nextStatus, actor, reason });

  const conflict = plan.status !== expectedStatus;

  const base = {
    ok: false,
    planId,
    currentStatus: plan.status,
    expectedStatus,
    nextStatus,
    conflict,
    validation,
    saved: false,
    review: null,
  };

  if (conflict) {
    return { ...base, errorCode: 'page_plan_status_conflict', message: `期待したstatus(${expectedStatus})と実際のstatus(${plan.status})が一致しません` };
  }
  if (!validation.valid) {
    return { ...base, errorCode: 'invalid_transition', message: validation.errors.join(' / ') };
  }

  if (!save) {
    return { ...base, ok: true };
  }

  const result = seoDb.transitionSeoPagePlanStatus(
    { pagePlanId: planId, expectedCurrentStatus: expectedStatus, nextStatus, actor, reason, source: 'cli' },
    stamp
  );
  return { ...base, ok: true, saved: true, review: result.review };
}

function formatText(result) {
  const lines = [
    `planId: ${result.planId}`,
    `currentStatus: ${result.currentStatus ?? '-'}`,
    `expectedStatus: ${result.expectedStatus}`,
    `nextStatus: ${result.nextStatus}`,
    `conflict: ${result.conflict}`,
    `valid: ${result.validation ? result.validation.valid : '-'}`,
    `saved: ${result.saved}`,
    `ok: ${result.ok}`,
  ];
  if (result.errorCode) lines.push(`errorCode: ${result.errorCode}`, `message: ${result.message}`);
  if (result.validation && result.validation.errors.length > 0) lines.push(`errors: ${JSON.stringify(result.validation.errors)}`);
  if (result.review) lines.push(`review: ${JSON.stringify({ id: result.review.id, from_status: result.review.from_status, to_status: result.review.to_status })}`);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_page_plan_review] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  if (args.dryRun && args.save) {
    console.error('[seo_page_plan_review] --dry-runと--saveは同時に指定できません');
    process.exit(1);
  }
  if (!args.planId || Number.isNaN(args.planId)) {
    console.error('使い方: node scripts/seo_page_plan_review.js --plan-id=<id> --expected-status=<status> --next-status=<status> --actor=<name> [--reason=<text>] [--dry-run|--save] [--format=json|text] [--output=<path>]');
    process.exit(1);
  }

  const save = args.save === true; // どちらも未指定の場合は安全側でdry-run(save=false)

  const result = resolvePagePlanReview({
    planId: args.planId,
    expectedStatus: args.expectedStatus,
    nextStatus: args.nextStatus,
    actor: args.actor,
    reason: args.reason,
    save,
  });

  const output = args.format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_page_plan_review] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }

  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { main, resolvePagePlanReview, formatText, parseArgs };
