'use strict';

// scripts/lib/db.js listTitlesSince()の回帰テスト(2026-07-29)。
// 習い事の年間バランス構造化: 智谷がdata/recent_titles.jsonのseasonal_topic_idから
// ジャンル別の直近選定日を逆算できるよう、返り値にseasonal_topic_idを追加した。

const os = require('node:os');
const path = require('node:path');
const TMP_DB = path.join(os.tmpdir(), `juku_blog_list_titles_since_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { insertPost, listTitlesSince, closeDb } = require('../scripts/lib/db');

after(() => {
  closeDb();
  for (const f of [TMP_DB, `${TMP_DB}-journal`, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  }
});

test('listTitlesSince: seasonal_topic_idを含めて返す', () => {
  const now = '2026-07-29T00:00:00.000Z';
  insertPost({
    created_at: now,
    slug: 'p1',
    title: '守山区で子ども英会話教室を探すなら',
    category: '習い事紹介',
    body_md: 'x',
    body_html: 'x',
    seasonal_topic_id: 'naraigoto-eikaiwa-local',
  });
  insertPost({ created_at: now, slug: 'p2', title: '通常の記事', category: '勉強のコツ', body_md: 'x', body_html: 'x' });

  const since = '2026-01-01T00:00:00.000Z';
  const rows = listTitlesSince(since);
  const naraigotoRow = rows.find((r) => r.title === '守山区で子ども英会話教室を探すなら');
  assert.equal(naraigotoRow.seasonal_topic_id, 'naraigoto-eikaiwa-local');
  const normalRow = rows.find((r) => r.title === '通常の記事');
  assert.equal(normalRow.seasonal_topic_id, null);
});

test('listTitlesSince: branchId指定時もseasonal_topic_idを含める', () => {
  const now = '2026-07-29T01:00:00.000Z';
  insertPost({
    created_at: now,
    slug: 'p3',
    title: '守山区で習字を習うなら',
    category: '習い事紹介',
    body_md: 'x',
    body_html: 'x',
    branch_id: 1,
    seasonal_topic_id: 'naraigoto-shodo-local',
  });

  const rows = listTitlesSince('2026-01-01T00:00:00.000Z', 1);
  const row = rows.find((r) => r.title === '守山区で習字を習うなら');
  assert.equal(row.seasonal_topic_id, 'naraigoto-shodo-local');
});
