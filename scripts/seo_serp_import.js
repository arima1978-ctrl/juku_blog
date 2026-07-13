'use strict';

// 検索順位CSVを取り込み、seo_serp_rankingsへupsertする。
// Google検索結果ページを直接取得するProviderは使わない(CSV取込・手動登録のみ)。
//
// 使い方: node scripts/seo_serp_import.js <csvファイルパス> [--dry-run]

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { CsvSerpProvider } = require('./lib/seo/serp_provider');

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvArg = args.find((a) => !a.startsWith('--'));

  if (!csvArg) {
    console.error('使い方: node scripts/seo_serp_import.js <csvファイルパス> [--dry-run]');
    process.exit(1);
  }

  const filePath = path.isAbsolute(csvArg) ? csvArg : path.join(ROOT, csvArg);
  if (!fs.existsSync(filePath)) {
    console.error(`[seo_serp_import] ファイルが見つかりません: ${filePath}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(filePath, 'utf8');
  const provider = new CsvSerpProvider();
  const { rows, errors, totalRows } = provider.parse(csvText, path.basename(filePath));

  const nowIso = new Date().toISOString();

  if (!dryRun) {
    rows.forEach((row) => seoDb.upsertSerpRanking(row, nowIso));
  }

  const summary = {
    job_type: 'serp',
    source_file: path.basename(filePath),
    status: 'completed',
    rows_total: totalRows,
    rows_imported: dryRun ? 0 : rows.length,
    rows_updated: 0,
    rows_skipped: 0,
    rows_error: errors.length,
    dry_run: dryRun,
    started_at: nowIso,
    finished_at: new Date().toISOString(),
  };

  if (!dryRun) seoDb.insertImportJob(summary, nowIso);

  console.log(
    `[seo_serp_import] 完了(dry-run=${dryRun}): 対象${totalRows}件 取込${summary.rows_imported}件 エラー${errors.length}件`
  );
  errors.forEach((e) => console.log(`  - 行${e.rowIndex + 2}: ${e.reason}`));
}

if (require.main === module) {
  main();
}

module.exports = { main };
