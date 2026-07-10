'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideSyncAction } = require('../scripts/lib/wp_sync');

test('decideSyncAction: future(予約中のまま)は変化なし', () => {
  const result = decideSyncAction('scheduled', { status: 'future' });
  assert.equal(result.newLocalStatus, 'scheduled');
  assert.equal(result.syncError, null);
  assert.equal(result.needsAlert, false);
});

test('decideSyncAction: publishになったらscheduled→publishedへ自動遷移', () => {
  const result = decideSyncAction('scheduled', { status: 'publish' });
  assert.equal(result.newLocalStatus, 'published');
  assert.equal(result.needsAlert, false);
});

test('decideSyncAction: 既にpublishedならpublishのままでもstatusは変えない', () => {
  const result = decideSyncAction('published', { status: 'publish' });
  assert.equal(result.newLocalStatus, 'published');
});

test('decideSyncAction: not_found(記事消失)はstatusを変えずアラートを出す', () => {
  const result = decideSyncAction('scheduled', { status: 'not_found' });
  assert.equal(result.newLocalStatus, 'scheduled');
  assert.equal(result.needsAlert, true);
  assert.match(result.syncError, /見つかりません/);
});

test('decideSyncAction: trashはアラートを出す', () => {
  const result = decideSyncAction('scheduled', { status: 'trash' });
  assert.equal(result.needsAlert, true);
  assert.match(result.syncError, /ゴミ箱/);
});

test('decideSyncAction: draft/pendingは想定外としてアラートを出す', () => {
  assert.equal(decideSyncAction('scheduled', { status: 'draft' }).needsAlert, true);
  assert.equal(decideSyncAction('scheduled', { status: 'pending' }).needsAlert, true);
});

test('decideSyncAction: 未知のステータスもアラートを出す(将来のWordPress仕様変更への保険)', () => {
  const result = decideSyncAction('scheduled', { status: 'private' });
  assert.equal(result.needsAlert, true);
});
