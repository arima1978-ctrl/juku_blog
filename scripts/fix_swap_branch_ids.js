'use strict';

// 緊急対応(2026-07-16): 本番データの校舎ID逆転インシデントの修復スクリプト。
//
// 原因: scripts/lib/db.jsのresolveBackfillBranchId()が、既存データ(移行前=単一
// テナント時代のデータ)のバックフィル先を「is_active=1の校舎」から決定していた。
// is_activeは校舎・塾長設定タブの操作で随時変わりうる実行時状態であり、複数テーブルの
// 移行が別々のデプロイ(初回の7テーブル移行と、後日のposts移行)にまたがった際、
// それぞれの実行タイミングでたまたまis_active=1だった校舎が異なっていたため、
// 本来同じ校舎に属すべき既存データがbranch_id=1(小幡校)とbranch_id=2(あま本部)に
// 分裂してしまった(このバグ自体はscripts/lib/db.jsのresolveBackfillBranchId()を
// 「最初に作成された校舎(id最小)」基準に修正済み。本スクリプトは既に発生してしまった
// 本番データの分裂を修復するための一度限りの補正用)。
//
// 【重要: 単純な双方向スワップではなく、片方向の統合(move)であること】
// 依頼時は「スワップ」と表現されたが、実際の状況を再現して検証した結果、
// 単純にbranch_id=1と2の中身を入れ替える(双方向スワップ)と、今朝のように
// 移行後(=このインシデントの根本原因を修正した後)に正しくbranch_id=1で
// 生成された新しい記事までもが誤ってbranch_id=2側へ移動してしまうことが判明した。
// 依頼内の詳細な指示(「branch_id=2の全行をbranch_id=1に更新する」「あま本部校の
// データは完全に空に戻す」)が示す本来の意図は双方向スワップではなく、
// 「fromに紐づく全データをtoへ一方向に統合し、fromを空にする」move操作である。
// 既にtoに存在する正しいデータ(今朝の新規記事等)には一切触れない。
//
// 既定はdry-run相当(現在のbranch_id分布を表示するのみ、DBは変更しない)。
// --confirm 明示時のみ、--from(空にする校舎)の全データを--to(統合先の校舎)へ移動する。
// 対象8テーブル全てを1トランザクションにまとめ、途中で失敗した場合は全体がROLLBACKされる
// (例えばfrom側とto側で同じキーの行が既に両方に存在する場合、UNIQUE制約違反により
// そのテーブルのUPDATEが失敗し、トランザクション全体が安全にロールバックされる)。
//
// 使い方:
//   node scripts/fix_swap_branch_ids.js --dry-run                  # 現状の分布を表示するのみ
//   node scripts/fix_swap_branch_ids.js --from=2 --to=1 --confirm  # 2の全データを1へ統合し、2を空にする

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

function parseArgs(argv) {
  const confirmed = argv.includes('--confirm');
  const fromArg = argv.find((a) => a.startsWith('--from='));
  const toArg = argv.find((a) => a.startsWith('--to='));
  return {
    confirmed,
    from: fromArg ? Number(fromArg.split('=')[1]) : null,
    to: toArg ? Number(toArg.split('=')[1]) : null,
  };
}

function printDistribution(conn, label) {
  console.log(`\n--- ${label} ---`);
  console.log('branches:', conn.prepare('SELECT id, name, is_active FROM branches ORDER BY id').all());
  for (const table of BRANCH_ID_TABLES) {
    const exists = conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!exists) {
      console.log(`${table}: (テーブル未作成)`);
      continue;
    }
    const rows = conn.prepare(`SELECT branch_id, COUNT(*) AS c FROM ${table} GROUP BY branch_id`).all();
    console.log(`${table}:`, rows);
  }
}

// fromに紐づく全行をtoへ一方向に統合する(toの既存データには一切触れない)。
// 1トランザクションにまとめ、いずれかのテーブルでUNIQUE制約違反等が起きた場合は
// 全テーブル分をまとめてROLLBACKする(一部のテーブルだけ統合されるハーフウェイ状態を防ぐ)。
function moveBranchData(conn, from, to) {
  conn.exec('BEGIN');
  try {
    for (const table of BRANCH_ID_TABLES) {
      const exists = conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!exists) continue;
      conn.prepare(`UPDATE ${table} SET branch_id = :to WHERE branch_id = :from`).run({ to, from });
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.JUKU_BLOG_DB_PATH || path.join(__dirname, '..', 'data', 'posts.sqlite');

  if (!args.confirmed) {
    const conn = new DatabaseSync(DB_PATH, { readOnly: true });
    printDistribution(conn, '現状(dry-run、DBは変更していません)');
    conn.close();
    console.log(
      '\n[fix_swap_branch_ids][dry-run] 上記の分布を確認した上で、実際に統合するには' +
        ' --from=<空にする校舎のbranch_id> --to=<統合先の校舎のbranch_id> --confirm を指定してください。' +
        '(今回のインシデントでは --from=2 --to=1 を想定: あま本部(2)の全データを小幡校(1)へ統合し、' +
        'あま本部を完全に空の初期状態に戻す)'
    );
    return;
  }

  if (args.from === null || args.to === null || !Number.isInteger(args.from) || !Number.isInteger(args.to)) {
    console.error('[fix_swap_branch_ids] --confirm 指定時は --from=<branch_id> と --to=<branch_id> の両方が必要です');
    process.exitCode = 1;
    return;
  }
  if (args.from === args.to) {
    console.error('[fix_swap_branch_ids] --from と --to に同じbranch_idは指定できません');
    process.exitCode = 1;
    return;
  }

  const conn = new DatabaseSync(DB_PATH);
  try {
    printDistribution(conn, `補正前(branch_id=${args.from} の全データを branch_id=${args.to} へ統合します)`);
    moveBranchData(conn, args.from, args.to);
    printDistribution(conn, '補正後');
    console.log(
      `\n[fix_swap_branch_ids] branch_id=${args.from} の全データを branch_id=${args.to} へ統合しました。` +
        `branch_id=${args.from} は各テーブルとも0件になっているはずです。`
    );
  } finally {
    conn.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, moveBranchData, printDistribution, BRANCH_ID_TABLES };
