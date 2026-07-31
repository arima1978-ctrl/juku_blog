'use strict';

// Adobe Stock API 初回OAuth認証(2026-07-30、アイキャッチ写真自動挿入機能のPhase 1)。
// 一度だけ人間が手動で実行する対話式CLI。ローカルPC(ブラウザが使える環境)で実行すること
// (本番サーバーではなく、開発機やユーザーのPCで実行し、得られたADOBE_STOCK_REFRESH_TOKENの
// 値だけを本番の.envへ転記する運用を想定)。
//
// 事前準備(Adobe Developer Console): docs/adobe_stock_setup.mdの手順に従い、
// OAuth Web App認証情報(Client ID・Client Secret・Scope)を発行し、
// .envのADOBE_STOCK_CLIENT_ID/ADOBE_STOCK_CLIENT_SECRET/ADOBE_STOCK_SCOPEに設定してから
// このスクリプトを実行する。リダイレクトURIはこのスクリプトが待ち受ける
// http://localhost:8734/callback を、Developer Console側にも登録しておくこと。
//
// 使い方: node scripts/adobe_stock_oauth_setup.js

const http = require('node:http');
const { URL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./lib/config');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .envが無い場合はスキップ(既存の他スクリプトと同じ方針)
}

const PORT = 8734;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const IMS_HOST = 'https://ims-na1.adobelogin.com';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[adobe_stock_oauth_setup] .envに${name}が設定されていません。docs/adobe_stock_setup.mdの手順1を先に完了してください`);
    process.exit(1);
  }
  return value;
}

// .envファイルへ ADOBE_STOCK_REFRESH_TOKEN を追記/上書きする(既存の他の値は変更しない)。
// envPathはテスト時に一時ファイルへ差し替えられるよう引数化している(既定は本番の.env)。
function saveRefreshTokenToEnv(refreshToken, envPath = path.join(ROOT, '.env')) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `ADOBE_STOCK_REFRESH_TOKEN=${refreshToken}`;
  if (/^ADOBE_STOCK_REFRESH_TOKEN=.*$/m.test(content)) {
    content = content.replace(/^ADOBE_STOCK_REFRESH_TOKEN=.*$/m, line);
  } else {
    content = content.replace(/\s*$/, '') + `\n${line}\n`;
  }
  fs.writeFileSync(envPath, content, 'utf8');
}

async function exchangeCodeForTokens(code, clientId, clientSecret) {
  const res = await fetch(`${IMS_HOST}/ims/token/v3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`トークン交換に失敗しました: ${JSON.stringify(json)}`);
  }
  return json; // { access_token, refresh_token, ... }
}

async function verifyWithMemberProfile(accessToken, apiKey) {
  const res = await fetch('https://stock.adobe.io/Rest/Libraries/1/Member/Profile', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'x-api-key': apiKey,
      'x-product': 'juku_blog/1.0',
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Member Profile取得に失敗しました: ${JSON.stringify(json)}`);
  }
  return json;
}

function buildAuthorizeUrl({ clientId, scope }) {
  const authorizeUrl = new URL(`${IMS_HOST}/ims/authorize/v2`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('response_type', 'code');
  return authorizeUrl.toString();
}

function main() {
  const clientId = requireEnv('ADOBE_STOCK_CLIENT_ID');
  const clientSecret = requireEnv('ADOBE_STOCK_CLIENT_SECRET');
  const scope = requireEnv('ADOBE_STOCK_SCOPE');

  const authorizeUrl = buildAuthorizeUrl({ clientId, scope });

  console.log('\n以下のURLをブラウザで開き、Adobeアカウントでログイン・許可してください:\n');
  console.log(authorizeUrl);
  console.log(`\n(このスクリプトはローカルの http://localhost:${PORT} でリダイレクトを待機します)\n`);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/callback') {
      res.writeHead(404);
      res.end();
      return;
    }
    const code = url.searchParams.get('code');
    const errorParam = url.searchParams.get('error');
    if (errorParam) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Adobe側でエラーが返されました: ${errorParam}。ターミナルを確認してください。`);
      console.error(`[adobe_stock_oauth_setup] Adobe側でエラー: ${errorParam}`);
      server.close();
      process.exit(1);
    }
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('codeパラメータがありません');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('認証を受け付けました。このタブは閉じてターミナルに戻ってください。');

    try {
      console.log('[adobe_stock_oauth_setup] 認可コードを受け取りました。トークンと交換しています...');
      const tokens = await exchangeCodeForTokens(code, clientId, clientSecret);
      if (!tokens.refresh_token) {
        throw new Error('レスポンスにrefresh_tokenが含まれていません(scopeにoffline_accessが必要な場合があります)');
      }
      saveRefreshTokenToEnv(tokens.refresh_token);
      console.log('[adobe_stock_oauth_setup] .envにADOBE_STOCK_REFRESH_TOKENを保存しました');

      console.log('[adobe_stock_oauth_setup] 動作確認のためMember Profileを取得しています...');
      const profile = await verifyWithMemberProfile(tokens.access_token, clientId);
      console.log('[adobe_stock_oauth_setup] 取得成功。プラン枠の情報:');
      console.log(JSON.stringify(profile.available_entitlement || profile, null, 2));
      console.log('\n[adobe_stock_oauth_setup] 完了しました。この結果を貼り付けて報告してください。');
    } catch (err) {
      console.error(`[adobe_stock_oauth_setup] 失敗しました: ${err.message}`);
    } finally {
      server.close();
    }
  });

  server.listen(PORT);
}

if (require.main === module) {
  main();
}

module.exports = { exchangeCodeForTokens, saveRefreshTokenToEnv, buildAuthorizeUrl, REDIRECT_URI };
