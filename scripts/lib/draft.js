'use strict';

const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { ROOT } = require('./config');

const DRAFTS_DIR = path.join(ROOT, 'data', 'drafts');

// data/drafts/{date}-{slug}.md (または校舎別 data/branches/<slug>/drafts/)
// にマッチする最新のドラフトを1件返す(1日1本生成の前提のため、通常は該当日のファイルは1件のみ)。
//
// 2026-07-17判明: 本関数は元々校舎を意識せず共有DRAFTS_DIRのみを見ていたため、
// daily_blog.sh <branch-slug> 実行時、赤羽・石橋・sync_draft_to_dbが常に共有
// data/drafts/ 配下の(無関係な)ファイルを対象にしてしまうバグがあった
// (あま本部校のテスト生成で実際に発生、当日中の小幡校の既存記事を誤って上書きしかけた
// インシデントの直接原因)。draftsDirを明示できるようにし、呼び出し側
// (get_draft_status.js)が校舎コンテキストに応じた正しいディレクトリを渡す。
function findDraftForDate(date, draftsDir = DRAFTS_DIR) {
  if (!fs.existsSync(draftsDir)) return null;
  const files = fs
    .readdirSync(draftsDir)
    .filter((f) => f.startsWith(`${date}-`) && f.endsWith('.md'))
    .sort();
  if (files.length === 0) return null;
  const filePath = path.join(draftsDir, files[files.length - 1]);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);
  return { filePath, frontmatter: data, content };
}

module.exports = { DRAFTS_DIR, findDraftForDate };
