'use strict';

// 2026-07-17判明した実インシデントの回帰テスト: school_page_registry.js/seo_task_generate.js
// がbranchIdを一切受け取らずloadSchoolPagesConfig()/loadJukuConfig()を呼んでいたため、
// あま本部校(branch 2)向けにbranches/ama-honbu/config/school_pages.yamlを用意しても、
// Task生成が常に共有config/school_pages.yaml(小幡校のobataのみ)しか見ておらず、
// あま本部校の候補(area_juku/area_teaching_style)がすべてmonitor
// (reason: no_registered_school_page_or_landing_page)止まりになっていた
// (本番seo_tasks id=71/72/74で実際に発生)。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_task_branch_school_pages_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const branchesDb = require('../scripts/lib/branches_db');
const seoDb = require('../scripts/lib/seo_db');
const { resolveTaskGenerate } = require('../scripts/seo_task_generate');

const TEST_SLUG = '__test_ama_task_gen__';
const BRANCH_SCHOOL_PAGES_PATH = path.join(ROOT, 'branches', TEST_SLUG, 'config', 'school_pages.yaml');

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

afterEach(() => {
  for (const slug of [TEST_SLUG, `${TEST_SLUG}_none`, `${TEST_SLUG}_mixed`]) {
    try {
      fs.rmSync(path.join(ROOT, 'branches', slug), { recursive: true, force: true });
    } catch {
      // 既に無ければ無視
    }
  }
});

function writeBranchSchoolPages() {
  fs.mkdirSync(path.dirname(BRANCH_SCHOOL_PAGES_PATH), { recursive: true });
  fs.writeFileSync(
    BRANCH_SCHOOL_PAGES_PATH,
    `school_pages:\n  - id: ama-honbu\n    name: "あま本部教室"\n    url: "https://an-english.com/school/ama-honbu/"\n    page_type: "school_page"\n    target_areas: ["あま市"]\n    enabled: true\n`,
    'utf8'
  );
}

test('resolveTaskGenerate: 校舎別school_pages.yamlが登録されていれば、その校舎の候補はimprove_school_pageになる(修正前はmonitor止まりだった)', async () => {
  const branch = branchesDb.createBranch({ name: 'あま本部(テスト)', slug: TEST_SLUG });
  writeBranchSchoolPages();

  const nowIso = '2026-07-17T00:00:00.000Z';
  seoDb.upsertKeywordCandidate(
    {
      branch_id: branch.id,
      normalized_keyword: 'あま市 塾',
      target_area: 'あま市',
      template_type: 'area_juku',
      gap_type: 'weak',
      priority_score: 52,
      competitor_count: 3,
    },
    nowIso
  );

  const result = await resolveTaskGenerate({ dryRun: true, branchId: branch.id });
  assert.equal(result.ok, true);
  assert.equal(result.previews.length, 1);
  assert.equal(
    result.previews[0].taskType,
    'improve_school_page',
    '校舎別school_pages.yamlに登録済みのはずなのにmonitor止まりになっている(branchIdが渡っていない可能性)'
  );
});

test('resolveTaskGenerate: 校舎別school_pages.yamlが無い校舎の候補は、共有config/school_pages.yaml(小幡校のみ)には一致せずmonitorのまま(既存挙動)', async () => {
  const branch = branchesDb.createBranch({ name: 'あま本部(テスト・未登録)', slug: `${TEST_SLUG}_none` });
  // 校舎別school_pages.yamlは意図的に作らない

  const nowIso = '2026-07-17T00:00:00.000Z';
  seoDb.upsertKeywordCandidate(
    {
      branch_id: branch.id,
      normalized_keyword: 'あま市 集団指導',
      target_area: 'あま市',
      template_type: 'area_teaching_style',
      gap_type: 'untapped',
      priority_score: 25,
      competitor_count: 1,
    },
    nowIso
  );

  const result = await resolveTaskGenerate({ dryRun: true, branchId: branch.id });
  assert.equal(result.ok, true);
  assert.equal(result.previews[0].taskType, 'monitor', '未登録の校舎はmonitorのままであるべき(共有config小幡校のエリアとは一致しない)');
});

test('resolveTaskGenerate: 複数校舎の候補が混在するバッチでも、各候補は自分の校舎のschool_pages.yamlで判定される', async () => {
  const branch = branchesDb.createBranch({ name: 'あま本部(テスト・混在)', slug: `${TEST_SLUG}_mixed` });
  fs.mkdirSync(path.join(ROOT, 'branches', `${TEST_SLUG}_mixed`, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'branches', `${TEST_SLUG}_mixed`, 'config', 'school_pages.yaml'),
    `school_pages:\n  - id: ama-honbu-mixed\n    name: "あま本部教室"\n    url: "https://an-english.com/school/ama-honbu/"\n    page_type: "school_page"\n    target_areas: ["あま市"]\n    enabled: true\n`,
    'utf8'
  );

  const legacyBranch = branchesDb.getActiveBranch();
  const nowIso = '2026-07-17T00:00:00.000Z';

  // 小幡校(legacy)の候補: 共有config/school_pages.yamlの実データ(obata、瓢箪山等)に一致させる
  seoDb.upsertKeywordCandidate(
    {
      branch_id: legacyBranch.id,
      normalized_keyword: '瓢箪山 塾',
      target_area: '瓢箪山',
      template_type: 'area_juku',
      gap_type: 'weak',
      priority_score: 60,
      competitor_count: 2,
    },
    nowIso
  );
  // あま本部校の候補(他テストの残存候補と衝突しないよう、このテスト専用のキーワード文字列にする)
  seoDb.upsertKeywordCandidate(
    {
      branch_id: branch.id,
      normalized_keyword: 'あま市 塾(混在テスト専用)',
      target_area: 'あま市',
      template_type: 'area_juku',
      gap_type: 'weak',
      priority_score: 52,
      competitor_count: 3,
    },
    nowIso
  );

  // branchId未指定 = 全校舎対象で1バッチ処理(他テストが残した候補も含まれうるため、
  // このテスト固有のキーワードだけをbranchIdでフィルタして検証する)
  const result = await resolveTaskGenerate({ dryRun: true });
  assert.equal(result.ok, true);
  const relevant = result.previews.filter((p) =>
    ['瓢箪山 塾', 'あま市 塾(混在テスト専用)'].includes(p.targetKeyword)
  );
  const byKeyword = Object.fromEntries(relevant.map((p) => [p.targetKeyword, p.taskType]));
  assert.equal(byKeyword['瓢箪山 塾'], 'improve_school_page', '小幡校の候補は共有config(小幡校自身のエントリ)に一致するべき');
  assert.equal(
    byKeyword['あま市 塾(混在テスト専用)'],
    'improve_school_page',
    'あま本部校の候補は校舎別config(あま本部)に一致するべき'
  );
});
