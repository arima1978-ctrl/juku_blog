'use strict';

// content_category 遡及分類(2026-07-29)。scripts/lib/seo/content_category.jsの新設に伴い、
// 既存のseo_keyword_candidates/seo_tasksの全行へ同じ分類ロジックを適用しcontent_categoryを
// 埋める一度きりのバッチ。IDやスコア等、他のカラムは一切変更しない。決定的処理のため
// 何度実行しても結果は同じ(安全に再実行できる)。既定dry-run、--save明示時のみ保存。
//
// 使い方:
//   node scripts/seo_content_category_backfill.js --dry-run
//   node scripts/seo_content_category_backfill.js --save

const { getDb } = require('./lib/db');
const { classifyContentCategory } = require('./lib/seo/content_category');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  return { save: has('--save'), dryRun: has('--dry-run') };
}

function backfillTable(conn, table, keywordColumn, { save }) {
  const rows = conn.prepare(`SELECT id, ${keywordColumn} AS keyword, content_category FROM ${table}`).all();
  const changes = rows
    .map((r) => ({ id: r.id, keyword: r.keyword, from: r.content_category, to: classifyContentCategory(r.keyword) }))
    .filter((c) => c.from !== c.to);

  if (save && changes.length > 0) {
    const stmt = conn.prepare(`UPDATE ${table} SET content_category = :content_category WHERE id = :id`);
    for (const c of changes) {
      stmt.run({ id: c.id, content_category: c.to });
    }
  }
  return { table, total: rows.length, changed: changes.length, sample: changes.slice(0, 10) };
}

function main() {
  const { save, dryRun } = parseArgs(process.argv.slice(2));
  const conn = getDb();
  const results = [
    backfillTable(conn, 'seo_keyword_candidates', 'normalized_keyword', { save: save && !dryRun }),
    backfillTable(conn, 'seo_tasks', 'target_keyword', { save: save && !dryRun }),
  ];

  const shouldSave = save && !dryRun;
  for (const r of results) {
    console.log(`[seo_content_category_backfill] ${r.table}: 対象${r.total}件中 ${r.changed}件を分類${shouldSave ? '(保存済み)' : '(--dry-run、未保存)'}`);
    r.sample.forEach((c) => console.log(`   id=${c.id} "${c.keyword}": ${c.from ?? 'null'} -> ${c.to ?? 'null'}`));
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, backfillTable, main };
