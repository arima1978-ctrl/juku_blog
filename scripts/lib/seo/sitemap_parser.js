'use strict';

// sitemap.xml / sitemap index の解析。gzip圧縮sitemapはMVP対象外
// (対応が必要になった場合は取得側でContent-Encoding判定を追加すること)。

const cheerio = require('cheerio');

// sitemap index(<sitemapindex><sitemap><loc>...) なら { type: 'index', locs: [...] }
// 通常のsitemap(<urlset><url><loc>...) なら { type: 'urlset', locs: [...] }
// どちらでもない/解析失敗は { type: 'unknown', locs: [] }
function parseSitemapXml(xml) {
  let $;
  try {
    $ = cheerio.load(xml, { xmlMode: true });
  } catch {
    return { type: 'unknown', locs: [] };
  }

  const sitemapLocs = $('sitemapindex > sitemap > loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  if (sitemapLocs.length > 0) {
    return { type: 'index', locs: sitemapLocs };
  }

  const urlLocs = $('urlset > url > loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  if (urlLocs.length > 0) {
    return { type: 'urlset', locs: urlLocs };
  }

  return { type: 'unknown', locs: [] };
}

module.exports = { parseSitemapXml };
