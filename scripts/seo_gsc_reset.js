'use strict';

// 開発環境向け: seo_gsc_queriesテーブルのみを安全に削除するコマンド。
// posts・他のSEOテーブル(seo_keyword_candidates/seo_tasks等)には一切触れない。
// 旧形式(dateが取得期間の終端日で一律だった)のデータをクリアし、
// 修正後のseo_gsc_sync.jsで日別データを再取得し直したい場合に使う。
// 誤爆防止のため --confirm を指定しない限り削除は実行しない。
//
// 使い方:
//   node scripts/seo_gsc_reset.js --dry-run   # 削除対象件数のみ表示(削除しない)
//   node scripts/seo_gsc_reset.js --confirm   # 実際に削除する

const { getDb } = require('./lib/db');

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirmed = args.includes('--confirm');

  const conn = getDb();
  const { c: count } = conn.prepare('SELECT COUNT(*) AS c FROM seo_gsc_queries').get();

  if (dryRun) {
    console.log(`[seo_gsc_reset][dry-run] seo_gsc_queriesの${count}件が削除対象です(削除は実行していません)`);
    return;
  }

  if (!confirmed) {
    console.error(`[seo_gsc_reset] seo_gsc_queriesに${count}件あります。削除するには --confirm を指定してください`);
    process.exit(1);
  }

  conn.prepare('DELETE FROM seo_gsc_queries').run();
  console.log(`[seo_gsc_reset] seo_gsc_queriesから${count}件を削除しました(posts・他のSEOテーブルは無変更です)`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
