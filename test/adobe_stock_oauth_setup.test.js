'use strict';

// scripts/adobe_stock_oauth_setup.js(2026-07-30、アイキャッチ写真自動挿入機能Phase 1)の
// 純粋な部分(認可URL組み立て・.envへのトークン保存)のみをテストする。
// 実際のOAuthフロー(ブラウザでのログイン・トークン交換の実通信)は人間が手動で1回だけ
// 行うものであり自動テスト対象外(main()自体は呼ばない)。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { buildAuthorizeUrl, saveRefreshTokenToEnv, REDIRECT_URI } = require('../scripts/adobe_stock_oauth_setup');

test('buildAuthorizeUrl: client_id/scope/redirect_uri/response_type=codeを含むURLを組み立てる', () => {
  const url = buildAuthorizeUrl({ clientId: 'test-client-id', scope: 'openid,AdobeID,additional_info.stock' });
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://ims-na1.adobelogin.com');
  assert.equal(parsed.pathname, '/ims/authorize/v2');
  assert.equal(parsed.searchParams.get('client_id'), 'test-client-id');
  assert.equal(parsed.searchParams.get('scope'), 'openid,AdobeID,additional_info.stock');
  assert.equal(parsed.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(parsed.searchParams.get('response_type'), 'code');
});

test('REDIRECT_URI: ローカルの固定ポート(8734)/callbackであること(Developer Console側の登録値と一致させる必要がある)', () => {
  assert.equal(REDIRECT_URI, 'http://localhost:8734/callback');
});

const TMP_ENV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'juku_blog_adobe_stock_env_test_'));
const TMP_ENV_PATH = path.join(TMP_ENV_DIR, '.env');

after(() => {
  fs.rmSync(TMP_ENV_DIR, { recursive: true, force: true });
});

test('saveRefreshTokenToEnv: .envが無い場合は新規作成してADOBE_STOCK_REFRESH_TOKENを書き込む', () => {
  fs.rmSync(TMP_ENV_PATH, { force: true });
  saveRefreshTokenToEnv('first-token', TMP_ENV_PATH);
  const content = fs.readFileSync(TMP_ENV_PATH, 'utf8');
  assert.match(content, /ADOBE_STOCK_REFRESH_TOKEN=first-token/);
});

test('saveRefreshTokenToEnv: 既存の.envには追記し、他の値は変更しない', () => {
  fs.writeFileSync(TMP_ENV_PATH, 'WP_URL=https://example.com\nADOBE_STOCK_CLIENT_ID=abc\n', 'utf8');
  saveRefreshTokenToEnv('first-token', TMP_ENV_PATH);
  const content = fs.readFileSync(TMP_ENV_PATH, 'utf8');
  assert.match(content, /ADOBE_STOCK_REFRESH_TOKEN=first-token/);
  assert.match(content, /WP_URL=https:\/\/example\.com/, '既存の他の値は保持されるべき');
  assert.match(content, /ADOBE_STOCK_CLIENT_ID=abc/, '既存の他の値は保持されるべき');
});

test('saveRefreshTokenToEnv: 既にADOBE_STOCK_REFRESH_TOKENがある場合は上書き(行が重複しない)', () => {
  saveRefreshTokenToEnv('first-token', TMP_ENV_PATH);
  saveRefreshTokenToEnv('second-token', TMP_ENV_PATH);
  const content = fs.readFileSync(TMP_ENV_PATH, 'utf8');
  assert.match(content, /ADOBE_STOCK_REFRESH_TOKEN=second-token/);
  assert.doesNotMatch(content, /first-token/, '2回目の保存で上書きされ、古い値が残ってはいけない');
  assert.equal((content.match(/ADOBE_STOCK_REFRESH_TOKEN=/g) || []).length, 1, '行が重複してはいけない');
});
