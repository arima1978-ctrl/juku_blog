'use strict';

// Sprint 3.6: 統合Draft(Claude Code subagent等が生成したresult.json)を検証した上で、
// 既定ではdry-run表示のみ行い(DB保存なし)、--save明示時のみseo_page_draftsへINSERTする。
// このCLI自体はClaude Code subagentを起動しない(Prompt生成はseo_page_draft_preview.js、
// subagent実行は別プロセスとして手動/別コマンドで行い、その結果ファイルをこのCLIへ渡す設計)。
//
// 使い方:
//   node scripts/seo_page_draft_generate.js \
//     --plan-id=1 \
//     --prompt-file=data/seo_drafts/page_plan_1.prompt.json \
//     --result-file=data/seo_drafts/page_plan_1.result.json \
//     --dry-run --format=json
//
//   node scripts/seo_page_draft_generate.js \
//     --plan-id=1 \
//     --prompt-file=data/seo_drafts/page_plan_1.prompt.json \
//     --result-file=data/seo_drafts/page_plan_1.result.json \
//     --save --format=json

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { buildPageDraft } = require('./lib/seo/page_draft_builder');
const { buildValidationOptions } = require('./seo_page_draft_verify');
const { validatePageDraftResponse } = require('./lib/seo/page_draft_response_validator');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    planId: get('--plan-id=') !== undefined ? Number(get('--plan-id=')) : undefined,
    promptFile: get('--prompt-file='),
    resultFile: get('--result-file='),
    dryRun: has('--dry-run'),
    save: has('--save'),
    format: get('--format=') || 'text',
    output: get('--output='),
  };
}

function readJsonFile(absPath, label) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(absPath, 'utf8')) };
  } catch (err) {
    return { ok: false, errorCode: `${label}_read_failed`, message: err.message };
  }
}

// insertSeoPageDraft内部と同じ判定をdry-runでも表示できるよう、事前チェックのみ複製する
// (実際の保存可否の最終判断は常にinsertSeoPageDraft自身が行う。ここはCLI表示用)。
function checkSaveEligibility(plan, draft) {
  if (!plan) return { ok: false, errorCode: 'not_found' };
  if (plan.status !== 'approved') return { ok: false, errorCode: 'page_plan_not_approved', actualStatus: plan.status };
  if (plan.updated_at !== draft.pagePlanUpdatedAt) return { ok: false, errorCode: 'page_plan_changed_during_generation' };
  if ((plan.source_content_hash || null) !== (draft.sourceContentHash || null)) return { ok: false, errorCode: 'page_plan_content_stale' };
  return { ok: true };
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。
// save=falseの場合はDBへ一切書き込まない(insertSeoPageDraftを呼ばない)。
function resolveDraftGenerate({ planId, promptFilePath, resultFilePath, save = false, nowIso } = {}) {
  const promptFileResult = readJsonFile(promptFilePath, 'prompt_file');
  if (!promptFileResult.ok) return { ok: false, ...promptFileResult };
  const promptFile = promptFileResult.value;

  const resultFileResult = readJsonFile(resultFilePath, 'result_file');
  if (!resultFileResult.ok) return { ok: false, ...resultFileResult };
  const response = resultFileResult.value;

  const plan = seoDb.getSeoPagePlanById(planId);
  if (!plan) return { ok: false, errorCode: 'not_found', message: `page plan id=${planId} が見つかりません` };

  const validationResult = validatePageDraftResponse(response, buildValidationOptions(plan));
  if (!validationResult.valid) {
    return { ok: false, errorCode: 'invalid_draft', validationResult };
  }

  const draftVersion = seoDb.getNextSeoPageDraftVersion(planId);
  const draft = buildPageDraft({
    pagePlan: { id: planId, updated_at: promptFile.inputSummary ? promptFile.inputSummary.pagePlanUpdatedAt : plan.updated_at },
    prompt: promptFile.prompt,
    promptVersion: promptFile.promptVersion,
    response,
    validationResult,
    generator: 'claude-code-subagent',
    model: 'sonnet',
    pageContext: { status: 'fetched', contentHash: promptFile.inputSummary ? promptFile.inputSummary.sourceContentHash : null },
    draftVersion,
  });

  const eligibility = checkSaveEligibility(plan, draft);
  if (!eligibility.ok) {
    return { ok: false, ...eligibility, draft, validationResult };
  }

  if (!save) {
    return { ok: true, saved: false, draft, validationResult, draftVersion };
  }

  const stamp = nowIso || new Date().toISOString();
  const saveResult = seoDb.insertSeoPageDraft(draft, stamp);
  return { ok: true, saved: true, draft, validationResult, draftVersion, saveResult };
}

function formatText(result) {
  if (!result.ok) {
    return [`ok: false`, `errorCode: ${result.errorCode}`, result.message ? `message: ${result.message}` : ''].filter(Boolean).join('\n');
  }
  return [
    `ok: true`,
    `saved: ${result.saved}`,
    `draftVersion: ${result.draftVersion}`,
    `validation.valid: ${result.validationResult.valid}`,
    result.saveResult ? `saveResult.id: ${result.saveResult.id}` : '',
  ].filter(Boolean).join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_page_draft_generate] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }
  if (args.dryRun && args.save) {
    console.error('[seo_page_draft_generate] --dry-runと--saveは同時に指定できません');
    process.exit(1);
  }
  if (!args.planId || Number.isNaN(args.planId) || !args.promptFile || !args.resultFile) {
    console.error('使い方: node scripts/seo_page_draft_generate.js --plan-id=<id> --prompt-file=<path> --result-file=<path> [--dry-run|--save] [--format=json|text] [--output=<path>]');
    process.exit(1);
  }

  const save = args.save === true; // どちらも未指定の場合は安全側でdry-run(save=false)
  const promptFilePath = path.isAbsolute(args.promptFile) ? args.promptFile : path.join(ROOT, args.promptFile);
  const resultFilePath = path.isAbsolute(args.resultFile) ? args.resultFile : path.join(ROOT, args.resultFile);

  const result = resolveDraftGenerate({ planId: args.planId, promptFilePath, resultFilePath, save });
  const output = args.format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_page_draft_generate] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }

  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_page_draft_generate] 予期しないエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, resolveDraftGenerate, checkSaveEligibility, formatText, parseArgs };
