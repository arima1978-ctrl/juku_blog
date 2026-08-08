'use strict';

// sendTelegram()のHTTPステータス・本文okフィールド検証(2026-08-08)。8/7・8/8の通知欠落
// 調査で、旧実装がレスポンスを最後まで受信できた時点で無条件に成功扱いしており、Telegram
// APIが200でも{ok:false}を返すケース(bot がグループから除外された等)を検知できないことが
// 判明した。evaluateTelegramResponse()は実ネットワークを使わない純粋関数として直接検証し、
// sendTelegram()自体の失敗時の警告・log_error.js連携は、https.requestをこのテスト内だけ
// モック化して(実ネットワークには一切出ない)配線を検証する。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const { EventEmitter } = require('node:events');
process.env.JUKU_BLOG_TELEGRAM_DEDUPE_PATH = path.join(os.tmpdir(), `juku_blog_telegram_validation_dedupe_test_${process.pid}.json`);
process.env.JUKU_BLOG_ERRORS_PATH = path.join(os.tmpdir(), `juku_blog_telegram_validation_errors_test_${process.pid}.json`);
process.env.TELEGRAM_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = 'test-chat-id';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { sendTelegram, evaluateTelegramResponse } = require('../scripts/lib/telegram');
const { readErrors } = require('../scripts/log_error');

after(() => {
  [process.env.JUKU_BLOG_TELEGRAM_DEDUPE_PATH, process.env.JUKU_BLOG_ERRORS_PATH].forEach((p) => {
    try {
      fs.unlinkSync(p);
    } catch {
      // 既に無ければ無視
    }
  });
});

test('evaluateTelegramResponse: HTTP 200かつok:trueは成功', () => {
  assert.deepEqual(evaluateTelegramResponse(200, JSON.stringify({ ok: true, result: {} })), { ok: true });
});

test('evaluateTelegramResponse: HTTP 200だがok:falseは失敗(実際にTelegramが返しうる形)', () => {
  const result = evaluateTelegramResponse(200, JSON.stringify({ ok: false, description: 'Forbidden: bot was kicked from the group chat' }));
  assert.equal(result.ok, false);
  assert.match(result.error, /Forbidden: bot was kicked/);
});

test('evaluateTelegramResponse: HTTP 401は失敗(トークン失効)', () => {
  const result = evaluateTelegramResponse(401, JSON.stringify({ ok: false, description: 'Unauthorized' }));
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 401/);
});

test('evaluateTelegramResponse: HTTP 400は失敗(chat_id不正等)', () => {
  const result = evaluateTelegramResponse(400, JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }));
  assert.equal(result.ok, false);
  assert.match(result.error, /chat not found/);
});

test('evaluateTelegramResponse: 本文がJSONとして壊れていても失敗として扱う(例外を投げない)', () => {
  const result = evaluateTelegramResponse(200, '<html>not json</html>');
  assert.equal(result.ok, false);
});

test('evaluateTelegramResponse: 空応答も失敗として扱う', () => {
  const result = evaluateTelegramResponse(500, '');
  assert.equal(result.ok, false);
  assert.match(result.error, /空の応答/);
});

// https.requestをこのテストの間だけ差し替える(実ネットワークには出ない)。
function withMockedHttpsRequest(statusCode, responseBody, run) {
  const original = https.request;
  https.request = (_options, callback) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      callback(res);
      process.nextTick(() => {
        res.emit('data', Buffer.from(responseBody));
        res.emit('end');
      });
    };
    return req;
  };
  return run().finally(() => {
    https.request = original;
  });
}

test('sendTelegram: HTTP 200だがok:falseならconsole.warnとlog_error.jsの両方に記録する', async () => {
  const uniqueText = `検証用テスト-失敗ケース-${Date.now()}`;
  await withMockedHttpsRequest(200, JSON.stringify({ ok: false, description: 'Forbidden: bot was kicked from the group chat' }), () =>
    sendTelegram(uniqueText)
  );
  const errors = readErrors();
  const recorded = errors.find((e) => e.step === 'telegram_send' && e.detail.includes('Forbidden: bot was kicked'));
  assert.ok(recorded, 'log_error.jsにtelegram_sendの失敗が記録されていること');
});

test('sendTelegram: HTTP 200かつok:trueならlog_error.jsに記録しない', async () => {
  const uniqueText = `検証用テスト-成功ケース-${Date.now()}`;
  const before = readErrors().length;
  await withMockedHttpsRequest(200, JSON.stringify({ ok: true, result: {} }), () => sendTelegram(uniqueText));
  const after2 = readErrors();
  assert.equal(after2.length, before);
});
