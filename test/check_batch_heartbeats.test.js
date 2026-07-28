'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_HEARTBEATS_DIR = path.join(os.tmpdir(), `juku_blog_check_heartbeats_test_${process.pid}`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { recordHeartbeat, recordFirstSeenIfAbsent, readFirstSeenMap } = require('../scripts/lib/heartbeat');
const { checkBatches, formatAlertText } = require('../scripts/check_batch_heartbeats');

after(() => {
  fs.rmSync(process.env.JUKU_BLOG_HEARTBEATS_DIR, { recursive: true, force: true });
});

const NOW = new Date('2026-07-27T12:00:00.000Z').getTime();

// 監視導入直後の猶予(2026-07-28、実インシデント回帰テスト): 週次バッチのように実行周期が
// maxAgeHoursと同程度長いバッチは、監視導入直後にheartbeatが1件も無い状態がしばらく続く。
// firstSeenMapを渡さない(まだ一度もこのバッチ名を観測したことがない)場合は
// pending_first_runとし、いきなりnever_recordedで警告してはいけない。

test('checkBatches: firstSeenMapに無い(初めて観測した)バッチはpending_first_run(警告しない)', () => {
  const results = checkBatches([{ name: 'unknown_batch', label: '未記録バッチ', maxAgeHours: 24 }], NOW, {});
  assert.equal(results[0].status, 'pending_first_run');
});

test('checkBatches: firstSeenMapにあり猶予(maxAgeHours)以内ならpending_first_run', () => {
  const results = checkBatches(
    [{ name: 'unknown_batch', label: '未記録バッチ', maxAgeHours: 24 }],
    NOW,
    { unknown_batch: '2026-07-27T00:00:00.000Z' } // 12時間前、猶予24時間以内
  );
  assert.equal(results[0].status, 'pending_first_run');
});

test('checkBatches: firstSeenMapにあり猶予(maxAgeHours)を過ぎればnever_recorded', () => {
  const results = checkBatches(
    [{ name: 'unknown_batch', label: '未記録バッチ', maxAgeHours: 24 }],
    NOW,
    { unknown_batch: '2026-07-25T00:00:00.000Z' } // 60時間前、猶予24時間を超過
  );
  assert.equal(results[0].status, 'never_recorded');
});

test('recordFirstSeenIfAbsent: 既存のバッチ名は上書きしない(冪等)', () => {
  const dir = process.env.JUKU_BLOG_HEARTBEATS_DIR;
  fs.mkdirSync(dir, { recursive: true });
  recordFirstSeenIfAbsent(['batch_x'], '2026-07-01T00:00:00.000Z');
  recordFirstSeenIfAbsent(['batch_x'], '2026-07-20T00:00:00.000Z'); // 後から呼んでも上書きされない
  assert.equal(readFirstSeenMap().batch_x, '2026-07-01T00:00:00.000Z');
});

test('checkBatches: maxAgeHours以内かつok=trueならok', () => {
  recordHeartbeat('fresh_batch', { ok: true, completedAt: '2026-07-27T10:00:00.000Z' }); // 2時間前
  const results = checkBatches([{ name: 'fresh_batch', label: '新鮮なバッチ', maxAgeHours: 24 }], NOW);
  assert.equal(results[0].status, 'ok');
});

test('checkBatches: maxAgeHoursを超えていればstale', () => {
  recordHeartbeat('stale_batch', { ok: true, completedAt: '2026-07-25T00:00:00.000Z' }); // 60時間前
  const results = checkBatches([{ name: 'stale_batch', label: '古いバッチ', maxAgeHours: 30 }], NOW);
  assert.equal(results[0].status, 'stale');
  assert.ok(results[0].ageHours > 30);
});

test('checkBatches: 期限内でもok=falseならlast_run_failed', () => {
  recordHeartbeat('failed_batch', { ok: false, detail: 'step Aが失敗', completedAt: '2026-07-27T10:00:00.000Z' });
  const results = checkBatches([{ name: 'failed_batch', label: '失敗したバッチ', maxAgeHours: 24 }], NOW);
  assert.equal(results[0].status, 'last_run_failed');
  assert.equal(results[0].detail, 'step Aが失敗');
});

test('formatAlertText: 各ステータスを日本語の1行に整形する', () => {
  const text = formatAlertText([
    { label: 'A', status: 'never_recorded' },
    { label: 'B', status: 'stale', lastCompletedAt: '2026-07-25T00:00:00.000Z', ageHours: 60, maxAgeHours: 30 },
    { label: 'C', status: 'last_run_failed', lastCompletedAt: '2026-07-27T10:00:00.000Z', detail: 'x' },
  ]);
  assert.match(text, /A: 一度も実行記録がありません/);
  assert.match(text, /B:.*60\.0時間前/);
  assert.match(text, /C:.*失敗していました - x/);
});
