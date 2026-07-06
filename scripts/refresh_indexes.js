'use strict';

// 智谷(planner-blog-btoc)がRead専用ツールだけで参照できるよう、
// posts.sqlite の内容を人間可読なJSONインデックスとして書き出す。
// daily_blog.sh から企画ステップの直前に必ず実行する。

const fs = require('node:fs');
const path = require('node:path');
const { listTitlesSince, listRejectedWithNotes } = require('./lib/db');
const { ROOT } = require('./lib/config');

const RECENT_TITLES_PATH = path.join(ROOT, 'data', 'recent_titles.json');
const REJECTED_NOTES_PATH = path.join(ROOT, 'data', 'rejected_notes.json');
const RECENT_DAYS = 90;

function main() {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(RECENT_TITLES_PATH, JSON.stringify(listTitlesSince(since), null, 2), 'utf8');
  fs.writeFileSync(REJECTED_NOTES_PATH, JSON.stringify(listRejectedWithNotes(20), null, 2), 'utf8');
  console.log('[refresh_indexes] data/recent_titles.json と data/rejected_notes.json を更新しました');
}

main();
