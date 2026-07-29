'use strict';

// 習い事カテゴリ 週次スナップショット(2026-07-29)。seo_metrics_snapshots/
// seo_metrics_keyword_snapshots(校舎に紐づく候補・タスクの実績)とは別に、
// サイト全体の生GSCクエリ(seo_gsc_queries)をキーワード辞書
// (scripts/lib/seo/content_category.js)で分類した実績そのものを記録する
// (ヘッジとして意味があるのは候補の順位ではなく資産全体の推移、というユーザー指示)。
// 既定dry-run、--save明示時のみ保存。features.competitor_keyword_analysis.enabled=false
// の間は無処理で終了する(既存のSEO測定系CLIと同じ安全設計)。
//
// 辞書は将来更新されうるため、各週の値は計算時点の辞書で確定させ凍結する
// (このスクリプトは常に「今の辞書」で計算するだけで、過去の週を遡って再計算しない)。
//
// 使い方:
//   node scripts/seo_metrics_category_snapshot_generate.js --week=2026-07-20 --dry-run
//   node scripts/seo_metrics_category_snapshot_generate.js --week=2026-07-20 --save

const { loadJukuConfig } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { weekEndOfLocal } = require('./lib/seo/week_math');

// GSCの反映遅延(2〜3日)を安全に上回るための最小マージン。既存のseo_metrics_snapshot_generate.js
// と同じ値(不完全な週を記録してしまう欠陥の再発防止)。
const MIN_DAYS_SINCE_WEEK_END = 3;

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    week: get('--week='),
    dryRun: has('--dry-run'),
    save: has('--save'),
    format: get('--format=') || 'text',
  };
}

function main() {
  const { week, dryRun, save, format } = parseArgs(process.argv.slice(2));
  if (!week) {
    console.error('使い方: node scripts/seo_metrics_category_snapshot_generate.js --week=<YYYY-MM-DD 対象週の月曜> [--dry-run|--save] [--format=json|text]');
    process.exitCode = 1;
    return;
  }

  const sharedConfig = loadJukuConfig();
  const feature = sharedConfig.features && sharedConfig.features.competitor_keyword_analysis;
  if (!feature || !feature.enabled) {
    console.log('[seo_metrics_category_snapshot_generate] competitor_keyword_analysis.enabled が false のため無処理で終了します');
    return;
  }

  const weekEnd = weekEndOfLocal(week);

  const today = new Date();
  const weekEndDate = new Date(`${weekEnd}T00:00:00`);
  const daysSinceWeekEnd = Math.floor((today - weekEndDate) / (1000 * 60 * 60 * 24));
  if (daysSinceWeekEnd < MIN_DAYS_SINCE_WEEK_END) {
    console.error(
      `[seo_metrics_category_snapshot_generate] 対象週(${week}〜${weekEnd})はまだ完全ではない可能性があります` +
        `(週末から${daysSinceWeekEnd}日しか経っておらず、GSCの反映遅延を考慮すると不足しています。最低${MIN_DAYS_SINCE_WEEK_END}日必要)。`
    );
    process.exitCode = 1;
    return;
  }

  const totals = seoDb.getGscCategoryTotalsInRange({ startDate: week, endDate: weekEnd });
  const categories = Object.keys(totals);

  const shouldSave = save && !dryRun;
  if (shouldSave) {
    const nowIso = new Date().toISOString();
    for (const category of categories) {
      seoDb.upsertSeoMetricsCategorySnapshot({ weekStart: week, weekEnd, category, ...totals[category] }, nowIso);
    }
  }

  if (format === 'json') {
    console.log(JSON.stringify({ ok: true, week, weekEnd, saved: shouldSave, totals }, null, 2));
  } else {
    if (categories.length === 0) {
      console.log(`[seo_metrics_category_snapshot_generate] week=${week} saved=${shouldSave} 該当カテゴリなし`);
    }
    for (const category of categories) {
      console.log(
        `[seo_metrics_category_snapshot_generate] week=${week} category=${category} saved=${shouldSave} impressions=${totals[category].impressions} clicks=${totals[category].clicks}`
      );
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
