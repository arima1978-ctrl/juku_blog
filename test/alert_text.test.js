'use strict';

// バッチ監視アラートの文面組み立て共有ロジック(2026-08-08)。check_batch_heartbeats.jsと
// notify_batch_failure.jsの両方が使うため、単体で直接検証する。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_ERRORS_PATH = path.join(os.tmpdir(), `juku_blog_alert_text_errors_test_${process.pid}.json`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { writeErrors } = require('../scripts/log_error');
const { collectRelatedErrorText, appendIncidentAndCause } = require('../scripts/lib/alert_text');

after(() => {
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_ERRORS_PATH);
  } catch {
    // 既に無ければ無視
  }
});

test('collectRelatedErrorText: referenceIso前後のerrors.jsonのdetailをbaseTextに合わせて返す', () => {
  writeErrors([
    { at: '2026-08-07T20:30:00.000Z', step: 'researcher-local', detail: 'Failed to authenticate: OAuth session expired', branch_id: null, resolved: false },
    { at: '2026-08-01T00:00:00.000Z', step: 'unrelated', detail: '無関係な古いエラー', branch_id: null, resolved: false },
  ]);
  const text = collectRelatedErrorText('失敗校舎: legacy', '2026-08-07T21:00:00.000Z');
  assert.match(text, /失敗校舎: legacy/);
  assert.match(text, /OAuth session expired/);
  assert.ok(!text.includes('無関係な古いエラー'));
});

test('collectRelatedErrorText: referenceIso省略時はbaseTextのみ返す', () => {
  writeErrors([{ at: '2026-08-07T20:30:00.000Z', step: 'x', detail: '何か', branch_id: null, resolved: false }]);
  assert.equal(collectRelatedErrorText('本文のみ'), '本文のみ');
});

test('appendIncidentAndCause: incident.consecutiveDaysが0以下なら反復回数の行を付けない', () => {
  const text = appendIncidentAndCause('ベース行', { incident: { consecutiveDays: 0, detectionCount: 0 } });
  assert.equal(text, 'ベース行');
});

test('appendIncidentAndCause: incidentとcauseの両方があれば両方追記する', () => {
  const text = appendIncidentAndCause('ベース行', { incident: { consecutiveDays: 2, detectionCount: 9 }, cause: { remedy: '対処法テキスト' } });
  assert.match(text, /🚨 2日連続・通算9回目/);
  assert.match(text, /💡 対処: 対処法テキスト/);
});

test('appendIncidentAndCause: 引数省略時はベース行をそのまま返す', () => {
  assert.equal(appendIncidentAndCause('ベース行'), 'ベース行');
});
