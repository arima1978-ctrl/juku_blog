'use strict';

// 過去記事との類似度チェックをdraftに対して実行し、frontmatterに
// similarity_check として結果を保存する(石橋のファクトチェック前に実行する想定)。
//
// 使い方: node scripts/check_similarity.js data/drafts/2026-07-10-slug.md

const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { listPosts } = require('./lib/db');
const { checkSimilarity, extractHeadings } = require('./lib/similarity');
const { loadJukuConfig, ROOT } = require('./lib/config');
const { getBranchContext } = require('./lib/branch_context');

function main() {
  const relOrAbs = process.argv[2];
  if (!relOrAbs) {
    console.error('使い方: node scripts/check_similarity.js <draftファイルパス>');
    process.exit(1);
  }
  const filePath = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data: fm, content } = matter(raw);

  const candidate = {
    title: fm.title || '',
    headingsText: extractHeadings(content),
    body: content,
  };

  // 記事生成パイプラインの複数校舎対応Phase 1: 校舎コンテキストが有効な場合、
  // 過去記事の比較対象もその校舎のものだけに絞る(他校舎の記事と誤って
  // 重複判定してしまわないように。未指定時は従来通り全記事が対象)。
  const ctx = getBranchContext();
  const branchId = ctx.isLegacy ? undefined : ctx.branchId;

  // 自分自身(同一slug)が既にDB登録済みの場合、比較対象から除外する
  // (修正モードでの再チェック時に自己一致してis_duplicate=trueにならないように)
  const pastPosts = listPosts({ branchId }).filter((p) => p.slug !== fm.slug);

  const config = loadJukuConfig(branchId);
  const thresholds = (config.generation && config.generation.duplicate_threshold) || {};

  const result = checkSimilarity(candidate, pastPosts, thresholds);

  const updated = matter.stringify(content, { ...fm, similarity_check: result });
  fs.writeFileSync(filePath, updated, 'utf8');

  console.log(
    `[check_similarity] is_duplicate=${result.is_duplicate} highest_score=${result.highest_score} matched_post_id=${result.matched_post_id}`
  );
  if (result.is_duplicate) {
    console.log(
      `[check_similarity] 重複の疑いあり: "${result.matched_title}"(id=${result.matched_post_id})と類似度が高いです。石橋/人間の確認を推奨します`
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
