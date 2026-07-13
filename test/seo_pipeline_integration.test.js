'use strict';

// 智谷(planner-blog-btoc)経由の競合キーワード候補連携を、sync_draft_to_db.jsの
// 挙動として結合テストする。実際のclaude CLI呼び出しは行わない
// (draftファイルを直接用意し、sync_draft_to_db.jsのみを子プロセスで実行する)。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_pipeline_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { execFileSync } = require('node:child_process');
const matter = require('gray-matter');
const { ROOT } = require('../scripts/lib/config');
const { closeDb, getPostBySlug } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');

const DRAFT_PATH = path.join(ROOT, 'data', 'drafts', '2099-03-03-seo-candidate-test.md');

after(() => {
  closeDb();
  [TMP_DB, DRAFT_PATH].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

test('sync_draft_to_db.js: seo_candidate_idがあるverified draftを同期するとapproved→article_createdへ遷移する', () => {
  const nowIso = '2026-07-13T00:00:00.000Z';
  const created = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '守山区 個別指導 パイプライン統合テスト', gap_type: 'missing', priority_score: 88 },
    nowIso
  );
  seoDb.updateCandidateStatus(created.id, { toStatus: 'approved', reason: 'テスト承認', actor: 'dashboard' }, nowIso);
  closeDb();

  const frontmatter = {
    title: 'テスト記事(SEO候補連携)',
    slug: 'seo-candidate-test',
    category: '地域情報',
    status: 'verified',
    seo_candidate_id: created.id,
  };
  fs.mkdirSync(path.dirname(DRAFT_PATH), { recursive: true });
  fs.writeFileSync(DRAFT_PATH, matter.stringify('本文本文本文', frontmatter), 'utf8');

  execFileSync('node', [path.join(ROOT, 'scripts', 'sync_draft_to_db.js'), DRAFT_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });

  const post = getPostBySlug('seo-candidate-test');
  assert.ok(post);

  const candidate = seoDb.getKeywordCandidateById(created.id);
  assert.equal(candidate.status, 'article_created');

  const links = seoDb.listCandidateExistingArticles(created.id);
  assert.equal(links.length, 1);
  assert.equal(links[0].post_slug, 'seo-candidate-test');
  assert.equal(links[0].match_reason, 'generated_from_candidate');
});

test('sync_draft_to_db.js: seo_candidate_idが無いdraftは従来通り同期され、SEO候補には一切影響しない', () => {
  const draftPath = path.join(ROOT, 'data', 'drafts', '2099-03-04-no-seo-candidate-test.md');
  const frontmatter = {
    title: 'テスト記事(SEO候補なし)',
    slug: 'no-seo-candidate-test',
    category: '勉強のコツ',
    status: 'verified',
  };
  fs.writeFileSync(draftPath, matter.stringify('本文', frontmatter), 'utf8');

  try {
    execFileSync('node', [path.join(ROOT, 'scripts', 'sync_draft_to_db.js'), draftPath], {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
    });
    const post = getPostBySlug('no-seo-candidate-test');
    assert.ok(post);
  } finally {
    fs.unlinkSync(draftPath);
  }
});
