'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_HEARTBEATS_DIR = path.join(os.tmpdir(), `juku_blog_heartbeats_test_${process.pid}`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { recordHeartbeat, readHeartbeat, recordFailureDetection, readIncident, clearIncident } = require('../scripts/lib/heartbeat');

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

// 反復アラートの通算検知回数・連続検知日数(2026-08-08、8/7・8/8のOAuth失効インシデント
// 再発防止)。「🚨 2日連続・通算9回目」のようにアラート文面へ埋め込むための土台。

test('recordFailureDetection: 初回検知はdetectionCount=1・consecutiveDays=1', () => {
  const result = recordFailureDetection('incident_batch', '2026-08-07T21:00:00.000Z');
  assert.equal(result.detectionCount, 1);
  assert.equal(result.consecutiveDays, 1);
  assert.equal(result.firstDetectedAt, '2026-08-07T21:00:00.000Z');
});

test('recordFailureDetection: 同じJST日内の再検知はconsecutiveDaysを増やさずdetectionCountのみ加算', () => {
  const dir = process.env.JUKU_BLOG_HEARTBEATS_DIR;
  fs.mkdirSync(dir, { recursive: true });
  clearIncident('same_day_batch');
  recordFailureDetection('same_day_batch', '2026-08-07T21:00:00.000Z'); // JST 08-08 06:00
  const second = recordFailureDetection('same_day_batch', '2026-08-08T01:00:00.000Z'); // JST 08-08 10:00 (同日)
  assert.equal(second.detectionCount, 2);
  assert.equal(second.consecutiveDays, 1);
});

test('recordFailureDetection: 実インシデント回帰(8/7 6回+8/8 3回=通算9回・2日連続)', () => {
  clearIncident('daily_blog_all');
  // 8/7 JST(UTC 08-06T21:00〜08-07T20:00台)の4時間おき6回検知
  ['2026-08-06T21:00:00Z', '2026-08-07T02:00:00Z', '2026-08-07T06:00:00Z', '2026-08-07T10:00:00Z', '2026-08-07T14:00:00Z', '2026-08-07T18:00:00Z'].forEach(
    (t) => recordFailureDetection('daily_blog_all', t)
  );
  // 8/8 JST(UTC 08-07T21:00〜)の3回検知
  const final = ['2026-08-07T21:00:00Z', '2026-08-08T02:00:00Z', '2026-08-08T06:00:00Z'].reduce(
    (_, t) => recordFailureDetection('daily_blog_all', t),
    null
  );
  assert.equal(final.detectionCount, 9);
  assert.equal(final.consecutiveDays, 2);
});

test('readIncident/clearIncident: 解消後はclearIncidentで消え、次回検知時にdetectionCountが1から再開する', () => {
  clearIncident('resolved_batch');
  recordFailureDetection('resolved_batch', '2026-08-01T00:00:00.000Z');
  recordFailureDetection('resolved_batch', '2026-08-01T04:00:00.000Z');
  assert.equal(readIncident('resolved_batch').detectionCount, 2);
  clearIncident('resolved_batch');
  assert.equal(readIncident('resolved_batch'), null);
  const restarted = recordFailureDetection('resolved_batch', '2026-08-05T00:00:00.000Z');
  assert.equal(restarted.detectionCount, 1);
});

test('clearIncident: 記録が無い状態で呼んでもエラーにならない', () => {
  assert.doesNotThrow(() => clearIncident('never_had_incident'));
});

test('recordHeartbeat: ok=trueで記録すると既存のincidentが即座にクリアされる(check_batch_heartbeatsの次回チェックを待たない)', () => {
  const batchName = 'record_heartbeat_clears_incident';
  recordFailureDetection(batchName, '2026-08-07T21:00:00.000Z');
  assert.equal(readIncident(batchName).detectionCount, 1);
  recordHeartbeat(batchName, { ok: true, completedAt: '2026-08-08T20:00:00.000Z' });
  assert.equal(readIncident(batchName), null);
});

test('recordHeartbeat: ok=falseで記録してもincidentはクリアしない', () => {
  const batchName = 'record_heartbeat_keeps_incident_on_failure';
  recordFailureDetection(batchName, '2026-08-07T21:00:00.000Z');
  recordHeartbeat(batchName, { ok: false, completedAt: '2026-08-08T20:00:00.000Z' });
  assert.equal(readIncident(batchName).detectionCount, 1);
});
