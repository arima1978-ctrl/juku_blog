'use strict';

// 週次SEOダイジェスト(2026-07-29)。月曜07:30の専用cronで、直近のスナップショット
// (対象週は常に「先週=完全な週」。seo_weekly_analysis.shが日曜01:00に記録する)を
// 簡潔にTelegram通知する。異常時のみのバッチ監視アラート(🚨)とは完全に別枠とし、
// 平常時も毎週必ず届く定期便として区別する(📊)。30秒で読める長さを維持することが
// 絶対条件のため、フルレポート(node scripts/seo_metrics_report.js)への誘導のみ添える。
//
// 将来の拡張予約(2026-07-29ユーザー指示): キーワード順位データが十分に蓄積されたら
// (9月頃想定)、「順位が動いたキーワード上位3件(キーワード名と順位変動のみ)」の
// 1ブロックを追加すること。buildBranchReport()が返すkeywords配列(avgPosition等)と、
// 前週のseo_metrics_keyword_snapshotsを突き合わせれば順位差分を計算できる
// (現時点はキーワード単位の実績がまだ薄く、追加しても意味のある情報にならないため未実装)。
//
// 使い方: node scripts/seo_metrics_digest.js [--branch-id=<id>] [--dry-run]

const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .envが無い場合はスキップ
}

const { listBranches } = require('./lib/branches_db');
const { buildBranchReport, buildCategoryReport } = require('./seo_metrics_report');
const { sendTelegram } = require('./lib/telegram');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    branchId: get('--branch-id=') !== undefined ? Number(get('--branch-id=')) : undefined,
    dryRun: has('--dry-run'),
  };
}

function changeStr(pct) {
  if (pct == null) return '';
  const sign = pct >= 0 ? '+' : '';
  return `(前週比${sign}${pct.toFixed(0)}%)`;
}

// 1校舎ぶんは1〜2行に収める(30秒で読める長さを維持するための制約)。校舎に帰属する
// 実績(ブログ+校舎ページ)のみを使い、サイト共通の「その他」は含めない
// (2026-07-29ユーザー指示: 校舎別の見出しは校舎に帰属する数字だけにする)。
function formatDigestBlock(r) {
  if (!r.hasData) return null;
  const rateStr = r.gapFulfillment.total > 0 ? `${(r.gapFulfillment.rate * 100).toFixed(0)}%` : 'N/A';
  const increment = r.taskCounts.implementedWeekIncrement;
  const incrementStr = increment == null ? '-' : `${increment}件`;
  const a = r.buckets.attributed;
  return (
    `【${r.branchName}】${a.impressions.toLocaleString()}回/${a.clicks}クリック${changeStr(a.impressionsChangePct)}` +
    `(内訳: ブログ${r.buckets.blog.impressions}・校舎ページ${r.buckets.schoolPage.impressions}) / ` +
    `充足率${rateStr}(${r.gapFulfillment.fulfilled}/${r.gapFulfillment.total}) / 実施${incrementStr}`
  );
}

// naraigotoReport: buildCategoryReport('naraigoto')の結果。hasData=falseまたは未指定ならnull
// を返し、行自体を出さない(習い事スナップショットがまだ無い間は静かにスキップする)。
function formatCategoryLine(naraigotoReport) {
  if (!naraigotoReport || !naraigotoReport.hasData) return null;
  return `🎨 習い事: ${naraigotoReport.impressions.toLocaleString()}回/${naraigotoReport.clicks}クリック${changeStr(naraigotoReport.impressionsChangePct)}`;
}

// reports: buildBranchReport()の結果配列。1件もhasDataが無ければnullを返す
// (無意味な「データなし」通知を送らないため)。サイト共通の「その他」を含む
// サイト全体の数字は校舎ごとに繰り返さず、独立した1行として1回だけ表示する
// (2026-07-29ユーザー指示)。習い事カテゴリの行も同じ原則で独立した1行のみ。
function formatDigest(reports, naraigotoReport) {
  const blocks = reports.map(formatDigestBlock).filter(Boolean);
  if (blocks.length === 0) return null;
  const withData = reports.find((r) => r.hasData);
  const weekLabel = withData.latestWeek;
  const t = withData.buckets.total;
  const siteLine = `🌐 サイト全体: ${t.impressions.toLocaleString()}回/${t.clicks}クリック${changeStr(t.impressionsChangePct)}`;
  const categoryLine = formatCategoryLine(naraigotoReport);
  const headLines = categoryLine ? [siteLine, categoryLine] : [siteLine];
  return [`📊 週次SEOダイジェスト(${weekLabel.weekStart}〜${weekLabel.weekEnd}週)`, ...headLines, ...blocks, '', '詳細: node scripts/seo_metrics_report.js'].join('\n');
}

async function main() {
  const { branchId, dryRun } = parseArgs(process.argv.slice(2));
  const allBranches = listBranches();
  const targetBranches = branchId ? allBranches.filter((b) => b.id === branchId) : allBranches;
  const reports = targetBranches.map(buildBranchReport);
  const naraigotoReport = buildCategoryReport('naraigoto');

  const text = formatDigest(reports, naraigotoReport);
  if (!text) {
    console.log('[seo_metrics_digest] スナップショットがまだ無いため、通知をスキップしました');
    return;
  }

  console.log(text);
  if (dryRun) {
    console.log('[seo_metrics_digest] --dry-runのため送信しません');
    return;
  }
  await sendTelegram(text);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, changeStr, formatDigestBlock, formatCategoryLine, formatDigest, main };
