'use strict';

// 競合ページのHTML解析。scripts/lib/exam_research/html_extract.jsのtitle/body抽出を
// 踏襲しつつ、SEO用途向けにmeta description・H1〜H3・canonical・内部リンクの抽出を追加する。

const cheerio = require('cheerio');

// 本文と誤認しやすい定型ブロックを除去してから本文テキストを取り出す。
const NOISE_SELECTOR = 'script, style, nav, header, footer, aside, noscript';

function collapseWhitespace(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// title/meta description/H1-H3/本文/canonical/内部リンクを抽出する。
// baseUrl はリンクの絶対URL解決とcanonical判定に使う。
function extractFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  $(NOISE_SELECTOR).remove();

  const title = collapseWhitespace($('title').first().text());
  const metaDescription = collapseWhitespace($('meta[name="description"]').attr('content') || '');

  let canonicalUrl = null;
  const canonicalHref = $('link[rel="canonical"]').attr('href');
  if (canonicalHref) {
    try {
      canonicalUrl = new URL(canonicalHref, baseUrl).toString();
    } catch {
      canonicalUrl = null;
    }
  }

  const headings = [];
  $('h1, h2, h3').each((_, el) => {
    const level = el.tagName.toLowerCase();
    const text = collapseWhitespace($(el).text());
    if (text) headings.push({ level, text });
  });

  const bodyText = collapseWhitespace($('body').text());

  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    try {
      const abs = new URL(href, baseUrl);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') {
        abs.hash = ''; // URL fragmentを除外
        links.add(abs.toString());
      }
    } catch {
      // 不正なhrefは無視
    }
  });

  return {
    title,
    metaDescription,
    canonicalUrl,
    headings,
    bodyText,
    links: Array.from(links),
  };
}

module.exports = { extractFromHtml };
