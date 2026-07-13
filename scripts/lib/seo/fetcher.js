'use strict';

// 競合サイトの取得(node:https。追加のHTTPクライアント依存を増やさない)。
// robots.txt尊重・SSRF対策・レート制限・タイムアウト・リトライ上限・最大ダウンロード
// サイズ・リダイレクト先ドメイン検証を行う。
//
// SSRFガードは scripts/lib/exam_research/ssrf_guard.js のものをそのまま再利用する
// (ドメイン非依存の汎用実装のため。愛知県高校入試機能側は変更しない)。
// robots_guard/User-Agent/タイムアウト/レート制限/リトライ回数は競合分析専用に
// 一般化し、config/juku.yamlのseo.competitor_analysisから値を受け取る(ハードコード禁止)。

const https = require('node:https');
const { assertUrlIsSafeToFetch, isAllowedDomain } = require('../exam_research/ssrf_guard');
const { isAllowedByRobots } = require('./robots_guard');

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_REDIRECTS = 5;

// ホストごとの最終リクエスト時刻(同一プロセス内でのレート制限用)。
// 単一プロセス・週次バッチ前提のため永続化しない(分散実行する場合は要拡張)。
const lastRequestAtByHost = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit(hostname, intervalMs) {
  const last = lastRequestAtByHost.get(hostname);
  if (last != null) {
    const elapsed = Date.now() - last;
    if (elapsed < intervalMs) {
      await sleep(intervalMs - elapsed);
    }
  }
  lastRequestAtByHost.set(hostname, Date.now());
}

function rawGet(urlString, { userAgent, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { 'User-Agent': userAgent },
        timeout: timeoutMs,
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
        }, timeoutMs);

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

// robots_guard.jsから使う軽量ラッパー(robots.txt取得専用)
async function httpGetText(urlString, options) {
  const result = await rawGet(urlString, options);
  if (result.redirect) return httpGetText(result.redirect, options);
  if (result.statusCode >= 200 && result.statusCode < 300) return result.body.toString('utf8');
  throw new Error(`robots.txt取得が${result.statusCode}を返しました`);
}

// 取得失敗時は例外を投げず { ok: false, reason, errorCode } を返す(呼び出し元が
// 週次バッチ全体・記事生成をクラッシュさせず警告として扱えるようにするため)。
// 成功時は { ok: true, statusCode, body(Buffer), contentType, finalUrl }
//
// options:
//   allowedBaseUrls: 許可ドメイン(登録済み競合のbase_url等)。未指定なら検証しない。
//   userAgent, timeoutMs, intervalMs, maxRetries: config/juku.yamlのseo.competitor_analysisから渡す
async function fetchExternalUrl(urlString, options) {
  const { allowedBaseUrls, userAgent, timeoutMs, intervalMs, maxRetries } = options;

  const safety = await assertUrlIsSafeToFetch(urlString);
  if (!safety.ok) {
    return { ok: false, reason: safety.reason, errorCode: 'SSRF_BLOCKED' };
  }
  if (allowedBaseUrls && !isAllowedDomain(urlString, allowedBaseUrls)) {
    return { ok: false, reason: `許可ドメイン外です: ${urlString}`, errorCode: 'DOMAIN_NOT_ALLOWED' };
  }

  const baseUrl = `https://${new URL(urlString).hostname}/`;
  const allowed = await isAllowedByRobots(urlString, baseUrl, (u) => httpGetText(u, { userAgent, timeoutMs }), userAgent);
  if (!allowed) {
    return { ok: false, reason: 'robots.txtにより取得が禁止されています', errorCode: 'ROBOTS_DISALLOWED' };
  }

  let currentUrl = urlString;
  let redirectCount = 0;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await waitForRateLimit(new URL(currentUrl).hostname, intervalMs);

      let result = await rawGet(currentUrl, { userAgent, timeoutMs });
      while (result.redirect) {
        redirectCount += 1;
        if (redirectCount > MAX_REDIRECTS) {
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
        result = await rawGet(currentUrl, { userAgent, timeoutMs });
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

module.exports = { fetchExternalUrl, MAX_BYTES };
