'use strict';

// seo_task_generate.jsのstatusフィルタ(2026-07-29、ブロックリスト方式へ変更)の回帰テスト。
// 変更前はlistKeywordCandidates({branchId})の結果を一切status絞り込みせずに使っており、
// rejected(却下確定)の候補もTask生成対象に含まれてしまっていた。

const os = require('node:os');
const path = require('node:path');
const TMP_DB = path.join(os.tmpdir(), `juku_blog_task_status_filter_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { resolveTaskGenerate } = require('../scripts/seo_task_generate');

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

test('resolveTaskGenerate: rejected(却下確定)の候補はTask生成対象から除外される', async () => {
  const nowIso = '2026-07-29T00:00:00.000Z';
  const candidate = seoDb.upsertKeywordCandidate(
    {
      normalized_keyword: '守山区 却下済みキーワード',
      target_area: '守山区',
      template_type: 'area_juku',
      gap_type: 'untapped',
      priority_score: 80,
      competitor_count: 3,
    },
    nowIso
  );
  seoDb.updateCandidateStatus(candidate.id, { toStatus: 'rejected', reason: 'test' }, nowIso);

  const result = await resolveTaskGenerate({ dryRun: true });
  assert.equal(result.ok, true);
  const keywords = (result.previews || []).map((p) => p.targetKeyword);
  assert.ok(!keywords.includes('守山区 却下済みキーワード'), 'rejected状態の候補がTask生成対象に混入している');
});

test('resolveTaskGenerate: queued(approved相当で次段階に進んだ)候補はTask生成対象に含まれる(ブロックリスト方式の確認)', async () => {
  const nowIso = '2026-07-29T00:00:00.000Z';
  const candidate = seoDb.upsertKeywordCandidate(
    {
      normalized_keyword: '守山区 queued確認用キーワード',
      target_area: '守山区',
      template_type: 'area_juku',
      gap_type: 'untapped',
      priority_score: 75,
      competitor_count: 3,
    },
    nowIso
  );
  seoDb.updateCandidateStatus(candidate.id, { toStatus: 'approved', reason: 'test', approvedAction: 'create_article' }, nowIso);
  seoDb.updateCandidateStatus(candidate.id, { toStatus: 'queued', reason: 'test' }, nowIso);

  const result = await resolveTaskGenerate({ dryRun: true });
  assert.equal(result.ok, true);
  const keywords = (result.previews || []).map((p) => p.targetKeyword);
  assert.ok(keywords.includes('守山区 queued確認用キーワード'), 'queued状態の候補が許可リスト方式のように除外されてはいけない');
});
