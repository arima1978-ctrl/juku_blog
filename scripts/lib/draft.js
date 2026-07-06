'use strict';

const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { ROOT } = require('./config');

const DRAFTS_DIR = path.join(ROOT, 'data', 'drafts');

// data/drafts/{date}-{slug}.md にマッチする最新のドラフトを1件返す
// (1日1本生成の前提のため、通常は該当日のファイルは1件のみ)
function findDraftForDate(date) {
  if (!fs.existsSync(DRAFTS_DIR)) return null;
  const files = fs
    .readdirSync(DRAFTS_DIR)
    .filter((f) => f.startsWith(`${date}-`) && f.endsWith('.md'))
    .sort();
  if (files.length === 0) return null;
  const filePath = path.join(DRAFTS_DIR, files[files.length - 1]);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);
  return { filePath, frontmatter: data, content };
}

module.exports = { DRAFTS_DIR, findDraftForDate };
