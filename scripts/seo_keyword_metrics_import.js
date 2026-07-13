'use strict';

// キーワードプランナー等のCSVを取り込み、seo_keyword_metricsへupsertする。
// Google Ads APIへの接続はしない(無料MVPはCSV取込のみ)。
//
// 使い方: node scripts/seo_keyword_metrics_import.js <csvファイルパス> [--dry-run]

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { CsvKeywordMetricsProvider } = require('./lib/seo/keyword_metrics_provider');

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvArg = args.find((a) => !a.startsWith('--'));

  if (!csvArg) {
    console.error('使い方: node scripts/seo_keyword_metrics_import.js <csvファイルパス> [--dry-run]');
    process.exit(1);
  }

  const filePath = path.isAbsolute(csvArg) ? csvArg : path.join(ROOT, csvArg);
  if (!fs.existsSync(filePath)) {
    console.error(`[seo_keyword_metrics_import] ファイルが見つかりません: ${filePath}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(filePath, 'utf8');
  const provider = new CsvKeywordMetricsProvider();
  const { rows, errors, totalRows } = provider.parse(csvText, path.basename(filePath));

  const nowIso = new Date().toISOString();
  const startedAt = nowIso;

  if (!dryRun) {
    rows.forEach((row) => seoDb.upsertKeywordMetric(row, nowIso));
  }

  const summary = {
    job_type: 'keyword_metrics',
    source_file: path.basename(filePath),
    status: 'completed',
    rows_total: totalRows,
    rows_imported: dryRun ? 0 : rows.length,
    rows_updated: 0,
    rows_skipped: 0,
    rows_error: errors.length,
    dry_run: dryRun,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  };

  if (!dryRun) seoDb.insertImportJob(summary, nowIso);

  console.log(
    `[seo_keyword_metrics_import] 完了(dry-run=${dryRun}): 対象${totalRows}件 取込${summary.rows_imported}件 エラー${errors.length}件`
  );
  errors.forEach((e) => console.log(`  - 行${e.rowIndex + 2}: ${e.reason}`));
}

if (require.main === module) {
  main();
}

module.exports = { main };
