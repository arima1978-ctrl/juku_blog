'use strict';

// scripts/notify_batch_failure.js(2026-08-08): daily_blog_all.shが自ら即座に送る失敗通知に、
// check_batch_heartbeats.jsと同じ通算検知回数・連続日数・既知原因の対処法を載せられているかを
// 検証する。実ネットワークには出ず、https.requestをこのテストの間だけ差し替える。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const { EventEmitter } = require('node:events');
process.env.JUKU_BLOG_HEARTBEATS_DIR = path.join(os.tmpdir(), `juku_blog_notify_batch_failure_hb_test_${process.pid}`);
process.env.JUKU_BLOG_TELEGRAM_DEDUPE_PATH = path.join(os.tmpdir(), `juku_blog_notify_batch_failure_dedupe_test_${process.pid}.json`);
process.env.JUKU_BLOG_ERRORS_PATH = path.join(os.tmpdir(), `juku_blog_notify_batch_failure_errors_test_${process.pid}.json`);
process.env.JUKU_BLOG_KNOWN_CAUSES_PATH = path.join(os.tmpdir(), `juku_blog_notify_batch_failure_causes_test_${process.pid}.yaml`);
process.env.TELEGRAM_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = 'test-chat-id';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { writeErrors } = require('../scripts/log_error');
const { readIncident } = require('../scripts/lib/heartbeat');
const { main } = require('../scripts/notify_batch_failure');

fs.writeFileSync(
  process.env.JUKU_BLOG_KNOWN_CAUSES_PATH,
  'known_causes:\n  - id: claude_oauth_expired\n    pattern: "OAuth session expired"\n    remedy: "VPSでclaudeの再ログインが必要です"\n',
  'utf8'
);

after(() => {
  fs.rmSync(process.env.JUKU_BLOG_HEARTBEATS_DIR, { recursive: true, force: true });
  [process.env.JUKU_BLOG_TELEGRAM_DEDUPE_PATH, process.env.JUKU_BLOG_ERRORS_PATH, process.env.JUKU_BLOG_KNOWN_CAUSES_PATH].forEach((p) => {
    try {
      fs.unlinkSync(p);
    } catch {
      // 既に無ければ無視
    }
  });
});

let capturedPayload = null;
function withMockedHttpsRequest(run) {
  const original = https.request;
  https.request = (_options, callback) => {
    const res = new EventEmitter();
    res.statusCode = 200;
    const req = new EventEmitter();
    req.write = (body) => {
      capturedPayload = JSON.parse(body);
    };
    req.end = () => {
      callback(res);
      process.nextTick(() => {
        res.emit('data', Buffer.from(JSON.stringify({ ok: true, result: {} })));
        res.emit('end');
      });
    };
    return req;
  };
  return run().finally(() => {
    https.request = original;
  });
}

test('main: 引数不足はエラー終了する(実送信しない)', async () => {
  const before = capturedPayload;
  await main([]);
  assert.equal(capturedPayload, before);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0; // このテストファイル全体の終了コードに影響させない
});

test('main: 既知原因パターンにマッチするエラーがあれば対処法を文面へ載せる', async () => {
  writeErrors([{ at: new Date().toISOString(), step: 'researcher-local', detail: 'Failed to authenticate: OAuth session expired', branch_id: null, resolved: false }]);
  await withMockedHttpsRequest(() => main(['notify_batch_failure_test_a', '⚠️ テスト失敗通知']));
  assert.match(capturedPayload.text, /💡 対処: VPSでclaudeの再ログインが必要です/);
});

test('main: 通算検知回数・連続日数を文面へ載せ、実際にheartbeat.jsのインシデントへ記録する', async () => {
  await withMockedHttpsRequest(() => main(['notify_batch_failure_test_b', '⚠️ 1回目']));
  assert.match(capturedPayload.text, /🚨 1日連続・通算1回目/);
  assert.equal(readIncident('notify_batch_failure_test_b').detectionCount, 1);

  await withMockedHttpsRequest(() => main(['notify_batch_failure_test_b', '⚠️ 2回目']));
  assert.match(capturedPayload.text, /🚨 1日連続・通算2回目/);
});
