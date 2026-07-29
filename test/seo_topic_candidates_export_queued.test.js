'use strict';

// seo_topic_candidates_export.js: queued状態の候補も選定対象に含まれることの確認(2026-07-29)。
// 実インシデント回帰テスト: Task 57(自立学習)がダッシュボードの「キューへ送る」操作で
// approved→queuedへ遷移した結果、以前はexportの対象から漏れ、智谷が永遠に候補として
// 検討できなくなっていた(status='approved'のみを見ていたため)。
// 必ず一時SQLite(JUKU_BLOG_DB_PATH)を使い、実データ(data/posts.sqlite)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_topic_export_queued_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');

const OUT_DATE = '2099-03-03'; // 実データと衝突しない日付
const OUT_PATH = path.join(ROOT, 'data', 'seo_candidates', `${OUT_DATE}.json`);

after(() => {
  closeDb();
  [process.env.JUKU_BLOG_DB_PATH, OUT_PATH].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

const nowIso = '2026-07-29T00:00:00.000Z';

test('CLI: status=queuedの候補もstatus=approvedと合算してexportされる(自立学習/Task57回帰テスト)', () => {
  const approvedResult = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '春期講習', gap_type: 'untapped', priority_score: 30, recommended_action: 'create_article' },
    nowIso
  );
  seoDb.updateCandidateStatus(approvedResult.id, { toStatus: 'reviewing', actor: 'test' }, nowIso);
  seoDb.updateCandidateStatus(approvedResult.id, { toStatus: 'approved', approvedAction: 'create_article', actor: 'test' }, nowIso);

  const queuedResult = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '自立学習', gap_type: 'untapped', priority_score: 90, recommended_action: 'create_article' },
    nowIso
  );
  seoDb.updateCandidateStatus(queuedResult.id, { toStatus: 'reviewing', actor: 'test' }, nowIso);
  seoDb.updateCandidateStatus(queuedResult.id, { toStatus: 'approved', approvedAction: 'create_article', actor: 'test' }, nowIso);
  seoDb.updateCandidateStatus(queuedResult.id, { toStatus: 'queued', actor: 'test' }, nowIso); // 「キューへ送る」操作を再現

  if (fs.existsSync(OUT_PATH)) fs.unlinkSync(OUT_PATH);
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_topic_candidates_export.js'), OUT_DATE], { env: process.env });

  assert.ok(fs.existsSync(OUT_PATH), 'queued候補が1件以上あるため出力ファイルが作られるはず');
  const payload = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const keywords = payload.map((c) => c.normalized_keyword);
  assert.ok(keywords.includes('自立学習'), 'queued状態の候補が選定対象から漏れています');
  assert.ok(keywords.includes('春期講習'));
  // priority_score降順(自立学習90 > 春期講習30)
  assert.equal(payload[0].normalized_keyword, '自立学習');
});
