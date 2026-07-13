'use strict';

// 取得対象URLの選定(sitemap優先、無ければ内部リンク探索)。
// 優先順位: 1.sitemap.xml 2.sitemap index 3.登録済みsitemap_url 4.start_urlからの内部リンク
// (ユーザー提示の取得優先順位に対応)。ネットワークに依存しない純粋関数として、
// クロールCLIから呼び出しやすいテスト可能な形にする。

const { normalizeUrl } = require('./url_normalize');

function sameDomain(urlString, domain) {
  try {
    const host = new URL(urlString).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

// sitemapLocs: sitemap.xml/sitemap indexから得たURL一覧(既に同一ドメインのみのことが多いが念のためフィルタする)
// startUrl / discoveredLinks: sitemapが無い場合のフォールバック(start_urlと、そこから見つかったリンク)
// domain: 許可ドメイン(競合登録情報のdomain)
// maxPages: 上限件数
function buildCrawlQueue({ sitemapLocs, startUrl, discoveredLinks, domain, maxPages }) {
  const seen = new Set();
  const queue = [];

  const tryAdd = (urlString) => {
    if (queue.length >= maxPages) return;
    if (!sameDomain(urlString, domain)) return;
    const normalized = normalizeUrl(urlString);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    queue.push(normalized);
  };

  if (sitemapLocs && sitemapLocs.length > 0) {
    sitemapLocs.forEach(tryAdd);
    return queue;
  }

  if (startUrl) tryAdd(startUrl);
  (discoveredLinks || []).forEach(tryAdd);
  return queue;
}

module.exports = { buildCrawlQueue, sameDomain };
