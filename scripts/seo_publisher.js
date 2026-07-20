'use strict';

// Sprint 4.1: AI Weekly Directorのstatus='approved'な週次バンドルのうち、
// create_article Taskをまだ投稿していないものを検知し、WordPressへ下書き
// (status:'draft')として自動投稿するCLI。
//
// 既存のDraft生成CLI群(seo_draft_preview.js/seo_page_draft_preview.js等)と同じ
// 4段階分離を維持する: (1)Prompt生成(seo_weekly_director.jsが既に実施済み)
// (2)LLM実行は人間が別途 `claude -p --agent <name> < *.prompt.json > *.result.json`
// を実行(このCLIはLLM API・Claude Code subagentを一切呼び出さない)
// (3)このCLIがresult.jsonを決定的に検証 (4)検証OKかつ--save時のみWordPressへ
// 投稿しDBへ書き戻す。
//
// スコープ: task_type='create_article'のみを対象とする(improve_school_page等は
// 既存ページの更新であり、WordPressへの「新規投稿」作成とは異なる操作のため、
// このCLIの対象外。将来Sprintで別途扱う)。
//
// 使い方:
//   node scripts/seo_publisher.js --dry-run
//   node scripts/seo_publisher.js --save
//   node scripts/seo_publisher.js --batch-date=2026-07-13 --dry-run

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const branchesDb = require('./lib/branches_db');
const wordpress = require('./lib/wordpress');
const { validatePublishResponse } = require('./lib/seo/publish_response_validator');

const PUBLISHABLE_TASK_TYPES = new Set(['create_article']);

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    batchDate: get('--batch-date='),
    dryRun: has('--dry-run'),
    save: has('--save'),
    format: get('--format=') || 'text',
  };
}

// Promptファイルと対になるresult.jsonの規約上のパスを返す(拡張子.prompt.jsonを
// .result.jsonへ置き換えるのみ、ファイルの実在有無はここでは判定しない)。
function resultFilePathFor(draftPromptPath) {
  if (!draftPromptPath) return null;
  if (!draftPromptPath.endsWith('.prompt.json')) return null;
  return draftPromptPath.slice(0, -'.prompt.json'.length) + '.result.json';
}

function readResultFile(resultPath) {
  if (!fs.existsSync(resultPath)) return { exists: false, parsed: null, parseError: null };
  try {
    return { exists: true, parsed: JSON.parse(fs.readFileSync(resultPath, 'utf8')), parseError: null };
  } catch (err) {
    return { exists: true, parsed: null, parseError: err.message };
  }
}

// 1件のTaskを処理する。DB書き込みはWordPress投稿が成功した場合のみ行う
// (一時的なエラーで失敗した場合はDBを一切変更しない。次回実行時に自動的に
// 再試行対象になる=失敗したTaskだけが取り残され、他のTaskの処理は妨げない)。
async function publishOneItem(item, batchDate, { seoDbImpl, wordpressImpl, nowIso, save, branchId }) {
  if (!PUBLISHABLE_TASK_TYPES.has(item.taskType)) {
    return { taskId: item.taskId, outcome: 'not_publishable_task_type' };
  }
  if (item.wpPostId) {
    return { taskId: item.taskId, outcome: 'already_published', wpPostId: item.wpPostId };
  }
  if (item.draftStatus !== 'prompt_generated') {
    return { taskId: item.taskId, outcome: 'draft_not_ready', draftStatus: item.draftStatus };
  }

  const resultPath = resultFilePathFor(item.draftPromptPath);
  if (!resultPath) {
    return { taskId: item.taskId, outcome: 'no_prompt_file' };
  }
  const absoluteResultPath = path.isAbsolute(resultPath) ? resultPath : path.join(ROOT, resultPath);
  const { exists, parsed, parseError } = readResultFile(absoluteResultPath);

  if (!exists) {
    return { taskId: item.taskId, outcome: 'awaiting_result', resultPath };
  }
  if (parseError) {
    return { taskId: item.taskId, outcome: 'invalid_result', errors: [`JSONとして解析できません: ${parseError}`] };
  }

  const validation = validatePublishResponse(parsed);
  if (!validation.valid) {
    return { taskId: item.taskId, outcome: 'invalid_result', errors: validation.errors };
  }
  if (parsed.can_generate === false) {
    return { taskId: item.taskId, outcome: 'generation_blocked', missingContext: parsed.missing_context };
  }

  if (!save) {
    return {
      taskId: item.taskId,
      outcome: 'ready_to_publish',
      title: parsed.title,
      bodyPreviewLength: parsed.body_html.length,
    };
  }

  try {
    const created = await wordpressImpl.createDraftPost({
      title: parsed.title,
      bodyHtml: parsed.body_html,
      metaDescription: parsed.meta_description,
      branchId,
    });

    const markResult = seoDbImpl.markWeeklyRecommendationItemPublished(
      batchDate,
      item.taskId,
      { wpPostId: created.wpPostId, draftStatus: 'published_draft', branchId },
      nowIso
    );
    if (markResult.skipped) {
      return { taskId: item.taskId, outcome: 'already_published', wpPostId: markResult.wpPostId };
    }
    return { taskId: item.taskId, outcome: 'published', wpPostId: created.wpPostId, link: created.link };
  } catch (err) {
    return { taskId: item.taskId, outcome: 'publish_failed', error: err.message };
  }
}

// Feature Flagチェックを含まない中核処理(テスト容易性のため分離)。
// save=falseの場合はWordPress投稿・DB書き込みを一切行わない(dry-run既定)。
async function resolvePublisher({
  batchDate,
  save = false,
  seoDbImpl = seoDb,
  branchesDbImpl = branchesDb,
  wordpressImpl = wordpress,
  nowIso = new Date().toISOString(),
} = {}) {
  // 複数校舎管理: config自体はフェーズ3対象外(校舎別に分離しない)ため、
  // legacy校舎(最も早く作成された校舎)の週次バンドルのみを対象にする。
  // 2026-07-20判明: getActiveBranch()(ダッシュボードの可変な表示校舎トグル)ではなく
  // getEarliestBranch()を使う(sync_draft_to_db.jsと同じ実インシデントの回帰防止)。
  const earliestBranch = branchesDbImpl.getEarliestBranch();
  const activeBranchId = earliestBranch ? earliestBranch.id : null;
  const rec = batchDate
    ? seoDbImpl.getWeeklyRecommendation(batchDate, activeBranchId)
    : seoDbImpl.getLatestApprovedWeeklyRecommendation(activeBranchId);

  if (!rec || rec.status !== 'approved') {
    return { batchDate: rec ? rec.batch_date : null, found: false, results: [], archived: false };
  }

  const results = [];
  for (const item of rec.items) {
    // eslint-disable-next-line no-await-in-loop
    const result = await publishOneItem(item, rec.batch_date, { seoDbImpl, wordpressImpl, nowIso, save, branchId: rec.branch_id });
    results.push(result);
  }

  const publishableItems = rec.items.filter((item) => PUBLISHABLE_TASK_TYPES.has(item.taskType));
  const allPublishableDone = publishableItems.every((item) => {
    const outcome = results.find((r) => r.taskId === item.taskId);
    return item.wpPostId || (outcome && (outcome.outcome === 'published' || outcome.outcome === 'already_published'));
  });

  let archived = false;
  if (save && allPublishableDone && publishableItems.length > 0) {
    seoDbImpl.transitionWeeklyRecommendationStatus(
      { batchDate: rec.batch_date, expectedCurrentStatus: 'approved', nextStatus: 'archived', branchId: rec.branch_id },
      nowIso
    );
    archived = true;
  }

  return { batchDate: rec.batch_date, found: true, results, archived };
}

function formatText(result) {
  if (!result.found) {
    return `対象の週次バンドル(status='approved')が見つかりませんでした(batchDate=${result.batchDate ?? '-'})`;
  }
  const lines = [`batchDate: ${result.batchDate}`, `archived: ${result.archived}`, '', '--- 処理結果 ---'];
  result.results.forEach((r) => {
    lines.push(`[task_id=${r.taskId}] ${r.outcome}${r.wpPostId ? ` (wp_post_id=${r.wpPostId})` : ''}${r.error ? ` error=${r.error}` : ''}`);
  });
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.growth_director;

  if (!feature || !feature.enabled) {
    console.log('[seo_publisher] growth_director.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  if (args.dryRun && args.save) {
    console.error('[seo_publisher] --dry-runと--saveは同時に指定できません');
    process.exit(1);
  }
  const save = args.save === true; // 未指定時は安全側でdry-run(save=false)

  const result = await resolvePublisher({ batchDate: args.batchDate, save });
  const output = args.format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);
  console.log(output);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_publisher] 予期しないエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, resolvePublisher, publishOneItem, resultFilePathFor, parseArgs, formatText };
