#!/bin/bash
# 複数校舎の日次自動オーケストレーション(Phase 4)。cronはこのスクリプトだけを
# 毎朝1回起動する(daily_blog.sh単体の直接呼び出しはこのスクリプト経由に置き換える)。
#
# 1. legacy(校舎コンテキスト無し、共有config=小幡校)を常に実行する
#    (最も早く作成された校舎は、そもそもgeneration_enabledの対象外の単一テナント時代
#    からの既定挙動のため、フラグに関わらず常に実行する)。
# 2. legacy以外の全校舎について、branches.generation_enabled=trueのものだけ
#    daily_blog.sh <slug> を実行する(generation_enabled自体のチェックは
#    daily_blog.sh側に既に実装済みのため、ここでは対象slugを列挙して渡すだけでよい)。
#
# 校舎ごとに独立したログ(logs/daily_blog_<date>[_<slug>].log)に記録され、
# 1校舎の失敗(exit非ゼロ)は他校舎の実行を妨げない(継続実行・ログ記録のみ)。
#
# 自動リトライ(2026-07-30〜): 校舎の実行が失敗した場合、30分待って同じコマンドを
# 1回だけ自動リトライする(失敗種別の判定はしない。一過性障害<Claude API過負荷等>を
# 想定した単純な再試行で、判定ロジックを増やすと壊れやすくなるため)。初回失敗時点では
# 通知・エラー記録をせず、再試行も失敗した場合のみ従来通りTelegram通知・エラーログ・
# heartbeat失敗記録を行う(一過性障害は無音で自己回復させ、本当に人手が必要な時だけ
# 通知することで誤報を減らす)。デッドマンスイッチ(check_batch_heartbeats.js)の
# daily_blog_all許容遅延は30時間のため、30分の再試行待ちは一切干渉しない。
# 途中のステップ(執筆・校正等)からの再開はせず、校舎のパイプライン全体をやり直す
# (部分再開は状態管理が複雑になり壊れやすいため)。
#
# 使い方: ./scripts/daily_blog_all.sh (cronから起動、引数無し)

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

TODAY=$(date +%Y-%m-%d)
mkdir -p logs
LOG="logs/daily_blog_all_${TODAY}.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

RETRY_DELAY_SECONDS="${JUKU_BLOG_RETRY_DELAY_SECONDS:-1800}" # 30分。一過性障害(API過負荷等)が収まるのを待つ。テスト用に環境変数で上書き可能

# 校舎1件分の実行を、失敗時に30分待って1回だけ自動リトライする。
# 戻り値0=最終的に成功(初回成功 or リトライで成功)、1=リトライも失敗。
run_branch_with_retry() {
  local label="$1"; shift
  if "$@" >> "$LOG" 2>&1; then
    return 0
  fi
  log "!!! ${label}の初回実行が失敗しました。${RETRY_DELAY_SECONDS}秒待って1回だけ自動リトライします(一過性障害を想定。通知はまだ行いません)"
  sleep "$RETRY_DELAY_SECONDS"
  log "=== ${label}(自動リトライ) ==="
  if "$@" >> "$LOG" 2>&1; then
    log "=== ${label}: 自動リトライで成功しました ==="
    return 0
  fi
  log "!!! ${label}は自動リトライも失敗しました"
  return 1
}

FAILED_TARGETS=""

log "=== legacy(小幡校、共有config) ==="
if ! run_branch_with_retry "legacy" ./scripts/daily_blog.sh; then
  node scripts/log_error.js "daily_blog_all_legacy" "./scripts/daily_blog.sh(legacy)が初回・自動リトライとも非ゼロ終了。詳細は ${LOG} を参照"
  FAILED_TARGETS="${FAILED_TARGETS}legacy "
fi

# legacy(最も早く作成された校舎)以外で、generation_enabled=trueの校舎slugを列挙する
# (判定ロジック自体はscripts/lib/branches_db.jsのlistAutoGenerationBranches()に集約し、
# 単体テスト可能にしている)。
OTHER_SLUGS=$(node -e "
  const { listAutoGenerationBranches } = require('./scripts/lib/branches_db');
  listAutoGenerationBranches().forEach((b) => console.log(b.slug));
")

if [ -n "$OTHER_SLUGS" ]; then
  while IFS= read -r slug; do
    [ -z "$slug" ] && continue
    log "=== ${slug} ==="
    if ! run_branch_with_retry "$slug" ./scripts/daily_blog.sh "$slug"; then
      node scripts/log_error.js "daily_blog_all_${slug}" "./scripts/daily_blog.sh ${slug} が初回・自動リトライとも非ゼロ終了。詳細は ${LOG} を参照"
      FAILED_TARGETS="${FAILED_TARGETS}${slug} "
    fi
  done <<< "$OTHER_SLUGS"
else
  log "generation_enabled=trueの校舎(legacy以外)はありません"
fi

log "=== 全校舎の実行完了 ==="

if [ -n "$FAILED_TARGETS" ]; then
  node scripts/record_heartbeat.js daily_blog_all --failed --detail="失敗校舎(自動リトライ後も失敗): ${FAILED_TARGETS}詳細は ${LOG}"
  node scripts/notify_telegram.js "⚠️ 日次記事生成(daily_blog_all.sh)で失敗した校舎があります(30分後の自動リトライも失敗): ${FAILED_TARGETS}"
else
  node scripts/record_heartbeat.js daily_blog_all
fi

exit 0
