'use strict';

// SEO効果測定レポート(2026-07-29)。記録済みの週次スナップショットから、両校舎の
// 直近サマリー(4区分表示回数/クリック・キーワード別順位・ギャップ充足率・前週比)を
// 人が読める形で表示する読み取り専用CLI(DB書き込みなし)。
// 「レポート見せて」で毎回これを実行すれば最新状態を確認できる。
//
// 使い方:
//   node scripts/seo_metrics_report.js [--branch-id=<id>] [--format=text|json]

const { listBranches } = require('./lib/branches_db');
const seoDb = require('./lib/seo_db');

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    branchId: get('--branch-id=') !== undefined ? Number(get('--branch-id=')) : undefined,
    format: get('--format=') || 'text',
  };
}

// 前週比(%)。前週の値が無い/0の場合は算出不能としてnullを返す。
function pctChange(current, previous) {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function bucketReport(latest, previous, prefix) {
  const impressions = latest[`impressions_${prefix}`];
  const clicks = latest[`clicks_${prefix}`];
  return {
    impressions,
    clicks,
    impressionsChangePct: previous ? pctChange(impressions, previous[`impressions_${prefix}`]) : null,
    clicksChangePct: previous ? pctChange(clicks, previous[`clicks_${prefix}`]) : null,
  };
}

// 校舎に帰属する実績(ブログ+校舎ページ)のみを合算する。「その他」(サイト共通の
// トップページ・brand・LP等)は校舎の数字に混ぜない(2026-07-29ユーザー指示)。
function attributedBucketReport(latest, previous) {
  const impressions = latest.impressions_blog + latest.impressions_school_page;
  const clicks = latest.clicks_blog + latest.clicks_school_page;
  const previousImpressions = previous ? previous.impressions_blog + previous.impressions_school_page : null;
  const previousClicks = previous ? previous.clicks_blog + previous.clicks_school_page : null;
  return {
    impressions,
    clicks,
    impressionsChangePct: previous ? pctChange(impressions, previousImpressions) : null,
    clicksChangePct: previous ? pctChange(clicks, previousClicks) : null,
  };
}

function buildBranchReport(branch) {
  const snapshots = seoDb.listSeoMetricsSnapshots(branch.id); // week_start昇順
  if (snapshots.length === 0) {
    return { branchId: branch.id, branchName: branch.name, hasData: false };
  }
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;

  const keywords = seoDb
    .listSeoMetricsKeywordSnapshots(branch.id)
    .filter((k) => k.week_start === latest.week_start)
    .map((k) => ({
      keyword: k.normalized_keyword,
      avgPosition: k.avg_position,
      impressions: k.impressions,
      clicks: k.clicks,
      implemented: !!k.is_implemented_as_of_week,
    }))
    .sort((a, b) => {
      if (a.avgPosition == null) return 1;
      if (b.avgPosition == null) return -1;
      return a.avgPosition - b.avgPosition;
    });

  return {
    branchId: branch.id,
    branchName: branch.name,
    hasData: true,
    latestWeek: { weekStart: latest.week_start, weekEnd: latest.week_end },
    previousWeek: previous ? { weekStart: previous.week_start } : null,
    buckets: {
      blog: bucketReport(latest, previous, 'blog'),
      schoolPage: bucketReport(latest, previous, 'school_page'),
      other: bucketReport(latest, previous, 'other'),
      total: bucketReport(latest, previous, 'total'),
      // 校舎に帰属する実績(ブログ+校舎ページ)のみの合算。サイト共通の「その他」は含めない
      // (2026-07-29ユーザー指示: 校舎別の見出しは校舎に帰属する数字だけにする)
      attributed: attributedBucketReport(latest, previous),
    },
    gapFulfillment: {
      rate: latest.gap_fulfillment_rate,
      fulfilled: latest.gap_fulfilled_count,
      total: latest.gap_total_count,
      previousRate: previous ? previous.gap_fulfillment_rate : null,
    },
    taskCounts: {
      proposed: latest.task_count_proposed,
      approved: latest.task_count_approved,
      rejected: latest.task_count_rejected,
      reviewing: latest.task_count_reviewing,
      implemented: latest.task_count_implemented,
      // 前週からの増分(週次ダイジェストの「今週実施済みにした件数」用、2026-07-29追加)。
      // 前週データが無ければ算出不能としてnull。
      implementedWeekIncrement: previous ? latest.task_count_implemented - previous.task_count_implemented : null,
    },
    publishedCountCumulative: latest.published_count_cumulative,
    keywords,
  };
}

function changeStr(pct) {
  if (pct == null) return '';
  const sign = pct >= 0 ? '+' : '';
  return ` (前週比${sign}${pct.toFixed(0)}%)`;
}

function formatBucketLine(label, bucket) {
  return `  ${label}: ${bucket.impressions}回 / ${bucket.clicks}クリック${changeStr(bucket.impressionsChangePct)}`;
}

function formatText(reports) {
  const lines = [];
  for (const r of reports) {
    if (!r.hasData) {
      lines.push(`\n=== ${r.branchName} ===`, 'スナップショットがまだありません');
      continue;
    }
    lines.push(`\n=== ${r.branchName}(${r.latestWeek.weekStart}〜${r.latestWeek.weekEnd}週)${r.previousWeek ? `  前週比較: ${r.previousWeek.weekStart}週` : '(前週データなし)'} ===`);
    lines.push('[表示回数/クリック]');
    lines.push(formatBucketLine('ブログ    ', r.buckets.blog));
    lines.push(formatBucketLine('校舎ページ ', r.buckets.schoolPage));
    lines.push(formatBucketLine('その他    ', r.buckets.other));
    lines.push(formatBucketLine('合計      ', r.buckets.total));
    lines.push(
      `[タスク進捗] proposed=${r.taskCounts.proposed} approved=${r.taskCounts.approved} rejected=${r.taskCounts.rejected} reviewing=${r.taskCounts.reviewing} implemented=${r.taskCounts.implemented}`
    );
    const rateStr = r.gapFulfillment.total > 0 ? `${(r.gapFulfillment.rate * 100).toFixed(1)}%` : 'N/A';
    const prevRateStr =
      r.gapFulfillment.previousRate != null ? `(前週${(r.gapFulfillment.previousRate * 100).toFixed(1)}%)` : '';
    lines.push(`[ギャップ充足率] ${rateStr} (${r.gapFulfillment.fulfilled}/${r.gapFulfillment.total}) ${prevRateStr}`);
    lines.push(`[公開記事累計] ${r.publishedCountCumulative}件`);
    if (r.keywords.length > 0) {
      lines.push('[キーワード別順位(今週)]');
      r.keywords.forEach((k) => {
        const pos = k.avgPosition != null ? k.avgPosition.toFixed(1) : '-';
        lines.push(`  ${k.keyword}: 順位${pos} / 表示${k.impressions}回 / クリック${k.clicks} ${k.implemented ? '✅実施済み' : ''}`);
      });
    }
  }
  return lines.join('\n');
}

function main() {
  const { branchId, format } = parseArgs(process.argv.slice(2));
  const allBranches = listBranches();
  const targetBranches = branchId ? allBranches.filter((b) => b.id === branchId) : allBranches;
  const reports = targetBranches.map(buildBranchReport);

  if (format === 'json') {
    console.log(JSON.stringify({ ok: true, reports }, null, 2));
  } else {
    console.log(formatText(reports));
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, pctChange, buildBranchReport, formatText, main };
