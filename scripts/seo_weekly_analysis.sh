#!/bin/bash
# 競合キーワード分析(Keyword Gap Lite)の週次バッチ。
# 毎朝の記事生成(daily_blog.sh)とは完全に分離しており、cronで別枠(週次)に登録する。
#
# 競合サイト取得 → ページ解析 → Gap判定/優先度スコア算出 の順に実行する。
# features.competitor_keyword_analysis.enabled または .crawl_enabled が false の場合、
# 各stepは無処理で即終了する(daily_blog.shの記事生成フローには一切影響しない)。
# 1stepの失敗は他stepの実行を妨げない(継続実行・ログ記録のみ)。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

TODAY=$(date +%Y-%m-%d)
mkdir -p logs
LOG="logs/seo_weekly_${TODAY}.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

run_step() {
  local step_name="$1"
  shift
  log "=== ${step_name} ==="
  if ! "$@" >> "$LOG" 2>&1; then
    log "!!! ${step_name} が失敗しました(継続します)"
    node scripts/log_error.js "$step_name" "${*} が非ゼロ終了。詳細は ${LOG} を参照"
    return 1
  fi
  return 0
}

FAILED_STEPS=""

# Search Console実績の定期取得(2026-07-28追加): このstep以前は同期を行うcron設定が無く、
# features.competitor_keyword_analysis.search_console_enabled=trueにしても実績が全く更新
# されないままだった(初回バックフィル後、次週以降もimpressions/clicksが0のままになる
# バグとして発覚)。--start/--endを指定しない既定(直近3日)だと週次(7日おき)実行では
# 間が抜けるため、前回実行分との重なりを持たせた8日前〜3日前(GSCの反映遅延を考慮)を
# 明示的に指定する。feature flag無効時は無処理で終了するため他stepへの影響はない。
GSC_SYNC_START=$(date -d "-8 days" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)
GSC_SYNC_END=$(date -d "-3 days" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)
run_step "seo_gsc_sync" node scripts/seo_gsc_sync.js --start="${GSC_SYNC_START}" --end="${GSC_SYNC_END}" || FAILED_STEPS="${FAILED_STEPS}seo_gsc_sync "

run_step "seo_competitor_crawl" node scripts/seo_competitor_crawl.js || FAILED_STEPS="${FAILED_STEPS}seo_competitor_crawl "
run_step "seo_page_analyze" node scripts/seo_page_analyze.js || FAILED_STEPS="${FAILED_STEPS}seo_page_analyze "
run_step "seo_gap_calculate" node scripts/seo_gap_calculate.js || FAILED_STEPS="${FAILED_STEPS}seo_gap_calculate "

# SEO効果測定 週次スナップショット(2026-07-27): Gap判定の直後、対象週(今日を含む週の月曜)ぶんを保存する。
# 2026-07-28修正: `date -d monday`はGNU dateの「次のmonday」解釈のため、日曜(このバッチの
# 実行曜日)に実行すると6日後の月曜(未来の日付)を返してしまい、対象週がずれるバグがあった。
# ISO week番号(%u、月曜=1)を使い、今日を含む週の月曜(未来にならない)を確実に計算する。
WEEK_START=$(date -d "-$(($(date +%u)-1)) days" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)
run_step "seo_metrics_snapshot_generate" node scripts/seo_metrics_snapshot_generate.js --week="${WEEK_START}" --save || FAILED_STEPS="${FAILED_STEPS}seo_metrics_snapshot_generate "

log "=== 完了 ==="

if [ -n "$FAILED_STEPS" ]; then
  node scripts/record_heartbeat.js seo_weekly_analysis --failed --detail="失敗step: ${FAILED_STEPS}詳細は ${LOG}"
  node scripts/notify_telegram.js "⚠️ 週次SEO分析(seo_weekly_analysis.sh)で一部stepが失敗しました: ${FAILED_STEPS}"
else
  node scripts/record_heartbeat.js seo_weekly_analysis
fi

exit 0
