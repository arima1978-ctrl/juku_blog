'use strict';

// draftのfrontmatterにある episode_sources/parent_qa_sources が、実在する
// data/episodes.md / data/parent_qa.md のIDかどうかを検証し、citation_check として
// frontmatterに結果を保存する(石橋が「存在しない出典を確認済みとして扱う」ことを防ぐ)。
//
// 使い方: node scripts/check_citations.js data/drafts/2026-07-10-slug.md

const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { extractIds, validateCitations } = require('./lib/citations');
const { ROOT } = require('./lib/config');

function main() {
  const relOrAbs = process.argv[2];
  if (!relOrAbs) {
    console.error('使い方: node scripts/check_citations.js <draftファイルパス>');
    process.exit(1);
  }
  const filePath = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data: fm, content } = matter(raw);

  const episodesRaw = fs.readFileSync(path.join(ROOT, 'data', 'episodes.md'), 'utf8');
  const parentQaRaw = fs.readFileSync(path.join(ROOT, 'data', 'parent_qa.md'), 'utf8');

  const result = validateCitations(
    {
      episodeSources: fm.episode_sources || [],
      parentQaSources: fm.parent_qa_sources || [],
    },
    {
      episodeIds: extractIds(episodesRaw, 'EP'),
      parentQaIds: extractIds(parentQaRaw, 'QA'),
    }
  );

  const updated = matter.stringify(content, { ...fm, citation_check: result });
  fs.writeFileSync(filePath, updated, 'utf8');

  console.log(`[check_citations] ok=${result.ok}`);
  if (!result.ok) {
    console.log(
      `[check_citations] 存在しない出典ID: episode=${JSON.stringify(result.invalidEpisodeIds)} parent_qa=${JSON.stringify(result.invalidParentQaIds)}`
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
