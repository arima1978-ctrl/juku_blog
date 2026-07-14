'use strict';

// 校舎ページ本文の取得(pageContext生成)。既存のfetcher.js(SSRF対策・robots.txt尊重・
// レート制限・リダイレクト検証込み)とhtml_extract.jsのみを使う。
// 新しいHTTPクライアント・SSRF処理・robots処理・HTMLパーサーは追加しない。
// DB保存・キャッシュ・一時ファイル保存は一切行わない(呼び出しの都度、都度取得するだけ)。

const crypto = require('node:crypto');
const { fetchExternalUrl } = require('./fetcher');
const { extractFromHtml } = require('./html_extract');

const BODY_EXCERPT_LENGTH = 1500;

// fetchExternalUrlのerrorCodeを、pageContextのstatus語彙(blocked/fetch_failed)へ
// マッピングする。ROBOTS_DISALLOWED/SSRF_BLOCKED/DOMAIN_NOT_ALLOWED/INVALID_REDIRECT_DOMAIN
// は「意図的なブロック」、それ以外(未知のerrorCode含む)は安全側に倒してfetch_failedとする。
const BLOCKED_ERROR_CODES = new Set([
  'ROBOTS_DISALLOWED',
  'SSRF_BLOCKED',
  'DOMAIN_NOT_ALLOWED',
  'INVALID_REDIRECT_DOMAIN',
]);

function contentHashOf(normalizedBodyText) {
  return crypto.createHash('sha256').update(normalizedBodyText, 'utf8').digest('hex');
}

// url: 取得対象URL(Taskに登録された元URL)。options: fetchExternalUrlへ渡すオプション
// (allowedBaseUrls/userAgent/timeoutMs/intervalMs/maxRetries)。
// fetchFnは注入可能(テスト時に実ネットワーク接続を避けるため。既定は実際のfetchExternalUrl)。
async function fetchPageContext(url, options, { fetchFn = fetchExternalUrl } = {}) {
  const result = await fetchFn(url, options);

  if (!result.ok) {
    const status = BLOCKED_ERROR_CODES.has(result.errorCode) ? 'blocked' : 'fetch_failed';
    return {
      status,
      url,
      finalUrl: result.finalUrl || null,
      reason: result.reason,
      errorCode: result.errorCode,
    };
  }

  const html = result.body.toString('utf8');
  const finalUrl = result.finalUrl || url;
  const extracted = extractFromHtml(html, finalUrl);

  // extractFromHtml内部のcollapseWhitespace()で既に前後空白除去・連続空白/改行の正規化済み。
  const normalizedBodyText = extracted.bodyText || '';

  if (!normalizedBodyText) {
    return { status: 'empty', url, finalUrl };
  }

  const headings = (extracted.headings || [])
    .filter((h) => h.level === 'h1' || h.level === 'h2')
    .map((h) => h.text);

  return {
    status: 'fetched',
    url,
    finalUrl,
    title: extracted.title || null,
    headings,
    bodyExcerpt: normalizedBodyText.slice(0, BODY_EXCERPT_LENGTH),
    fetchedAt: new Date().toISOString(),
    contentHash: contentHashOf(normalizedBodyText),
  };
}

module.exports = { fetchPageContext, BODY_EXCERPT_LENGTH, BLOCKED_ERROR_CODES };
