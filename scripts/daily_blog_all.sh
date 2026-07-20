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
# 使い方: ./scripts/daily_blog_all.sh (cronから起動、引数無し)

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

TODAY=$(date +%Y-%m-%d)
mkdir -p logs
LOG="logs/daily_blog_all_${TODAY}.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "=== legacy(小幡校、共有config) ==="
if ! ./scripts/daily_blog.sh >> "$LOG" 2>&1; then
  log "!!! legacyの実行が失敗しました(他校舎の実行は継続します)"
  node scripts/log_error.js "daily_blog_all_legacy" "./scripts/daily_blog.sh(legacy)が非ゼロ終了。詳細は ${LOG} を参照"
fi

# legacy(最も早く作成された校舎)以外で、generation_enabled=trueの校舎slugを列挙する
# (判定ロジック自体はscripts/lib/branches_db.jsのlistAutoGenerationBranches()に集約し、
# 単体テスト可能にしている)。
OTHER_SLUGS=$(node -e "
  const { listAutoGenerationBranches } = require('./scripts/lib/branches_db');
  listAutoGenerationBranches().forEach((b) => console.log(b.slug));
")

if [ -z "$OTHER_SLUGS" ]; then
  log "generation_enabled=trueの校舎(legacy以外)はありません。完了します"
  exit 0
fi

while IFS= read -r slug; do
  [ -z "$slug" ] && continue
  log "=== ${slug} ==="
  if ! ./scripts/daily_blog.sh "$slug" >> "$LOG" 2>&1; then
    log "!!! ${slug}の実行が失敗しました(他校舎の実行は継続します)"
    node scripts/log_error.js "daily_blog_all_${slug}" "./scripts/daily_blog.sh ${slug} が非ゼロ終了。詳細は ${LOG} を参照"
  fi
done <<< "$OTHER_SLUGS"

log "=== 全校舎の実行完了 ==="
exit 0
