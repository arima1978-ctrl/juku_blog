'use strict';

// Sprint 3.6: 統合Draft(result.json)を、対象Page PlanのTask構成と照合して検証するCLI。
// DB書き込みは一切行わない(Page Plan読み取りのみ)。外部通信・LLM・WordPressも行わない。
//
// 使い方:
//   node scripts/seo_page_draft_verify.js --input=data/seo_drafts/page_plan_1.result.json --plan-id=1 --format=json

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { validatePageDraftResponse } = require('./lib/seo/page_draft_response_validator');

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    input: get('--input='),
    planId: get('--plan-id=') !== undefined ? Number(get('--plan-id=')) : undefined,
    format: get('--format=') || 'text',
    output: get('--output='),
  };
}

// Page PlanのTask構成(Primary/Supporting/Excluded)からValidatorオプションを組み立てる。
// Page PlanのsupportingTaskIdsは既にSupporting Fact Checkでverified済みのみを含む設計だが、
// 念のためfactCheckSummaryと突き合わせてunverifiedSupportingTaskIdsも算出しておく
// (通常は常に空配列になる)。
function buildValidationOptions(plan) {
  const verifiedIds = new Set(
    (plan.fact_check_summary && Array.isArray(plan.fact_check_summary.verified) ? plan.fact_check_summary.verified : []).map((v) => v.taskId)
  );
  const supportingTaskIds = plan.supporting_task_ids || [];
  const unverifiedSupportingTaskIds = supportingTaskIds.filter((id) => !verifiedIds.has(id));
  const excludedTasks = plan.excluded_tasks || [];

  return {
    primaryTaskId: plan.primary_task_id,
    supportingTaskIds,
    excludedTaskIds: excludedTasks.map((e) => e.taskId),
    unverifiedSupportingTaskIds,
    excludedKeywords: excludedTasks.map((e) => e.targetKeyword),
  };
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。DB書き込みなし。
function resolveDraftVerify({ inputPath, planId }) {
  const plan = seoDb.getSeoPagePlanById(planId);
  if (!plan) {
    return { valid: false, errors: [`page plan id=${planId} が見つかりません`], warnings: [], normalizedResponse: null };
  }

  let response;
  try {
    response = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (err) {
    return { valid: false, errors: [`inputファイルの読み込み/JSON parseに失敗しました: ${err.message}`], warnings: [], normalizedResponse: null };
  }

  return validatePageDraftResponse(response, buildValidationOptions(plan));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_page_draft_verify] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }
  if (!args.input || !args.planId || Number.isNaN(args.planId)) {
    console.error('使い方: node scripts/seo_page_draft_verify.js --input=<result.json> --plan-id=<id> [--format=json|text] [--output=<path>]');
    process.exit(1);
  }

  const inputPath = path.isAbsolute(args.input) ? args.input : path.join(ROOT, args.input);
  const result = resolveDraftVerify({ inputPath, planId: args.planId });
  const output = args.format === 'json' ? JSON.stringify(result, null, 2) : `valid: ${result.valid}\nerrors: ${JSON.stringify(result.errors)}\nwarnings: ${JSON.stringify(result.warnings)}`;

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_page_draft_verify] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }

  process.exit(result.valid ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { main, resolveDraftVerify, buildValidationOptions, parseArgs };
