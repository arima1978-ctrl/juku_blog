'use strict';

// SEO効果測定 週次スナップショット(2026-07-27)。週次バッチ(seo_weekly_analysis.sh、
// Gap判定の後)の末尾で、対象週1週間ぶんの校舎合計(seo_metrics_snapshots)・キーワード別
// (seo_metrics_keyword_snapshots)実績をUPSERTする。既定dry-run、--save明示時のみ保存
// (既存のPage Plan/Page Draft系CLIと同じ安全設計)。
// features.competitor_keyword_analysis.enabled=false の間は無処理で終了する。
//
// 使い方:
//   node scripts/seo_metrics_snapshot_generate.js --week=2026-07-13 [--branch-id=1] --dry-run
//   node scripts/seo_metrics_snapshot_generate.js --week=2026-07-13 --save
//   node scripts/seo_metrics_snapshot_generate.js --week=2026-07-13 --baseline --save  # 導入前バックフィル用

const { loadJukuConfig } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { listBranches } = require('./lib/branches_db');
const { listEnabledSchoolPages } = require('./lib/seo/school_page_registry');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    week: get('--week='),
    branchId: get('--branch-id=') !== undefined ? Number(get('--branch-id=')) : undefined,
    baseline: has('--baseline'),
    dryRun: has('--dry-run'),
    save: has('--save'),
    format: get('--format=') || 'text',
  };
}

// week: 対象週の月曜日(YYYY-MM-DD)。週末(日曜)を返す。
function weekEndOf(weekStartStr) {
  const d = new Date(`${weekStartStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// allBranches(システム上の全校舎、--branch-id絞り込みの影響を受けない)から、
// GSC実績照合に必要な情報(校舎別の投稿ID一覧・校舎ページURL一覧)を組み立てる。
// 「その他」を正しく求めるには、出力対象に含まれない校舎の投稿も「その校舎のブログ」として
// 認識できていなければならない(さもないと他校舎の記事が誤って「その他」に混入する)。
function buildBranchUrlInfos(allBranches) {
  return allBranches.map((branch) => ({
    branchId: branch.id,
    postIds: seoDb.getPostWpIdsForBranch(branch.id),
    schoolPageUrls: listEnabledSchoolPages(branch.id).map((p) => p.url),
  }));
}

// 週次スナップショット生成1回につき1度だけ呼ぶ(全校舎ぶんをまとめて1回のGSCスキャンで
// 分解する。校舎ごとに個別実行すると「その他」の判定に他校舎の情報が使えず不正確になる)。
function computeGscAttribution({ weekStart, weekEnd, allBranches }) {
  const branches = buildBranchUrlInfos(allBranches);
  return seoDb.getGscAttributionInRange({ startDate: weekStart, endDate: weekEnd, branches });
}

function computeSnapshotForBranch({ branch, weekStart, weekEnd, isBaseline, gscAttribution }) {
  const counts = seoDb.getTaskStatusCounts(branch.id);
  // ギャップ充足率の分母定義(2026-07-27ユーザー承認): status='approved' かつ
  // task_type NOT IN ('monitor','exclude')。分子は同条件かつimplemented_at IS NOT NULL。
  // 生カウント(taskCount*)も別途保存するため、この定義自体は後から変更しても再計算できる。
  const { total: gapTotal, implemented: gapFulfilled } = seoDb.getApprovedActionableTaskCounts(branch.id);

  const branchGsc = gscAttribution.perBranch[branch.id] || { impressionsBlog: 0, clicksBlog: 0, impressionsSchoolPage: 0, clicksSchoolPage: 0 };
  const published = seoDb.getPublishedPostCounts(branch.id, { weekStart, weekEnd });

  return {
    branchId: branch.id,
    weekStart,
    weekEnd,
    // サイト全体の値(全校舎で同じ値になる。2026-07-29: impressionsOther/clicksOtherも同様)
    impressionsTotal: gscAttribution.impressionsTotal,
    clicksTotal: gscAttribution.clicksTotal,
    impressionsOther: gscAttribution.impressionsOther,
    clicksOther: gscAttribution.clicksOther,
    // この校舎のみの値(2026-07-29修正: 以前はimpressionsBlogがサイト全体の残差だった)
    impressionsSchoolPage: branchGsc.impressionsSchoolPage,
    clicksSchoolPage: branchGsc.clicksSchoolPage,
    impressionsBlog: branchGsc.impressionsBlog,
    clicksBlog: branchGsc.clicksBlog,
    taskCountTotal: counts.total,
    taskCountProposed: counts.proposed,
    taskCountApproved: counts.approved,
    taskCountRejected: counts.rejected,
    taskCountReviewing: counts.reviewing,
    taskCountMonitorExclude: counts.monitorExclude,
    taskCountImplemented: counts.implemented,
    gapFulfilledCount: gapFulfilled,
    gapTotalCount: gapTotal,
    gapFulfillmentRate: gapTotal > 0 ? gapFulfilled / gapTotal : null,
    publishedCountCumulative: published.cumulative,
    publishedCountWeek: published.week,
    isBaseline: !!isBaseline,
  };
}

// キーワード別スナップショット: 承認済み(却下除く)のTaskが対象とするキーワード群。
function computeKeywordSnapshotsForBranch({ branch, weekStart, weekEnd, isBaseline }) {
  const tasks = seoDb.listTasks({ branchId: branch.id }).filter((t) => t.status !== 'rejected');
  const seen = new Set();
  const rows = [];
  for (const task of tasks) {
    if (seen.has(task.target_keyword)) continue;
    seen.add(task.target_keyword);
    const gsc = seoDb.getGscAggregateForKeywordInRange(task.target_keyword, { startDate: weekStart, endDate: weekEnd });
    rows.push({
      branchId: branch.id,
      weekStart,
      weekEnd,
      candidateId: task.source_candidate_id || null,
      normalizedKeyword: task.target_keyword,
      sourceTaskId: task.id,
      avgPosition: gsc ? gsc.avgPosition : null,
      impressions: gsc ? gsc.impressions : 0,
      clicks: gsc ? gsc.clicks : 0,
      isImplementedAsOfWeek: !!(task.implemented_at && task.implemented_at <= `${weekEnd}T23:59:59.999Z`),
      isBaseline: !!isBaseline,
    });
  }
  return rows;
}

function main() {
  const { week, branchId, baseline, dryRun, save, format } = parseArgs(process.argv.slice(2));
  if (!week) {
    console.error('使い方: node scripts/seo_metrics_snapshot_generate.js --week=<YYYY-MM-DD 対象週の月曜> [--branch-id=<id>] [--baseline] [--dry-run|--save] [--format=json|text]');
    process.exitCode = 1;
    return;
  }

  const sharedConfig = loadJukuConfig();
  const feature = sharedConfig.features && sharedConfig.features.competitor_keyword_analysis;
  if (!feature || !feature.enabled) {
    console.log('[seo_metrics_snapshot_generate] competitor_keyword_analysis.enabled が false のため無処理で終了します');
    return;
  }

  const weekEnd = weekEndOf(week);
  // is_activeはダッシュボードが「今どの校舎を表示中か」を示すだけの可変なUIトグルであり、
  // 「この校舎を分析対象に含めるか」とは無関係(過去に他スクリプトで同じ誤用による実インシデントが
  // 複数回発生している)。既定では全校舎を対象にし、--branch-id指定時のみ絞り込む。
  const allBranches = listBranches();
  const targetBranches = branchId ? allBranches.filter((b) => b.id === branchId) : allBranches;

  // 「その他」を正しく求めるため、常に全校舎(allBranches)を対象にGSC分解を1回だけ行う
  // (--branch-id絞り込みは出力対象を絞るだけで、分類そのものには影響させない)。
  const gscAttribution = computeGscAttribution({ weekStart: week, weekEnd, allBranches });

  const results = targetBranches.map((branch) => {
    const snapshot = computeSnapshotForBranch({ branch, weekStart: week, weekEnd, isBaseline: baseline, gscAttribution });
    const keywordSnapshots = computeKeywordSnapshotsForBranch({ branch, weekStart: week, weekEnd, isBaseline: baseline });
    return { branch, snapshot, keywordSnapshots };
  });

  const shouldSave = save && !dryRun;
  if (shouldSave) {
    const nowIso = new Date().toISOString();
    for (const { snapshot, keywordSnapshots } of results) {
      seoDb.upsertSeoMetricsSnapshot(snapshot, nowIso);
      for (const kwRow of keywordSnapshots) {
        seoDb.upsertSeoMetricsKeywordSnapshot(kwRow, nowIso);
      }
    }
  }

  const output = results.map(({ branch, snapshot, keywordSnapshots }) => ({
    branchId: branch.id,
    branchName: branch.name,
    saved: shouldSave,
    snapshot,
    keywordCount: keywordSnapshots.length,
  }));

  if (format === 'json') {
    console.log(JSON.stringify({ ok: true, week, weekEnd, saved: shouldSave, results: output }, null, 2));
  } else {
    output.forEach((r) => {
      console.log(
        `[seo_metrics_snapshot_generate] branch=${r.branchId}(${r.branchName}) saved=${r.saved} impressions=${r.snapshot.impressionsTotal} gapFulfillment=${r.snapshot.gapFulfilledCount}/${r.snapshot.gapTotalCount} keywords=${r.keywordCount}`
      );
    });
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, weekEndOf, computeGscAttribution, computeSnapshotForBranch, computeKeywordSnapshotsForBranch, main };
