'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_HEARTBEATS_DIR = path.join(os.tmpdir(), `juku_blog_check_heartbeats_test_${process.pid}`);
process.env.JUKU_BLOG_ERRORS_PATH = path.join(os.tmpdir(), `juku_blog_check_heartbeats_errors_test_${process.pid}.json`);
process.env.JUKU_BLOG_KNOWN_CAUSES_PATH = path.join(os.tmpdir(), `juku_blog_check_heartbeats_causes_test_${process.pid}.yaml`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { recordHeartbeat, recordFirstSeenIfAbsent, readFirstSeenMap } = require('../scripts/lib/heartbeat');
const { writeErrors } = require('../scripts/log_error');
const { readIncident } = require('../scripts/lib/heartbeat');
const {
  checkBatches,
  trackIncidents,
  formatAlertText,
  formatMorningSummaryText,
  isQuietHours,
  shouldSendNow,
  collectDiagnosticText,
} = require('../scripts/check_batch_heartbeats');

after(() => {
  fs.rmSync(process.env.JUKU_BLOG_HEARTBEATS_DIR, { recursive: true, force: true });
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_ERRORS_PATH);
  } catch {
    // 既に無ければ無視
  }
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

// 反復アラートの深夜帯抑制・朝のまとめ通知(2026-08-08、8/7・8/8のOAuth失効インシデント
// 再発防止)。同一文面が深夜にも4時間おきに配信され続けて見落とされた反省から追加。

test('isQuietHours: JST 23:00は深夜帯(true)', () => {
  // 2026-08-07T23:00:00 JST = 2026-08-07T14:00:00Z
  assert.equal(isQuietHours(new Date('2026-08-07T14:00:00.000Z').getTime()), true);
});

test('isQuietHours: JST 05:59は深夜帯(true、06:00未満は含む)', () => {
  assert.equal(isQuietHours(new Date('2026-08-07T20:59:00.000Z').getTime()), true); // JST 08-08 05:59
});

test('isQuietHours: JST 06:00は深夜帯ではない(false、境界)', () => {
  assert.equal(isQuietHours(new Date('2026-08-07T21:00:00.000Z').getTime()), false); // JST 08-08 06:00
});

test('isQuietHours: JST 21:59は深夜帯ではない(false、境界)', () => {
  assert.equal(isQuietHours(new Date('2026-08-07T12:59:00.000Z').getTime()), false); // JST 21:59
});

test('isQuietHours: JST 12:00(日中)はfalse', () => {
  assert.equal(isQuietHours(new Date('2026-08-07T03:00:00.000Z').getTime()), false); // JST 12:00
});

test('shouldSendNow: 初回検知は深夜帯でも常に送信する', () => {
  const nightMs = new Date('2026-08-07T14:00:00.000Z').getTime(); // JST 23:00
  assert.equal(shouldSendNow({ isFirstDetection: true, isMorningSummary: false, nowMs: nightMs }), true);
});

test('shouldSendNow: 深夜帯の反復検知(初回でない)は抑制する', () => {
  const nightMs = new Date('2026-08-07T14:00:00.000Z').getTime(); // JST 23:00
  assert.equal(shouldSendNow({ isFirstDetection: false, isMorningSummary: false, nowMs: nightMs }), false);
});

test('shouldSendNow: 日中の反復検知は通常通り送信する', () => {
  const dayMs = new Date('2026-08-07T03:00:00.000Z').getTime(); // JST 12:00
  assert.equal(shouldSendNow({ isFirstDetection: false, isMorningSummary: false, nowMs: dayMs }), true);
});

test('shouldSendNow: 朝のまとめ通知は深夜帯抑制を無視して常に送信する', () => {
  const nightMs = new Date('2026-08-07T14:00:00.000Z').getTime(); // JST 23:00
  assert.equal(shouldSendNow({ isFirstDetection: false, isMorningSummary: true, nowMs: nightMs }), true);
});

test('formatAlertText: contextに反復回数・対処法があれば文面へ追記する(例のフォーマット再現)', () => {
  const text = formatAlertText(
    [{ name: 'daily_blog_all', label: '日次記事生成', status: 'last_run_failed', lastCompletedAt: '2026-08-07T21:00:18.104Z', detail: 'legacy ama-honbu 失敗' }],
    { daily_blog_all: { incident: { consecutiveDays: 2, detectionCount: 9 }, cause: { remedy: 'VPSで再ログインが必要' } } }
  );
  assert.match(text, /🚨 2日連続・通算9回目/);
  assert.match(text, /💡 対処: VPSで再ログインが必要/);
});

test('formatAlertText: contextを渡さない既存呼び出しは反復回数・対処法を付けない(後方互換)', () => {
  const text = formatAlertText([{ label: 'X', status: 'last_run_failed', lastCompletedAt: '2026-08-07T21:00:18.104Z', detail: 'y' }]);
  assert.ok(!text.includes('🚨') || !text.includes('日連続'));
  assert.ok(!text.includes('💡 対処'));
});

test('formatMorningSummaryText: 「未解決のままX時間経過」の文言になる', () => {
  const text = formatMorningSummaryText(
    [{ name: 'daily_blog_all', label: '日次記事生成', status: 'last_run_failed', ageHours: 18.456 }],
    { daily_blog_all: { incident: { consecutiveDays: 2, detectionCount: 9 }, cause: null } }
  );
  assert.match(text, /未解決のまま18\.5時間経過/);
  assert.match(text, /🚨 2日連続・通算9回目/);
  assert.match(text, /^🌅 朝のまとめ通知/);
});

test('collectDiagnosticText: heartbeat detailとlastCompletedAt前後のerrors.jsonのdetailをまとめて返す', () => {
  writeErrors([
    { at: '2026-08-07T20:59:00.000Z', step: 'researcher-local', detail: 'Failed to authenticate: OAuth session expired', branch_id: null, resolved: false },
    { at: '2026-08-06T00:00:00.000Z', step: 'unrelated_old', detail: '無関係な古いエラー', branch_id: null, resolved: false },
  ]);
  const text = collectDiagnosticText({ detail: '失敗校舎: legacy', lastCompletedAt: '2026-08-07T21:00:18.104Z' });
  assert.match(text, /失敗校舎: legacy/);
  assert.match(text, /OAuth session expired/);
  assert.ok(!text.includes('無関係な古いエラー'));
});

test('collectDiagnosticText: lastCompletedAtが無ければdetailのみ返す(never_recorded等)', () => {
  const text = collectDiagnosticText({ detail: undefined });
  assert.equal(text, '');
});

// trackIncidents: clearIncidentが実際に呼ばれる経路の回帰確認(2026-08-08、レビュー指摘)。
// 「検知でカウンタが増える→復旧を検知する→incident.jsonが消える→再failで1から再開する」を
// main()が実際にたどるのと同じtrackIncidents()経由で通しで検証する(sendTelegramは呼ばない
// ため実ネットワークなし)。

test('trackIncidents: 検知が続く間はdetectionCountが積み上がる', () => {
  const batchName = 'trackincidents_accumulate';
  const failing = [{ name: batchName, label: 'テストバッチ', status: 'last_run_failed', lastCompletedAt: '2026-08-07T21:00:00.000Z', detail: 'x' }];
  const first = trackIncidents(failing, '2026-08-07T21:00:05.000Z');
  assert.equal(first.context[batchName].isFirstDetection, true);
  assert.equal(first.context[batchName].incident.detectionCount, 1);

  const second = trackIncidents(failing, '2026-08-08T02:00:00.000Z');
  assert.equal(second.context[batchName].isFirstDetection, false);
  assert.equal(second.context[batchName].incident.detectionCount, 2);
});

test('trackIncidents: 復旧(status=ok)を検知するとincident.jsonが消える', () => {
  const batchName = 'trackincidents_recover';
  const failing = [{ name: batchName, label: 'テストバッチ', status: 'last_run_failed', lastCompletedAt: '2026-08-07T21:00:00.000Z', detail: 'x' }];
  trackIncidents(failing, '2026-08-07T21:00:05.000Z');
  trackIncidents(failing, '2026-08-08T01:00:00.000Z');
  assert.equal(readIncident(batchName).detectionCount, 2);

  const recovered = [{ name: batchName, label: 'テストバッチ', status: 'ok' }];
  trackIncidents(recovered, '2026-08-08T05:00:00.000Z');
  assert.equal(readIncident(batchName), null);
});

test('trackIncidents: 復旧後に再failするとdetectionCountが1から数え直しになる(実装がここを担保しているかの回帰テスト)', () => {
  const batchName = 'trackincidents_restart';
  const failing = [{ name: batchName, label: 'テストバッチ', status: 'last_run_failed', lastCompletedAt: '2026-08-07T21:00:00.000Z', detail: 'x' }];
  trackIncidents(failing, '2026-08-07T21:00:05.000Z');
  trackIncidents(failing, '2026-08-08T01:00:00.000Z');
  assert.equal(readIncident(batchName).detectionCount, 2);

  // 復旧
  trackIncidents([{ name: batchName, label: 'テストバッチ', status: 'ok' }], '2026-08-08T05:00:00.000Z');
  assert.equal(readIncident(batchName), null);

  // 別日に再度失敗 → 1から再開し、isFirstDetectionも再びtrueになる(新規インシデント扱い)
  const restarted = trackIncidents(failing, '2026-08-10T21:00:00.000Z');
  assert.equal(restarted.context[batchName].isFirstDetection, true);
  assert.equal(restarted.context[batchName].incident.detectionCount, 1);
  assert.equal(restarted.context[batchName].incident.consecutiveDays, 1);
});

test('trackIncidents: 複数バッチが混在しても互いのインシデントに影響しない', () => {
  const results = [
    { name: 'trackincidents_multi_a', label: 'A', status: 'last_run_failed', lastCompletedAt: '2026-08-07T21:00:00.000Z', detail: 'a' },
    { name: 'trackincidents_multi_b', label: 'B', status: 'ok' },
    { name: 'trackincidents_multi_c', label: 'C', status: 'pending_first_run' },
  ];
  const { problems, context } = trackIncidents(results, '2026-08-07T21:00:05.000Z');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].name, 'trackincidents_multi_a');
  assert.ok(context.trackincidents_multi_a);
  assert.equal(context.trackincidents_multi_b, undefined);
  assert.equal(context.trackincidents_multi_c, undefined);
});

// isQuietHours: JST日をまたぐ境界(22:00〜23:59、00:00〜05:59)とサーバTZ非依存性の確認
// (2026-08-08、レビュー指摘: 本番サーバのTZ設定に依存していないか)。

test('isQuietHours: JST 22:00ちょうど(深夜帯の開始境界)はtrue', () => {
  assert.equal(isQuietHours(new Date('2026-08-07T13:00:00.000Z').getTime()), true); // JST 22:00
});

test('isQuietHours: JST 23:59(日付が変わる直前)はtrue', () => {
  assert.equal(isQuietHours(new Date('2026-08-07T14:59:00.000Z').getTime()), true); // JST 23:59
});

test('isQuietHours: JST 00:00(日付をまたいだ直後)はtrue', () => {
  assert.equal(isQuietHours(new Date('2026-08-07T15:00:00.000Z').getTime()), true); // JST 08-08 00:00
});

test('isQuietHours: JST 05:00(深夜帯の終盤)はtrue', () => {
  assert.equal(isQuietHours(new Date('2026-08-07T20:00:00.000Z').getTime()), true); // JST 08-08 05:00
});

test('isQuietHours: サーバのprocess.env.TZ設定に依存しない(UTC設定でもJST 23:00をtrueと判定する)', () => {
  const originalTz = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    assert.equal(isQuietHours(new Date('2026-08-07T14:00:00.000Z').getTime()), true); // JST 23:00
    assert.equal(isQuietHours(new Date('2026-08-07T03:00:00.000Z').getTime()), false); // JST 12:00
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test('isQuietHours: process.env.TZ=America/New_Yorkでも同じ結果になる(サーバTZに依存しないことの確認)', () => {
  const originalTz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(isQuietHours(new Date('2026-08-07T14:00:00.000Z').getTime()), true); // JST 23:00
    assert.equal(isQuietHours(new Date('2026-08-07T21:00:00.000Z').getTime()), false); // JST 08-08 06:00(境界)
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});
