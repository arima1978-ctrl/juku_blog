#!/bin/bash
# 毎日の記事自動生成パイプライン(cronで毎朝 config/juku.yaml の generation.run_time に起動)
#
# 早瀬(researcher-local) → 智谷(planner-blog-btoc) → 檜山(writer-blog-btoc)
#   → [赤羽(editor-btoc) → 石橋(verifier-local)] を最大 max_retry+1 回ループ
#   → sync_draft_to_db.js で posts.sqlite に登録
#
# 失敗時は scripts/log_error.js でログに残し、ダッシュボードのエラー欄に表示させる。
#
# 記事生成パイプラインの複数校舎対応(Phase 1): 第1引数に校舎のslug(branches.slug)を
# 指定すると、その校舎のconfig(branches/<slug>/config/)・データ(data/branches/<slug>/)
# を使うようエージェントへコンテキストを注入する。引数を省略した場合は従来通り
# 共有config/data(単一校舎)のまま動作し、挙動は一切変わらない。
#
# 使い方:
#   ./scripts/daily_blog.sh          # 従来通り(単一校舎、共有config/data)
#   ./scripts/daily_blog.sh obata    # 校舎「obata」向けに実行

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

BRANCH_SLUG="${1:-}"
BRANCH_CONTEXT_LINE=""
if [ -n "$BRANCH_SLUG" ]; then
  BRANCH_ID=$(node scripts/resolve_branch.js "$BRANCH_SLUG") || exit 1

  # 2026-07-17追加: Phase 4(複数校舎の日次自動オーケストレーション)が無い現状でも、
  # 校舎を明示指定した実行そのものは(手動テスト等で)可能なため、
  # generation_enabled=false(既定)の校舎は安全側に倒してスキップする。
  # ダッシュボードで明示的に有効化されるまで、その校舎向けの生成は一切走らない。
  GENERATION_ENABLED=$(node -e "
    const b = require('./scripts/lib/branches_db').getBranchById(${BRANCH_ID});
    console.log(b && b.generation_enabled ? '1' : '0');
  ")
  if [ "$GENERATION_ENABLED" != "1" ]; then
    echo "[daily_blog] 校舎「${BRANCH_SLUG}」(id=${BRANCH_ID})は generation_enabled=false のため、日次生成をスキップします(ダッシュボードで有効化してください)"
    exit 0
  fi

  export JUKU_BRANCH_ID="$BRANCH_ID"
  export JUKU_BRANCH_SLUG="$BRANCH_SLUG"
  mkdir -p "data/branches/${BRANCH_SLUG}"
  BRANCH_CONTEXT_LINE="【校舎コンテキスト】config=branches/${BRANCH_SLUG}/config data=data/branches/${BRANCH_SLUG}
"
fi

TODAY=$(date +%Y-%m-%d)
mkdir -p logs
if [ -n "$BRANCH_SLUG" ]; then
  LOG="logs/daily_blog_${TODAY}_${BRANCH_SLUG}.log"
else
  LOG="logs/daily_blog_${TODAY}.log"
fi

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

run_agent() {
  local agent="$1" tools="$2" instruction="$3" step_name="$4"
  log "=== ${step_name} (agent: ${agent}) ==="
  if ! timeout -k 20 900 claude -p --agent "$agent" \
      --allowedTools "$tools" \
      --permission-mode acceptEdits \
      "${BRANCH_CONTEXT_LINE}${instruction}" >> "$LOG" 2>&1; then
    log "!!! ${step_name} が失敗しました"
    node scripts/log_error.js "$step_name" "claude -p --agent ${agent} が非ゼロ終了(タイムアウトまたはエラー)。詳細は ${LOG} を参照"
    return 1
  fi
  return 0
}

# --- 0a. WordPress公開状態の同期(scheduled→publishedへの反映、記事消失等の検知) ---
if ! node scripts/sync_wordpress_status.js >> "$LOG" 2>&1; then
  log "!!! sync_wordpress_status.js が失敗しました(同期をスキップして続行します)"
  node scripts/log_error.js "sync_wordpress_status" "node scripts/sync_wordpress_status.js が失敗"
fi

# --- 0b. 参照用インデックスの更新(智谷が過去90日の重複・差し戻し理由を読めるように) ---
node scripts/refresh_indexes.js >> "$LOG" 2>&1

# --- 1. 早瀬: 地域ネタ収集 ---
run_agent researcher-local "WebSearch,Read,Write" \
  "今日のネタ収集をして" "researcher-local" || exit 1

# --- 1.5. 愛知県高校入試 情報ソース参照機能(features.aichi_exam_research.enabled時のみ) ---
# 決定的スクリプトが対象か判定・取得・キャッシュを行い、該当すれば構造化エージェント(杉浦)
# を1回だけ追加で呼び出す。featureがfalse、または今日のネタが入試関連でない場合は
# raw.jsonが出力されないため、その場合は構造化エージェントも呼び出さない
# (既存フローに一切影響しない設計)。
if ! node scripts/fetch_exam_research.js "$TODAY" >> "$LOG" 2>&1; then
  log "!!! fetch_exam_research.js が失敗しました(入試情報取得をスキップして続行します)"
  node scripts/log_error.js "fetch_exam_research" "node scripts/fetch_exam_research.js ${TODAY} が失敗"
fi
RAW_EXAM_PATH="data/exam_research/${TODAY}.raw.json"
if [ -f "$RAW_EXAM_PATH" ]; then
  run_agent exam-fact-structurer "Read,Write" \
    "対象ファイル ${RAW_EXAM_PATH} を構造化して data/exam_research/${TODAY}.facts.json に保存して" "exam-fact-structurer" || exit 1
fi

# --- 1.6. 競合キーワード分析(features.competitor_keyword_analysis.use_for_topic_selection有効時のみ) ---
# 決定的スクリプト(LLM不使用)。人間が承認済みの候補をdata/seo_candidates/${TODAY}.jsonへ出力する
# だけで、featureが無効・候補0件の場合はファイル自体を作らない(智谷は無い日を完全に無視する)。
if ! node scripts/seo_topic_candidates_export.js "$TODAY" >> "$LOG" 2>&1; then
  log "!!! seo_topic_candidates_export.js が失敗しました(競合キーワード候補の提示をスキップして続行します)"
  node scripts/log_error.js "seo_topic_candidates_export" "node scripts/seo_topic_candidates_export.js ${TODAY} が失敗"
fi

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
  # 赤羽・石橋は Read/Write のみでディレクトリ一覧表示ができず、指示文に
  # ファイルパスが無いと自力では発見できない(推測に頼って発見失敗した実例あり)。
  # get_draft_status.js(fs.readdirSyncで確実に発見する決定的スクリプト)が
  # 見つけたパスを、指示文に明示して渡す。
  PRE_STATUS_LINE=$(node scripts/get_draft_status.js "$TODAY")
  PRE_STATUS=$(echo "$PRE_STATUS_LINE" | cut -f1)
  PRE_DRAFT_PATH=$(echo "$PRE_STATUS_LINE" | cut -f2)
  if [ -z "$PRE_DRAFT_PATH" ]; then
    log "!!! 本日のドラフトが見つかりません(檜山の執筆直後)"
    node scripts/log_error.js "writer-blog-btoc" "data/drafts/${TODAY}-*.md が見つかりません(執筆直後)"
    exit 1
  fi

  run_agent editor-btoc "Read,Write" \
    "対象ファイル ${PRE_DRAFT_PATH} を校正して" "editor-btoc" || exit 1

  # 赤羽が見出し・本文を確定させた直後に、過去記事との類似度をチェックし
  # frontmatterのsimilarity_checkに記録する(石橋が判定材料として読む)。
  # 失敗してもパイプライン自体は止めない(類似度チェックは付加的なチェックのため)。
  CUR_STATUS_LINE=$(node scripts/get_draft_status.js "$TODAY")
  CUR_STATUS=$(echo "$CUR_STATUS_LINE" | cut -f1)
  CUR_DRAFT_PATH=$(echo "$CUR_STATUS_LINE" | cut -f2)

  # 2026-07-17追加: 赤羽が対象ファイルと校舎コンテキストの不一致等を検出して
  # 処理を拒否した場合、赤羽自身は正しく振る舞っていても(claude -pはexit 0で
  # 終了するため)従来はこのシェルスクリプトが検知できず、そのまま後続処理へ
  # 進んでしまっていた(あま本部校のテスト生成で実際に発生した根本原因の一つ)。
  # statusが赤羽の処理前後で変化していない場合は、拒否/失敗とみなして停止する。
  if [ "$CUR_STATUS" = "$PRE_STATUS" ]; then
    log "!!! 赤羽の処理後もstatusが「${PRE_STATUS}」のまま変化していません。校舎コンテキストとの不一致、または処理拒否の可能性があります"
    node scripts/log_error.js "editor-btoc" "status不変(${PRE_STATUS} -> ${CUR_STATUS})。対象ファイル取り違え・校舎コンテキスト不一致の可能性。詳細は ${LOG} を参照"
    exit 1
  fi

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
    # 愛知県高校入試 情報ソース参照機能: exam_facts_usedが無い記事はnot_applicableになるだけで無害
    if ! node scripts/check_exam_facts.js "$CUR_DRAFT_PATH" >> "$LOG" 2>&1; then
      log "!!! check_exam_facts.js が失敗しました(入試ファクトチェックをスキップして続行します)"
      node scripts/log_error.js "check_exam_facts" "node scripts/check_exam_facts.js ${CUR_DRAFT_PATH} が失敗"
    fi
  fi

  PRE_VERIFY_STATUS="$CUR_STATUS"

  run_agent verifier-local "Read,Write" \
    "対象ファイル ${CUR_DRAFT_PATH:-$PRE_DRAFT_PATH} をファクトチェックして" "verifier-local" || exit 1

  STATUS_LINE=$(node scripts/get_draft_status.js "$TODAY")
  STATUS=$(echo "$STATUS_LINE" | cut -f1)
  DRAFT_PATH=$(echo "$STATUS_LINE" | cut -f2)
  log "現在のステータス: ${STATUS} (${DRAFT_PATH})"

  # 赤羽と同じ理由: 石橋が不一致・拒否を検出して処理を止めた場合も、
  # statusが処理前後で変化していなければ失敗として扱う。
  if [ "$STATUS" = "$PRE_VERIFY_STATUS" ]; then
    log "!!! 石橋の処理後もstatusが「${PRE_VERIFY_STATUS}」のまま変化していません。校舎コンテキストとの不一致、または処理拒否の可能性があります"
    node scripts/log_error.js "verifier-local" "status不変(${PRE_VERIFY_STATUS} -> ${STATUS})。対象ファイル取り違え・校舎コンテキスト不一致の可能性。詳細は ${LOG} を参照"
    exit 1
  fi

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
        "対象ファイル ${DRAFT_PATH} の差し戻しを修正して" "writer-blog-btoc(修正モード)" || exit 1
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
