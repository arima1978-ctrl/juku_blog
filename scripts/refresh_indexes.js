'use strict';

// 智谷(planner-blog-btoc)がRead専用ツールだけで参照できるよう、
// posts.sqlite の内容を人間可読なJSONインデックスとして書き出す。
// daily_blog.sh から企画ステップの直前に必ず実行する。

const fs = require('node:fs');
const path = require('node:path');
const { listTitlesSince, listRejectedWithNotes } = require('./lib/db');
const { ROOT } = require('./lib/config');
const { getBranchContext } = require('./lib/branch_context');

const RECENT_DAYS = 90;

function main() {
  // 記事生成パイプラインの複数校舎対応Phase 1: 校舎コンテキストが有効な場合、
  // 出力先・対象データとも校舎別に分離する(未指定時は従来通りROOT直下、
  // 全校舎混在のまま。CLI/cronの既存挙動を変えないためのデフォルト)。
  const ctx = getBranchContext();
  const outDir = ctx.isLegacy ? path.join(ROOT, 'data') : ctx.dataDir;
  const branchId = ctx.isLegacy ? undefined : ctx.branchId;
  fs.mkdirSync(outDir, { recursive: true });

  const recentTitlesPath = path.join(outDir, 'recent_titles.json');
  const rejectedNotesPath = path.join(outDir, 'rejected_notes.json');

  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(recentTitlesPath, JSON.stringify(listTitlesSince(since, branchId), null, 2), 'utf8');
  fs.writeFileSync(rejectedNotesPath, JSON.stringify(listRejectedWithNotes(20, branchId), null, 2), 'utf8');
  console.log(`[refresh_indexes] ${recentTitlesPath} と ${rejectedNotesPath} を更新しました`);
}

main();
