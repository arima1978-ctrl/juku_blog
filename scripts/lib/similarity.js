'use strict';

// 過去記事との類似度チェック(軽量・外部ベクトルDB不使用)。
// 日本語は分かち書きライブラリなしで比較する必要があるため、文字bigramの
// Jaccard係数を採用する(形態素解析器等の新規依存を追加しない制約のため)。

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[「」『』【】()（）\[\]<>《》.,、。!！?？:：;；~〜"'"#*_`\-]/g, '');
}

function bigrams(text) {
  const s = normalize(text);
  const grams = new Set();
  if (s.length < 2) {
    if (s.length === 1) grams.add(s);
    return grams;
  }
  for (let i = 0; i < s.length - 1; i++) grams.add(s.slice(i, i + 2));
  return grams;
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const g of setA) {
    if (setB.has(g)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// 文字bigramのJaccard係数による類似度(0〜1)
function textSimilarity(a, b) {
  return jaccard(bigrams(a), bigrams(b));
}

// Markdown本文からh2/h3見出しを抽出し、1つの文字列に結合する
function extractHeadings(bodyMd) {
  const lines = (bodyMd || '').split('\n');
  const headings = lines
    .filter((l) => /^#{2,3}\s+/.test(l))
    .map((l) => l.replace(/^#{2,3}\s+/, '').trim());
  return headings.join(' ');
}

// candidate: { title, headingsText, body }
// pastPosts: [{ id, title, body_md }]
// thresholds: { title, headings, body }(0〜1。省略時は既定値)
function checkSimilarity(candidate, pastPosts, thresholds = {}) {
  const th = {
    title: thresholds.title ?? 0.8,
    headings: thresholds.headings ?? 0.75,
    body: thresholds.body ?? 0.7,
  };

  let best = { score: 0, postId: null, title: null, checks: { title: 0, headings: 0, body: 0 } };

  for (const post of pastPosts) {
    const checks = {
      title: Math.round(textSimilarity(candidate.title, post.title) * 100) / 100,
      headings: Math.round(textSimilarity(candidate.headingsText, extractHeadings(post.body_md)) * 100) / 100,
      body: Math.round(textSimilarity(candidate.body, post.body_md) * 100) / 100,
    };
    const maxCheck = Math.max(checks.title, checks.headings, checks.body);
    if (maxCheck > best.score) {
      best = { score: maxCheck, postId: post.id, title: post.title, checks };
    }
  }

  const isDuplicate = best.postId !== null && (
    best.checks.title >= th.title ||
    best.checks.headings >= th.headings ||
    best.checks.body >= th.body
  );

  return {
    is_duplicate: isDuplicate,
    highest_score: best.score,
    matched_post_id: best.postId,
    matched_title: best.title,
    checks: best.checks,
  };
}

module.exports = { normalize, bigrams, jaccard, textSimilarity, extractHeadings, checkSimilarity };
