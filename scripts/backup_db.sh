#!/bin/bash
# 本番DB(data/posts.sqlite)の日次自動バックアップ。data/backups/配下にタイムスタンプ付きで
# コピーし、直近7世代(=約1週間分)のみ保持する(それより古いものは自動削除)。
#
# 2026-07-17のインシデント(他セッションがdata/posts.sqliteを直接rmし、実記事2件・
# GSC実績15万件超が失われた)を受けて追加。cronでdaily_blog.sh(毎朝05:00)より少し前に
# 実行する想定。バックアップ失敗時もdaily_blog.sh側の記事生成処理には一切影響させない
# (このスクリプト自体が失敗してもexit 1で終了するのみ。cron.logで検知できる)。
#
# 使い方: bash scripts/backup_db.sh
# cron例: 45 4 * * * cd /path/to/juku_blog && ./scripts/backup_db.sh >> logs/backup.log 2>&1

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SRC="data/posts.sqlite"
BACKUP_DIR="data/backups"
KEEP_GENERATIONS=7

if [ ! -f "$SRC" ]; then
  echo "[backup_db] $SRC が見つかりません(初回起動前など)。スキップします"
  exit 0
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_DIR/posts_${TIMESTAMP}.sqlite"

cp "$SRC" "$DEST"
echo "[backup_db] バックアップを作成しました: $DEST ($(du -h "$DEST" | cut -f1))"

# 直近KEEP_GENERATIONS件のみ保持(更新日時の新しい順に数えて、それ以降を削除)
DELETED=0
while IFS= read -r old; do
  rm -f "$BACKUP_DIR/$old"
  echo "[backup_db] 古いバックアップを削除しました: $BACKUP_DIR/$old"
  DELETED=$((DELETED + 1))
done < <(cd "$BACKUP_DIR" && ls -1t posts_*.sqlite 2>/dev/null | tail -n "+$((KEEP_GENERATIONS + 1))")

echo "[backup_db] 完了(保持: 直近${KEEP_GENERATIONS}世代、今回削除: ${DELETED}件)"
