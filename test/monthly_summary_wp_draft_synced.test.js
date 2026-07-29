'use strict';

// scripts/lib/db.js monthlySummary()の回帰テスト(2026-07-29)。
// あま本部校(branches.sync_mode='draft_review')のフローではwp_draft_syncedが承認ゲートを
// 通過済みの状態にあたるため、approved件数に含めないと実態より低く表示されてしまっていた。

const os = require('node:os');
const path = require('node:path');
const TMP_DB = path.join(os.tmpdir(), `juku_blog_monthly_summary_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { insertPost, monthlySummary, closeDb } = require('../scripts/lib/db');

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

test('monthlySummary: wp_draft_syncedはapproved相当としてカウントに含まれる', () => {
  const created = '2026-07-15T00:00:00.000Z';
  insertPost({ created_at: created, slug: 'p1', title: 't1', category: 'c', body_md: 'x', body_html: 'x', status: 'wp_draft_synced' });
  insertPost({ created_at: created, slug: 'p2', title: 't2', category: 'c', body_md: 'x', body_html: 'x', status: 'approved' });
  insertPost({ created_at: created, slug: 'p3', title: 't3', category: 'c', body_md: 'x', body_html: 'x', status: 'review_pending' });
  insertPost({ created_at: created, slug: 'p4', title: 't4', category: 'c', body_md: 'x', body_html: 'x', status: 'rejected' });

  const summary = monthlySummary('2026-07');
  assert.equal(summary.total, 4);
  assert.equal(summary.approved, 2, 'wp_draft_synced 1件 + approved 1件 = 2件のはず');
});
