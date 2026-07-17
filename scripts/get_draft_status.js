'use strict';

// 使い方: node scripts/get_draft_status.js YYYY-MM-DD
// 出力: "status\tfilePath" (見つからなければ status=not_found)
//
// 記事生成パイプラインの複数校舎対応: JUKU_BRANCH_ID/JUKU_BRANCH_SLUG(daily_blog.sh <slug>
// 実行時にexportされる)が設定されていれば、data/branches/<slug>/drafts/ を対象にする。
// 未設定(legacy)時は従来通り共有 data/drafts/ のまま(既存挙動を一切変えない)。
const path = require('node:path');
const { findDraftForDate, DRAFTS_DIR } = require('./lib/draft');
const { getBranchContext } = require('./lib/branch_context');

const date = process.argv[2];
if (!date) {
  console.error('使い方: node scripts/get_draft_status.js YYYY-MM-DD');
  process.exit(1);
}

const ctx = getBranchContext();
const draftsDir = ctx.isLegacy ? DRAFTS_DIR : path.join(ctx.dataDir, 'drafts');

const draft = findDraftForDate(date, draftsDir);
if (!draft) {
  console.log('not_found\t');
  process.exit(0);
}
console.log(`${draft.frontmatter.status || 'unknown'}\t${draft.filePath}`);
