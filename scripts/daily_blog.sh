#!/bin/bash
# 毎日の記事自動生成パイプライン(cronで毎朝 config/juku.yaml の generation.run_time に起動)
#
# 早瀬(researcher-local) → 智谷(planner-blog-btoc) → 檜山(writer-blog-btoc)
#   → [赤羽(editor-btoc) → 石橋(verifier-local)] を最大 max_retry+1 回ループ
#   → sync_draft_to_db.js で posts.sqlite に登録
#
# 失敗時は scripts/log_error.js でログに残し、ダッシュボードのエラー欄に表示させる。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

TODAY=$(date +%Y-%m-%d)
mkdir -p logs
LOG="logs/daily_blog_${TODAY}.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

run_agent() {
  local agent="$1" tools="$2" instruction="$3" step_name="$4"
  log "=== ${step_name} (agent: ${agent}) ==="
  if ! timeout -k 20 900 claude -p --agent "$agent" \
      --allowedTools "$tools" \
      --permission-mode acceptEdits \
      "$instruction" >> "$LOG" 2>&1; then
    log "!!! ${step_name} が失敗しました"
    node scripts/log_error.js "$step_name" "claude -p --agent ${agent} が非ゼロ終了(タイムアウトまたはエラー)。詳細は ${LOG} を参照"
    return 1
  fi
  return 0
}

# --- 0. 参照用インデックスの更新(智谷が過去90日の重複・差し戻し理由を読めるように) ---
node scripts/refresh_indexes.js >> "$LOG" 2>&1

# --- 1. 早瀬: 地域ネタ収集 ---
run_agent researcher-local "WebSearch,Read,Write" \
  "今日のネタ収集をして" "researcher-local" || exit 1

# --- 2. 智谷: 企画 ---
run_agent planner-blog-btoc "Read,Write" \
  "今日の記事企画をして" "planner-blog-btoc" || exit 1

# --- 3. 檜山: 執筆 ---
run_agent writer-blog-btoc "Read,Write" \
  "今日の記事を執筆して" "writer-blog-btoc" || exit 1

# --- 4-5. 赤羽(校正) → 石橋(ファクトチェック) をループ ---
MAX_RETRY=$(node -e "console.log(require('./scripts/lib/config').loadJukuConfig().generation.max_retry)")
attempt=0
while true; do
  run_agent editor-btoc "Read,Write" \
    "今日の記事を校正して" "editor-btoc" || exit 1

  # 赤羽が見出し・本文を確定させた直後に、過去記事との類似度をチェックし
  # frontmatterのsimilarity_checkに記録する(石橋が判定材料として読む)。
  # 失敗してもパイプライン自体は止めない(類似度チェックは付加的なチェックのため)。
  CUR_STATUS_LINE=$(node scripts/get_draft_status.js "$TODAY")
  CUR_DRAFT_PATH=$(echo "$CUR_STATUS_LINE" | cut -f2)
  if [ -n "$CUR_DRAFT_PATH" ]; then
    if ! node scripts/check_similarity.js "$CUR_DRAFT_PATH" >> "$LOG" 2>&1; then
      log "!!! check_similarity.js が失敗しました(類似度チェックをスキップして続行します)"
      node scripts/log_error.js "check_similarity" "node scripts/check_similarity.js ${CUR_DRAFT_PATH} が失敗"
    fi
    # 出典ID(episode_sources/parent_qa_sources)が実在するかも同様に検証する
    if ! node scripts/check_citations.js "$CUR_DRAFT_PATH" >> "$LOG" 2>&1; then
      log "!!! check_citations.js が失敗しました(出典チェックをスキップして続行します)"
      node scripts/log_error.js "check_citations" "node scripts/check_citations.js ${CUR_DRAFT_PATH} が失敗"
    fi
  fi

  run_agent verifier-local "Read,Write" \
    "今日の記事をファクトチェックして" "verifier-local" || exit 1

  STATUS_LINE=$(node scripts/get_draft_status.js "$TODAY")
  STATUS=$(echo "$STATUS_LINE" | cut -f1)
  DRAFT_PATH=$(echo "$STATUS_LINE" | cut -f2)
  log "現在のステータス: ${STATUS} (${DRAFT_PATH})"

  case "$STATUS" in
    verified|escalated)
      break
      ;;
    revision_needed)
      attempt=$((attempt + 1))
      if [ "$attempt" -gt "$MAX_RETRY" ]; then
        log "!!! リトライ上限(${MAX_RETRY})を超過しましたが status が revision_needed のままです。石橋のエスカレーション処理を確認してください"
        node scripts/log_error.js "verifier-local" "retry_countの上限判定に問題がある可能性(status=revision_needed のままループ超過)"
        exit 1
      fi
      log "差し戻し(${attempt}回目)。檜山に修正を依頼します"
      run_agent writer-blog-btoc "Read,Write" \
        "差し戻しを修正して" "writer-blog-btoc(修正モード)" || exit 1
      ;;
    not_found)
      log "!!! 本日のドラフトが見つかりません"
      node scripts/log_error.js "editor-btoc/verifier-local" "data/drafts/${TODAY}-*.md が見つかりません"
      exit 1
      ;;
    *)
      log "!!! 想定外のstatus: ${STATUS}"
      node scripts/log_error.js "verifier-local" "想定外のstatus: ${STATUS}"
      exit 1
      ;;
  esac
done

# --- 6. DBへ反映 ---
if [ -z "$DRAFT_PATH" ]; then
  log "!!! 同期対象のドラフトパスが取得できませんでした"
  node scripts/log_error.js "sync_draft_to_db" "DRAFT_PATHが空"
  exit 1
fi

if ! node scripts/sync_draft_to_db.js "$DRAFT_PATH" >> "$LOG" 2>&1; then
  log "!!! posts.sqlite への同期に失敗しました"
  node scripts/log_error.js "sync_draft_to_db" "node scripts/sync_draft_to_db.js ${DRAFT_PATH} が失敗"
  exit 1
fi

node scripts/refresh_indexes.js >> "$LOG" 2>&1

log "=== 完了: ${DRAFT_PATH} ==="
exit 0
