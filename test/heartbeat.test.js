'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_HEARTBEATS_DIR = path.join(os.tmpdir(), `juku_blog_heartbeats_test_${process.pid}`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { recordHeartbeat, readHeartbeat } = require('../scripts/lib/heartbeat');

after(() => {
  fs.rmSync(process.env.JUKU_BLOG_HEARTBEATS_DIR, { recursive: true, force: true });
});

test('recordHeartbeat/readHeartbeat: 記録した内容をそのまま読み戻せる', () => {
  recordHeartbeat('test_batch', { ok: true, completedAt: '2026-07-27T00:00:00.000Z' });
  const hb = readHeartbeat('test_batch');
  assert.equal(hb.ok, true);
  assert.equal(hb.completedAt, '2026-07-27T00:00:00.000Z');
});

test('recordHeartbeat: ok省略時はtrue扱い', () => {
  recordHeartbeat('test_batch_default');
  const hb = readHeartbeat('test_batch_default');
  assert.equal(hb.ok, true);
});

test('recordHeartbeat: ok=falseとdetailを保存できる', () => {
  recordHeartbeat('test_batch_failed', { ok: false, detail: 'step Xが失敗' });
  const hb = readHeartbeat('test_batch_failed');
  assert.equal(hb.ok, false);
  assert.equal(hb.detail, 'step Xが失敗');
});

test('readHeartbeat: 記録が無いバッチ名はnullを返す', () => {
  assert.equal(readHeartbeat('never_recorded_batch'), null);
});
