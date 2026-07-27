'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideSyncAction, decideDraftReviewSyncAction } = require('../scripts/lib/wp_sync');

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

// あま本部校セルフ運用(sync_mode='draft_review')向け: wp_draft_synced固有の遷移。
// scheduledとは異なり、draftのまま/trashは正常な運用結果であり無警告。

test('decideSyncAction(wp_draft_synced): draftのまま(未確認)は無警告で変化なし', () => {
  const result = decideSyncAction('wp_draft_synced', { status: 'draft' });
  assert.equal(result.newLocalStatus, 'wp_draft_synced');
  assert.equal(result.needsAlert, false);
});

test('decideSyncAction(wp_draft_synced): 山口先生がtrashへ移動したらrejectedへ無警告で遷移(意図的な運用)', () => {
  const result = decideSyncAction('wp_draft_synced', { status: 'trash' });
  assert.equal(result.newLocalStatus, 'rejected');
  assert.equal(result.needsAlert, false);
  assert.equal(result.syncError, null);
});

test('decideSyncAction(wp_draft_synced): publishされたらpublishedへ遷移', () => {
  const result = decideSyncAction('wp_draft_synced', { status: 'publish' });
  assert.equal(result.newLocalStatus, 'published');
  assert.equal(result.needsAlert, false);
});

test('decideSyncAction(wp_draft_synced): 予約投稿(future)にされたらscheduledへ遷移(次回以降published検知の対象になる)', () => {
  const result = decideSyncAction('wp_draft_synced', { status: 'future' });
  assert.equal(result.newLocalStatus, 'scheduled');
  assert.equal(result.needsAlert, false);
});

test('decideSyncAction(wp_draft_synced): 記事消失(not_found)はアラートを出す', () => {
  const result = decideSyncAction('wp_draft_synced', { status: 'not_found' });
  assert.equal(result.needsAlert, true);
  assert.match(result.syncError, /見つかりません/);
});

test('decideDraftReviewSyncAction: decideSyncActionのwp_draft_synced分岐と同じ結果を返す', () => {
  assert.deepEqual(decideDraftReviewSyncAction({ status: 'draft' }), decideSyncAction('wp_draft_synced', { status: 'draft' }));
});
