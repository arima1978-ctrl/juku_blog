'use strict';

// 複数モジュール(db.js + schedule.js + wp_sync.js)を実際に組み合わせた結合テスト。
// 本番データ(data/posts.sqlite)を汚さないよう、一時ファイルをDBとして使う
// (db.js は JUKU_BLOG_DB_PATH 環境変数があればそちらを使う)。
//
// WordPress実サーバー・Telegramへの実通信は行わない(publishPostの失敗経路のみ、
// 到達不能なホストへの実際のTCP接続失敗を使って検証する)。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const {
  insertPost,
  getPostById,
  listPosts,
  setStatus,
  setScheduled,
  getLatestScheduleDate,
  applyWpSyncResult,
  closeDb,
} = require('../scripts/lib/db');
const { computeNextScheduleSlot, isWithinPublishWindow } = require('../scripts/lib/schedule');
const { decideSyncAction } = require('../scripts/lib/wp_sync');

after(() => {
  closeDb(); // Windowsでは開いたままのファイルを削除できないため、先に接続を閉じる
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
});

function makePost(overrides = {}) {
  return insertPost({
    created_at: new Date().toISOString(),
    title: overrides.title || 'テスト記事',
    slug: overrides.slug || `test-slug-${Math.random().toString(36).slice(2)}`,
    category: overrides.category || '勉強のコツ',
    target_audience: overrides.target_audience || '中2保護者',
    keywords: 'テスト',
    body_md: '本文',
    body_html: '<p>本文</p>',
    status: 'review_pending',
    publish_window_end: overrides.publish_window_end || null,
  });
}

test('結合: 記事生成からreview_pending登録まで', () => {
  const id = makePost({ title: '記事A' });
  const post = getPostById(id);
  assert.equal(post.status, 'review_pending');
  assert.equal(post.title, '記事A');

  const pending = listPosts({ status: 'review_pending' });
  assert.ok(pending.some((p) => p.id === id));
});

test('結合: 複数件承認時に1日1本ずつ割り当てられ、同日重複が起きない', () => {
  const now = new Date('2026-08-01T10:00:00Z');
  const runTime = '05:00';
  const ids = [makePost({ title: '記事B1' }), makePost({ title: '記事B2' }), makePost({ title: '記事B3' })];
  const scheduledDates = [];

  for (const id of ids) {
    setStatus(id, 'approved', null);
    const latest = getLatestScheduleDate();
    const slot = computeNextScheduleSlot(latest, runTime, now);
    setScheduled(id, { wpPostId: `wp-${id}`, wpLink: `https://example.com/?p=${id}`, scheduledAt: slot.utcIso });
    scheduledDates.push(slot.dateOnly);
  }

  // 1日1本ずつ、日付が重複しない
  assert.equal(new Set(scheduledDates).size, scheduledDates.length);
  // 昇順に並んでいる(まとめ承認しても順番に割り当てられる)
  const sorted = [...scheduledDates].sort();
  assert.deepEqual(scheduledDates, sorted);
});

test('結合: 承認時の公開期限超過検出(季節テーマ記事)', () => {
  const now = new Date('2026-08-01T10:00:00Z');
  const runTime = '05:00';
  // 直近の予約が無い状態からの1件目は「明日」になるが、
  // 公開期限をそれより前(今日)に設定して期限超過を再現する
  const id = makePost({ title: '季節記事(期限切れ)', publish_window_end: '2026-08-01' });
  const post = getPostById(id);

  const slot = computeNextScheduleSlot(null, runTime, now);
  const withinWindow = isWithinPublishWindow(slot.dateOnly, post.publish_window_end);

  assert.equal(withinWindow, false);
  // 実際のapi-server.jsの挙動と同じく、期限超過時はscheduledに進めず
  // approvedのまま人間確認に戻すことを確認する
  setStatus(id, 'approved', '期限超過のため保留');
  const updated = getPostById(id);
  assert.equal(updated.status, 'approved');
  assert.match(updated.reviewer_note, /期限超過/);
});

test('結合: WordPress状態同期でscheduled→publishedへ遷移しDBに反映される', () => {
  const id = makePost({ title: '同期テスト記事' });
  setStatus(id, 'approved', null);
  setScheduled(id, { wpPostId: 'wp-sync-test', wpLink: 'https://example.com/?p=999', scheduledAt: new Date().toISOString() });

  let post = getPostById(id);
  assert.equal(post.status, 'scheduled');

  // WordPress側が実際にpublishになったと仮定して同期する
  const action = decideSyncAction(post.status, { status: 'publish' });
  applyWpSyncResult(id, {
    newStatus: action.newLocalStatus,
    wpStatus: 'publish',
    syncError: action.syncError,
    syncedAt: new Date().toISOString(),
  });

  post = getPostById(id);
  assert.equal(post.status, 'published');
  assert.equal(post.wp_status, 'publish');
  assert.equal(post.wp_sync_error, null);
});

test('結合: WordPress状態同期で記事消失(404)を検知してもローカルstatusは変えない', () => {
  const id = makePost({ title: '消失テスト記事' });
  setStatus(id, 'approved', null);
  setScheduled(id, { wpPostId: 'wp-missing-test', wpLink: 'https://example.com/?p=998', scheduledAt: new Date().toISOString() });

  const post = getPostById(id);
  const action = decideSyncAction(post.status, { status: 'not_found' });
  assert.equal(action.needsAlert, true);
  applyWpSyncResult(id, {
    newStatus: action.newLocalStatus,
    wpStatus: 'not_found',
    syncError: action.syncError,
    syncedAt: new Date().toISOString(),
  });

  const updated = getPostById(id);
  assert.equal(updated.status, 'scheduled'); // statusは変えない(WordPressが実体の正、人間確認優先)
  assert.match(updated.wp_sync_error, /見つかりません/);
});

test('結合: 再実行しても同じslugの記事が重複登録されない(冪等性)', () => {
  const slug = `idempotent-${Math.random().toString(36).slice(2)}`;
  const id1 = insertPost({
    created_at: new Date().toISOString(),
    title: '冪等性テスト',
    slug,
    category: '勉強のコツ',
    body_md: '本文',
    body_html: '<p>本文</p>',
    status: 'review_pending',
  });

  // sync_draft_to_db.js は既存slugがあればinsertPostではなくupdatePostBySlugを呼ぶ設計。
  // ここではslugのUNIQUE制約自体が二重登録を防いでいることを確認する。
  assert.throws(() => {
    insertPost({
      created_at: new Date().toISOString(),
      title: '冪等性テスト(重複)',
      slug,
      category: '勉強のコツ',
      body_md: '本文2',
      body_html: '<p>本文2</p>',
      status: 'review_pending',
    });
  });

  const posts = listPosts({}).filter((p) => p.slug === slug);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, id1);
});

test('結合: WordPress投稿失敗時にエラーが正しく伝播する(到達不能ホストへの実接続失敗)', async () => {
  process.env.WP_URL = 'http://127.0.0.1:1'; // 誰も listen していないポート = 確実に接続失敗する
  process.env.WP_USERNAME = 'dummy';
  process.env.WP_APP_PASSWORD = 'dummy';
  delete require.cache[require.resolve('../scripts/lib/wordpress')];
  const { publishPost } = require('../scripts/lib/wordpress');

  await assert.rejects(async () => {
    await publishPost({ title: 't', slug: 's', body_html: '<p>x</p>', keywords: '' }, {});
  });
});

test('結合: Telegram未設定時もエラーを投げず正常に完了する', async () => {
  delete process.env.TELEGRAM_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete require.cache[require.resolve('../scripts/lib/telegram')];
  const { sendTelegram } = require('../scripts/lib/telegram');

  await assert.doesNotReject(async () => {
    await sendTelegram('テストメッセージ');
  });
});
