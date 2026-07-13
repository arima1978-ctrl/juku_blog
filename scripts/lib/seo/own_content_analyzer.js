'use strict';

// 自社記事(posts)を競合ページと同じ抽出ロジック(keyword_extractor.js)で解析し、
// 正規化キーワードごとに「自社で最も強くカバーしている記事」の索引を作る。
// Gap判定(gap_classifier.js)のownHasArticle/ownContentThinnerThanCompetitorの
// 判定材料として使う。DBへ永続化はせず、週次バッチ実行時にオンメモリで組み立てる
// (自社記事数がposts.sqlite全件でも軽量に処理できる規模のため)。

const { extractKeywordCandidates } = require('./keyword_extractor');

// Markdown本文からh2/h3見出しを{level,text}配列として抽出する
// (scripts/lib/similarity.jsのextractHeadingsは1つの文字列に結合してしまうため、
// zone別重み付けに使えるようここでは分離した配列で返す)。
function parseMarkdownHeadings(bodyMd) {
  const headings = [];
  for (const line of (bodyMd || '').split('\n')) {
    const h3 = line.match(/^###\s+(.*)/);
    if (h3) {
      headings.push({ level: 'h3', text: h3[1].trim() });
      continue;
    }
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) headings.push({ level: 'h2', text: h2[1].trim() });
  }
  return headings;
}

function postToPage(post) {
  return {
    title: post.title || '',
    metaDescription: post.meta_description || '',
    headings: parseMarkdownHeadings(post.body_md),
    bodyText: post.body_md || '',
  };
}

// posts: scripts/lib/db.jsのlistPosts()結果
// 戻り値: Map<normalizedKeyword, { postId, title, slug, score, bodyLength }>
//   (同一キーワードを複数記事がカバーする場合はスコア最大の記事のみ残す)
function buildOwnCoverageIndex(posts, dictionaryEntries, weights, exclusionTerms = []) {
  const index = new Map();
  for (const post of posts) {
    const candidates = extractKeywordCandidates(postToPage(post), dictionaryEntries, weights, exclusionTerms);
    for (const candidate of candidates) {
      const existing = index.get(candidate.normalizedKeyword);
      if (!existing || candidate.score > existing.score) {
        index.set(candidate.normalizedKeyword, {
          postId: post.id,
          title: post.title,
          slug: post.slug,
          score: candidate.score,
          bodyLength: (post.body_md || '').length,
        });
      }
    }
  }
  return index;
}

function getOwnCoverage(index, normalizedKeyword) {
  return index.get(normalizedKeyword) || null;
}

// 自社記事が競合ページより明らかに情報量で劣るか(文字数ベースの簡易判定)。
// 判定材料が無ければnull(gap_classifier側は「不明」を「劣っているとはみなさない」扱いにする)。
function isOwnContentThinner(ownCoverage, competitorBodyLength, thinnerRatio = 0.6) {
  if (!ownCoverage || !competitorBodyLength) return null;
  return ownCoverage.bodyLength < competitorBodyLength * thinnerRatio;
}

module.exports = { parseMarkdownHeadings, buildOwnCoverageIndex, getOwnCoverage, isOwnContentThinner };
