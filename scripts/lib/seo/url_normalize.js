'use strict';

// URL正規化: fragmentとtrackingクエリを除去し、重複URLとして扱えるようにする。
// html_extract.jsが返すcanonicalUrl(あれば)を優先し、無ければこの正規化結果を使う。

const TRACKING_QUERY_PREFIXES = ['utm_'];
const TRACKING_QUERY_EXACT = new Set(['fbclid', 'gclid', 'yclid', 'msclkid', 'ref', 'source']);

function isTrackingParam(key) {
  const lower = key.toLowerCase();
  return TRACKING_QUERY_EXACT.has(lower) || TRACKING_QUERY_PREFIXES.some((p) => lower.startsWith(p));
}

// URLのfragmentとtrackingクエリを除去した正規化URLを返す。不正なURLはnull。
function normalizeUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  url.hash = '';
  const params = new URLSearchParams(url.search);
  const kept = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (!isTrackingParam(key)) kept.append(key, value);
  }
  kept.sort();
  url.search = kept.toString();
  return url.toString();
}

// ページ自身のcanonicalUrl(あれば)を優先し、無ければ取得URLを正規化して使う。
function resolveCanonicalUrl(fetchedUrl, canonicalUrlFromPage) {
  return normalizeUrl(canonicalUrlFromPage || fetchedUrl);
}

module.exports = { normalizeUrl, resolveCanonicalUrl, isTrackingParam };
