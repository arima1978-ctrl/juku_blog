'use strict';

// 緊急対応(2026-07-16): 複数校舎管理マルチテナント化の移行で、postsテーブルの
// branch_idが既存行に対してバックフィルされずNULLのまま残る不具合があった
// (原因: ensureColumn()はADD COLUMNのみでNULLのまま追加するため。seo_tasks等
// 7テーブルはensureBranchIdRebuild()経由で正しく自動バックフィルされていたが、
// postsだけ単純なensureColumnで済ませてしまい、明示的なUPDATEが抜けていた)。
// この不具合はscripts/lib/db.jsのgetDb()側で既に修正済み(branch_id IS NULLの
// 行のみを対象にした冪等UPDATEを追加)だが、本コマンドはその修正を明示的に
// 本番へ適用しつつ、修正前後の状態を証跡として残すための診断+適用スクリプト。
//
// 既定はdry-run相当(現在の分布を表示するのみ、DBは変更しない)。
// --confirm 明示時のみ、getDb()(=修正済みバックフィルロジック)を実行して
// 実際にUPDATEを適用する。posts以外の7テーブル(seo_tasks/seo_keyword_candidates/
// seo_page_plans/seo_weekly_recommendations/seo_compound_keywords/seo_topics/
// seo_competitors)についても、念のため同じ考え方でbranch_id IS NULLの行が
// 残っていないかを診断し、あれば同様に現在アクティブな校舎へ補正する。
//
// 使い方:
//   node scripts/fix_branch_id_backfill.js --dry-run   # 現状の分布を表示するのみ
//   node scripts/fix_branch_id_backfill.js --confirm   # 実際に補正を適用する

const BRANCH_ID_TABLES = [
  'posts',
  'seo_competitors',
  'seo_keyword_candidates',
  'seo_tasks',
  'seo_page_plans',
  'seo_weekly_recommendations',
  'seo_compound_keywords',
  'seo_topics',
];

function tableExists(conn, table) {
  return Boolean(conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function printDistribution(conn, label) {
  console.log(`\n--- ${label} ---`);
  console.log('branches:', conn.prepare('SELECT id, name, is_active FROM branches ORDER BY id').all());
  for (const table of BRANCH_ID_TABLES) {
    if (!tableExists(conn, table)) {
      console.log(`${table}: (テーブル未作成)`);
      continue;
    }
    const rows = conn.prepare(`SELECT branch_id, COUNT(*) AS c FROM ${table} GROUP BY branch_id`).all();
    console.log(`${table}:`, rows);
  }
}

function countNullBranchId(conn) {
  return BRANCH_ID_TABLES.reduce((sum, table) => {
    if (!tableExists(conn, table)) return sum;
    const row = conn.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE branch_id IS NULL`).get();
    return sum + row.c;
  }, 0);
}

function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--confirm');

  // getDb()を呼ぶ前に生の接続で「補正前」の状態を確認する
  // (getDb()自体がbranch_id IS NULLの行をUPDATEする修正済みロジックを含むため、
  // 呼び出した時点で補正が走ってしまう。補正前の証跡を残すため、まずgetDb()を
  // 経由しない生のDatabaseSyncで現状を読む)。
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.JUKU_BLOG_DB_PATH || path.join(__dirname, '..', 'data', 'posts.sqlite');
  const before = new DatabaseSync(DB_PATH, { readOnly: true });
  printDistribution(before, '補正前 (現状)');
  const nullCountBefore = countNullBranchId(before);
  before.close();

  if (!confirmed) {
    console.log(
      `\n[fix_branch_id_backfill][dry-run] branch_id IS NULLの行が合計${nullCountBefore}件あります。` +
        '実際に補正するには --confirm を指定してください(getDb()の修正済みバックフィルロジックを適用します)。'
    );
    return;
  }

  if (nullCountBefore === 0) {
    console.log('\n[fix_branch_id_backfill] branch_id IS NULLの行は既にありません。修正不要です。');
    return;
  }

  // --confirm: 修正済みgetDb()を実行し、posts.branch_idのバックフィルを適用する。
  // seo_*系7テーブルは元々ensureBranchIdRebuild()で正しくバックフィル済みのはずだが、
  // 万一NULLが残っていた場合に備え、getDb()実行後も再度分布を確認する。
  const { getDb, closeDb } = require('./lib/db');
  const conn = getDb();

  printDistribution(conn, '補正後');
  const nullCountAfter = countNullBranchId(conn);
  console.log(`\n[fix_branch_id_backfill] 補正完了: branch_id IS NULLの行は${nullCountBefore}件 → ${nullCountAfter}件になりました。`);
  if (nullCountAfter > 0) {
    console.error(
      '[fix_branch_id_backfill][警告] まだbranch_id IS NULLの行が残っています。' +
        'posts以外のテーブルで想定外のケース(例: is_active=1の校舎が存在しない等)が' +
        '発生している可能性があるため、上記の分布を確認し個別に調査してください。'
    );
  }
  closeDb();
}

if (require.main === module) {
  main();
}

module.exports = { main, BRANCH_ID_TABLES, printDistribution, countNullBranchId };
