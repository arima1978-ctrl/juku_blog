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
  // 習い事の年間バランス構造化(2026-07-29): 智谷がlocked_category曜日でnaraigoto候補のみを
  // 検討対象に絞り込めるよう、content_categoryを付与している
  assert.equal(payload[0].content_category, 'juku');
});

test('CLI: naraigoto辞書に一致する候補にはcontent_category:naraigotoが付与される', () => {
  const result = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '守山区 英会話', gap_type: 'untapped', priority_score: 50, recommended_action: 'create_article' },
    nowIso
  );
  seoDb.updateCandidateStatus(result.id, { toStatus: 'reviewing', actor: 'test' }, nowIso);
  seoDb.updateCandidateStatus(result.id, { toStatus: 'approved', approvedAction: 'create_article', actor: 'test' }, nowIso);

  if (fs.existsSync(OUT_PATH)) fs.unlinkSync(OUT_PATH);
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_topic_candidates_export.js'), OUT_DATE], { env: process.env });

  const payload = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const row = payload.find((c) => c.normalized_keyword === '守山区 英会話');
  assert.ok(row, 'naraigoto候補が出力に含まれていません');
  assert.equal(row.content_category, 'naraigoto');
});

// queuedの優先消化(2026-07-30〜)の回帰テスト群。
function queueCandidate(keyword, priorityScore, queuedAtIso) {
  const result = seoDb.upsertKeywordCandidate(
    { normalized_keyword: keyword, gap_type: 'untapped', priority_score: priorityScore, recommended_action: 'create_article' },
    queuedAtIso
  );
  seoDb.updateCandidateStatus(result.id, { toStatus: 'reviewing', actor: 'test' }, queuedAtIso);
  seoDb.updateCandidateStatus(result.id, { toStatus: 'approved', approvedAction: 'create_article', actor: 'test' }, queuedAtIso);
  seoDb.updateCandidateStatus(result.id, { toStatus: 'queued', actor: 'test' }, queuedAtIso);
  return result.id;
}

test('CLI: queuedはpriority_scoreに関わらずapprovedより先に来る(priority_score最低のqueuedでも先頭)', () => {
  const highPriorityApproved = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '高priorityのapproved', gap_type: 'untapped', priority_score: 99, recommended_action: 'create_article' },
    nowIso
  );
  seoDb.updateCandidateStatus(highPriorityApproved.id, { toStatus: 'reviewing', actor: 'test' }, nowIso);
  seoDb.updateCandidateStatus(highPriorityApproved.id, { toStatus: 'approved', approvedAction: 'create_article', actor: 'test' }, nowIso);

  queueCandidate('低priorityのqueued', 1, '2026-07-30T00:00:00.000Z');

  if (fs.existsSync(OUT_PATH)) fs.unlinkSync(OUT_PATH);
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_topic_candidates_export.js'), OUT_DATE], { env: process.env });

  const payload = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const idxQueued = payload.findIndex((c) => c.normalized_keyword === '低priorityのqueued');
  const idxApproved = payload.findIndex((c) => c.normalized_keyword === '高priorityのapproved');
  assert.ok(idxQueued >= 0 && idxApproved >= 0);
  assert.ok(idxQueued < idxApproved, 'priority_scoreが最低でもqueuedはapprovedより先に来るべき');
  assert.equal(payload[idxQueued].status, 'queued');
});

test('CLI: 複数queuedはキュー投入順(FIFO、先に投入された方が先頭)に並ぶ', () => {
  queueCandidate('先に投入', 10, '2026-07-30T01:00:00.000Z');
  queueCandidate('後で投入', 90, '2026-07-30T02:00:00.000Z');

  if (fs.existsSync(OUT_PATH)) fs.unlinkSync(OUT_PATH);
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_topic_candidates_export.js'), OUT_DATE], { env: process.env });

  const payload = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const queuedOnly = payload.filter((c) => c.status === 'queued').map((c) => c.normalized_keyword);
  const idxFirst = queuedOnly.indexOf('先に投入');
  const idxSecond = queuedOnly.indexOf('後で投入');
  assert.ok(idxFirst >= 0 && idxSecond >= 0);
  assert.ok(idxFirst < idxSecond, 'priority_scoreが低くても先に投入された方が先頭に来るべき(FIFO)');
});

test('CLI: queuedはMAX_CANDIDATES(5件)の上限を受けず全件出力される', () => {
  for (let i = 0; i < 7; i++) {
    queueCandidate(`queued候補${i}`, 10, `2026-07-30T0${i}:00:00.000Z`);
  }

  if (fs.existsSync(OUT_PATH)) fs.unlinkSync(OUT_PATH);
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_topic_candidates_export.js'), OUT_DATE], { env: process.env });

  const payload = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const keywords = payload.map((c) => c.normalized_keyword);
  for (let i = 0; i < 7; i++) {
    assert.ok(keywords.includes(`queued候補${i}`), `queued候補${i}が上限で欠落しています(queuedは全件出力されるべき)`);
  }
});
