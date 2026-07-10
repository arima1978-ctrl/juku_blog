'use strict';

const cheerio = require('cheerio');

// HTMLからテキスト本文(script/style除去済み)とPDFリンク一覧を抽出する。
function extractFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer').remove();

  const title = $('title').first().text().trim();
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  const pdfLinks = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !/\.pdf(\?|#|$)/i.test(href)) return;
    let absolute;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (seen.has(absolute)) return;
    seen.add(absolute);
    pdfLinks.push({ url: absolute, linkText: $(el).text().trim() });
  });

  return { title, text, pdfLinks };
}

module.exports = { extractFromHtml };
