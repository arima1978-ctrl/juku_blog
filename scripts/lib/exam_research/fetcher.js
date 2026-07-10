'use strict';

// 外部ページ・PDFの取得(node:https。追加のHTTPクライアント依存を増やさない)。
// robots.txt尊重・SSRF対策・レート制限・タイムアウト・リトライ上限・最大ダウンロード
// サイズ・重複アクセス回避・リダイレクト先ドメイン検証を行う。

const https = require('node:https');
const { assertUrlIsSafeToFetch, isAllowedDomain } = require('./ssrf_guard');
const { isAllowedByRobots, USER_AGENT } = require('./robots_guard');

const CONNECT_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 20_000;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const MIN_REQUEST_INTERVAL_MS = 3_000;
const MAX_RETRIES = 2;

// ホストごとの最終リクエスト時刻(同一プロセス内でのレート制限用)
const lastRequestAtByHost = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit(hostname) {
  const last = lastRequestAtByHost.get(hostname);
  if (last != null) {
    const elapsed = Date.now() - last;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
  }
  lastRequestAtByHost.set(hostname, Date.now());
}

// 生のバイナリ(Buffer)を返す単発リクエスト(リダイレクト・レート制限・SSRFチェック無し。内部用)
function rawGet(urlString) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT },
        timeout: CONNECT_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: new URL(res.headers.location, urlString).toString() });
          return;
        }

        const chunks = [];
        let total = 0;
        let settled = false;
        const readTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            req.destroy(new Error('読み込みタイムアウト'));
          }
        }, READ_TIMEOUT_MS);

        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            settled = true;
            clearTimeout(readTimer);
            req.destroy(new Error(`最大ダウンロードサイズ(${MAX_BYTES}バイト)を超過しました`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(readTimer);
          resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks), headers: res.headers });
        });
        res.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(readTimer);
          reject(err);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('接続タイムアウト')));
    req.on('error', reject);
    req.end();
  });
}

// httpGetText: robots_guard.jsから使う軽量ラッパー(robots.txt取得専用。SSRF/レート制限は
// 呼び出し元のfetchExternalUrl経由の取得と重複しないよう、ここでは簡易チェックのみ)
async function httpGetText(urlString) {
  const result = await rawGet(urlString);
  if (result.redirect) return httpGetText(result.redirect);
  if (result.statusCode >= 200 && result.statusCode < 300) return result.body.toString('utf8');
  throw new Error(`robots.txt取得が${result.statusCode}を返しました`);
}

// 取得失敗時は例外を投げず { ok: false, reason, errorCode } を返す(呼び出し元が
// 記事生成全体をクラッシュさせず警告として扱えるようにするため)。
// 成功時は { ok: true, statusCode, body(Buffer), contentType }
async function fetchExternalUrl(urlString, { allowedBaseUrls, sourceId } = {}) {
  const safety = await assertUrlIsSafeToFetch(urlString);
  if (!safety.ok) {
    return { ok: false, reason: safety.reason, errorCode: 'SSRF_BLOCKED' };
  }

  const baseUrl = `https://${new URL(urlString).hostname}/`;
  const allowed = await isAllowedByRobots(urlString, baseUrl, httpGetText);
  if (!allowed) {
    return { ok: false, reason: 'robots.txtにより取得が禁止されています', errorCode: 'ROBOTS_DISALLOWED' };
  }

  let currentUrl = urlString;
  let redirectCount = 0;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await waitForRateLimit(new URL(currentUrl).hostname);

      // eslint-disable-next-line no-await-in-loop
      let result = await rawGet(currentUrl);
      while (result.redirect) {
        redirectCount += 1;
        if (redirectCount > 5) {
          return { ok: false, reason: 'リダイレクトが多すぎます', errorCode: 'TOO_MANY_REDIRECTS' };
        }
        if (allowedBaseUrls && !isAllowedDomain(result.redirect, allowedBaseUrls)) {
          return {
            ok: false,
            reason: `リダイレクト先が許可ドメイン外です: ${result.redirect}`,
            errorCode: 'INVALID_REDIRECT_DOMAIN',
          };
        }
        const redirectSafety = await assertUrlIsSafeToFetch(result.redirect);
        if (!redirectSafety.ok) {
          return { ok: false, reason: redirectSafety.reason, errorCode: 'SSRF_BLOCKED' };
        }
        currentUrl = result.redirect;
        // eslint-disable-next-line no-await-in-loop
        result = await rawGet(currentUrl);
      }

      if (result.statusCode < 200 || result.statusCode >= 300) {
        return { ok: false, reason: `HTTP ${result.statusCode}`, errorCode: 'HTTP_ERROR', httpStatus: result.statusCode };
      }

      return {
        ok: true,
        statusCode: result.statusCode,
        body: result.body,
        contentType: (result.headers['content-type'] || '').toLowerCase(),
        finalUrl: currentUrl,
      };
    } catch (err) {
      lastError = err;
    }
  }

  return { ok: false, reason: lastError ? lastError.message : '不明なエラー', errorCode: 'FETCH_FAILED' };
}

module.exports = { fetchExternalUrl, MAX_BYTES, MIN_REQUEST_INTERVAL_MS };
