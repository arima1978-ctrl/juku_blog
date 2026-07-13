'use strict';

// Google Search Console実績の取得。features.competitor_keyword_analysis.enabled と
// .search_console_enabled が両方trueの場合のみ動作する。
// API失敗時は例外を外に投げず、log_error.jsに記録して正常終了する
// (記事生成・競合分析全体をSearch Consoleの障害で止めないため)。
// 認証情報(秘密鍵)は絶対にログへ出力しない。
//
// 使い方:
//   node scripts/seo_gsc_sync.js                        # 既定: 直近3日分(データ遅延を考慮)
//   node scripts/seo_gsc_sync.js --start=2026-07-01 --end=2026-07-07   # 任意期間の再取得(backfill)
//   node scripts/seo_gsc_sync.js --dry-run

const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .envが無い場合はスキップ(GSC連携は未設定として動作)
}

const { loadJukuConfig } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { GoogleSearchConsoleProvider, toGscQueryRow } = require('./lib/seo/search_console_provider');
const { logError } = require('./log_error');

const ROW_LIMIT = 1000;
const DEFAULT_LOOKBACK_DAYS = 3; // Search Consoleのデータ反映遅延を考慮

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return { start: get('--start='), end: get('--end='), dryRun: argv.includes('--dry-run') };
}

function defaultDateRange() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (DEFAULT_LOOKBACK_DAYS - 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function fetchAllRows(provider, params) {
  const allRows = [];
  let startRow = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { rows, dimensions } = await provider.querySearchAnalytics({ ...params, startRow, rowLimit: ROW_LIMIT });
    allRows.push(...rows.map((row) => ({ row, dimensions })));
    if (rows.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
  }
  return allRows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.competitor_keyword_analysis;

  if (!feature || !feature.enabled || !feature.search_console_enabled) {
    console.log('[seo_gsc_sync] competitor_keyword_analysis.enabled または search_console_enabled が false のため無処理で終了します');
    process.exit(0);
  }

  const siteProperty = process.env.GSC_PROPERTY_URL;
  if (!siteProperty) {
    console.log('[seo_gsc_sync] GSC_PROPERTY_URL が未設定のため無処理で終了します(.env.example参照)');
    process.exit(0);
  }

  const { start, end } = args.start && args.end ? { start: args.start, end: args.end } : defaultDateRange();

  try {
    const provider = new GoogleSearchConsoleProvider();
    const dimensions = ['query', 'page', 'device', 'country'];
    const entries = await fetchAllRows(provider, { siteUrl: siteProperty, startDate: start, endDate: end, dimensions });

    if (args.dryRun) {
      console.log(`[seo_gsc_sync][dry-run] 期間${start}〜${end}: ${entries.length}行取得(DB未反映)`);
      return;
    }

    const nowIso = new Date().toISOString();
    entries.forEach(({ row, dimensions: dims }) => {
      seoDb.upsertGscQueryRow(toGscQueryRow(row, { siteProperty, date: end, dimensions: dims }), nowIso);
    });

    console.log(`[seo_gsc_sync] 完了: 期間${start}〜${end} ${entries.length}行を反映しました(0行は正常な結果として扱います)`);
  } catch (err) {
    // 認証情報自体はerr.messageに含まれないはずだが、念のためメッセージのみ記録する
    logError('seo_gsc_sync', err.message);
    console.error(`[seo_gsc_sync] Search Console取得に失敗しましたが処理を継続します: ${err.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, defaultDateRange };
