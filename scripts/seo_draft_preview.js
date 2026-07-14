'use strict';

// AI改善ドラフト用Promptのプレビュー表示(CLI)。実際の生成は行わない。
// LLM API(OpenAI/Gemini/Claude等)・Claude subagent・外部サイト・WordPressへは一切接続せず、
// DBへの書き込み(INSERT/UPDATE/DELETE)も行わない、決定的な読み取り専用コマンド。
//
// 使い方:
//   node scripts/seo_draft_preview.js --task-id=61
//   node scripts/seo_draft_preview.js --task-id=61 --format=json
//   node scripts/seo_draft_preview.js --task-id=61 --format=json --output=data/reports/draft_preview_61.json

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { buildDraftPreview } = require('./lib/seo/draft_generator');

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  const taskIdRaw = get('--task-id=');
  return {
    taskId: taskIdRaw !== undefined ? Number(taskIdRaw) : undefined,
    format: get('--format=') || 'text',
    output: get('--output='),
  };
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。
// Task未存在時はErrorを投げる(呼び出し元CLIがcatchしてプロセスを異常終了させる)。
// 登録済み校舎ページの本文取得を伴うためasync。
async function resolveDraftPreview(taskId) {
  const task = seoDb.getTaskById(taskId);
  if (!task) {
    throw new Error(`task id=${taskId} が見つかりません`);
  }
  const candidate = task.source_candidate_id ? seoDb.getKeywordCandidateById(task.source_candidate_id) : null;
  const gscMetrics = seoDb.getGscAggregateForKeyword(task.target_keyword);
  return buildDraftPreview({ task, candidate, gscMetrics });
}

function formatText(preview) {
  return [
    `task_id: ${preview.task_id}`,
    `task_type: ${preview.task_type}`,
    `target_keyword: ${preview.target_keyword}`,
    `target_url: ${preview.target_url || '-'}`,
    `target_page_name: ${preview.target_page_name || '-'}`,
    `gap_type: ${preview.gap_type || '-'}`,
    `opportunity_score: ${preview.opportunity_score}`,
    `data_confidence: ${preview.data_confidence ?? '-'}`,
    `gsc_metrics: ${preview.gsc_metrics ? JSON.stringify(preview.gsc_metrics) : '-'}`,
    `page_context_status: ${preview.page_context_status}`,
    `prompt_version: ${preview.prompt_version}(mode=${preview.prompt_mode})`,
    '',
    '--- prompt ---',
    preview.prompt,
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_draft_preview] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  if (!args.taskId || Number.isNaN(args.taskId)) {
    console.error('使い方: node scripts/seo_draft_preview.js --task-id=<id> [--format=json|text] [--output=<path>]');
    process.exit(1);
  }

  let preview;
  try {
    preview = await resolveDraftPreview(args.taskId);
  } catch (err) {
    console.error(`[seo_draft_preview] ${err.message}`);
    process.exit(1);
  }

  const output = args.format === 'json' ? JSON.stringify(preview, null, 2) : formatText(preview);

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_draft_preview] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_draft_preview] 予期しないエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, formatText, resolveDraftPreview };
