'use strict';

// 使い方: node scripts/get_draft_status.js YYYY-MM-DD
// 出力: "status\tfilePath" (見つからなければ status=not_found)
const { findDraftForDate } = require('./lib/draft');

const date = process.argv[2];
if (!date) {
  console.error('使い方: node scripts/get_draft_status.js YYYY-MM-DD');
  process.exit(1);
}

const draft = findDraftForDate(date);
if (!draft) {
  console.log('not_found\t');
  process.exit(0);
}
console.log(`${draft.frontmatter.status || 'unknown'}\t${draft.filePath}`);
