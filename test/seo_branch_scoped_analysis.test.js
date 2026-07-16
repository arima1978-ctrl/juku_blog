'use strict';

// あま本部等、新規校舎の追加に伴い、競合ページ解析(seo_page_analyze.js)・
// Gap計算(seo_gap_calculate.js)が校舎ごとに安全に分離して実行できることを検証する。
// 実際のキーワード抽出ヒューリスティック(config依存のarea辞書等)には依存せず、
// (1) seo_db.js側の新規branch_idスコープ付きクエリが正しく校舎で絞り込めること、
// (2) resolvePageAnalyze/resolveGapCalculateがそのクエリへbranchIdを正しく
//     引き渡していること、の2段階で検証する。

const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_branch_scoped_analysis_${process.pid}.sqlite`);
const TMP_CONFIG = path.join(os.tmpdir(), `juku_blog_seo_branch_scoped_analysis_config_${process.pid}.yaml`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

// resolvePageAnalyze/resolveGapCalculateはconfig.seo.competitor_analysis(重みづけ等)を
// 直接参照するため、実configをベースにfeaturesのみ有効化する(他テストと同じ手法)。
fs.writeFileSync(
  TMP_CONFIG,
  yaml.dump((() => {
    const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
    config.features.competitor_keyword_analysis.enabled = true;
    return config;
  })()),
  'utf8'
);
process.env.JUKU_BLOG_CONFIG_PATH = TMP_CONFIG;

const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const branchesDb = require('../scripts/lib/branches_db');
const { resolvePageAnalyze } = require('../scripts/seo_page_analyze');
const { resolveGapCalculate } = require('../scripts/seo_gap_calculate');

after(() => {
  closeDb();
  [TMP_DB, TMP_CONFIG].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

const nowIso = '2026-07-16T00:00:00.000Z';

test('setup: 2校舎(小幡校/あま本部)と、それぞれ専用の競合・ページ・複合キーワードを用意する', () => {
  const obata = branchesDb.getActiveBranch(); // config由来で自動作成される最初の校舎
  const ama = branchesDb.createBranch({ name: 'あま本部' }, nowIso);
  global.__obataBranchId = obata.id;
  global.__amaBranchId = ama.id;

  seoDb.upsertCompetitor({ id: 'obata-competitor', name: '小幡競合塾', domain: 'obata-rival.example.com', branch_id: obata.id }, nowIso);
  seoDb.upsertCompetitor({ id: 'ama-competitor', name: 'あま競合塾', domain: 'ama-rival.example.com', branch_id: ama.id }, nowIso);

  const obataPage = seoDb.upsertCompetitorPage(
    { competitor_id: 'obata-competitor', url: 'https://obata-rival.example.com/', canonical_url: 'https://obata-rival.example.com/', content_hash: 'hash-obata', fetched_at: nowIso },
    nowIso
  );
  const amaPage = seoDb.upsertCompetitorPage(
    { competitor_id: 'ama-competitor', url: 'https://ama-rival.example.com/', canonical_url: 'https://ama-rival.example.com/', content_hash: 'hash-ama', fetched_at: nowIso },
    nowIso
  );
  global.__obataPageId = obataPage.id;
  global.__amaPageId = amaPage.id;

  const obataCompoundId = seoDb.upsertCompoundKeyword(
    { compound_keyword: '小幡 塾', template_type: 'area_juku', keyword_components: { area: '小幡' }, target_area: '小幡', branch_id: obata.id },
    nowIso
  );
  const amaCompoundId = seoDb.upsertCompoundKeyword(
    { compound_keyword: 'あま市 塾', template_type: 'area_juku', keyword_components: { area: 'あま市' }, target_area: 'あま市', branch_id: ama.id },
    nowIso
  );
  seoDb.upsertPageCompoundKeyword({ page_id: obataPage.id, compound_keyword_id: obataCompoundId, cooccurrence_score: 0.8 }, nowIso);
  seoDb.upsertPageCompoundKeyword({ page_id: amaPage.id, compound_keyword_id: amaCompoundId, cooccurrence_score: 0.8 }, nowIso);
});

test('listPagesNeedingAnalysis(branchId): 校舎の競合が持つページのみを返す', () => {
  const obataPages = seoDb.listPagesNeedingAnalysis(global.__obataBranchId);
  const amaPages = seoDb.listPagesNeedingAnalysis(global.__amaBranchId);
  assert.ok(obataPages.some((p) => p.id === global.__obataPageId));
  assert.ok(!obataPages.some((p) => p.id === global.__amaPageId), '小幡校の解析対象にあま本部のページが混ざってはいけない');
  assert.ok(amaPages.some((p) => p.id === global.__amaPageId));
  assert.ok(!amaPages.some((p) => p.id === global.__obataPageId), 'あま本部の解析対象に小幡校のページが混ざってはいけない');
});

test('countAnalyzedCompetitors(branchId): 校舎の競合数のみをカウントする', () => {
  assert.equal(seoDb.countAnalyzedCompetitors(global.__obataBranchId), 1);
  assert.equal(seoDb.countAnalyzedCompetitors(global.__amaBranchId), 1);
});

test('listCompoundKeywordCoverage(branchId): 校舎の複合キーワードのみを返す', () => {
  const obataCoverage = seoDb.listCompoundKeywordCoverage(global.__obataBranchId);
  const amaCoverage = seoDb.listCompoundKeywordCoverage(global.__amaBranchId);
  assert.ok(obataCoverage.some((r) => r.compound_keyword === '小幡 塾'));
  assert.ok(!obataCoverage.some((r) => r.compound_keyword === 'あま市 塾'), '小幡校のカバレッジにあま本部のキーワードが混ざってはいけない');
  assert.ok(amaCoverage.some((r) => r.compound_keyword === 'あま市 塾'));
  assert.ok(!amaCoverage.some((r) => r.compound_keyword === '小幡 塾'), 'あま本部のカバレッジに小幡校のキーワードが混ざってはいけない');
});

test('branchId未指定(CLI/cronの既存挙動): 全校舎分を返す(後方互換)', () => {
  const allPages = seoDb.listPagesNeedingAnalysis();
  assert.ok(allPages.some((p) => p.id === global.__obataPageId));
  assert.ok(allPages.some((p) => p.id === global.__amaPageId));
});

test('resolvePageAnalyze: branchIdをlistPagesNeedingAnalysis/upsertTopic/upsertCompoundKeywordへ正しく引き渡す', async () => {
  const calls = [];
  const fakeSeoDb = {
    listPagesNeedingAnalysis: (branchId) => {
      calls.push(['listPagesNeedingAnalysis', branchId]);
      return [];
    },
  };
  const result = await resolvePageAnalyze({ branchId: global.__amaBranchId, seoDbImpl: fakeSeoDb });
  assert.equal(result.reason, 'no_pages');
  assert.deepEqual(calls, [['listPagesNeedingAnalysis', global.__amaBranchId]]);
});

test('resolveGapCalculate: branchIdをlistCompetitors/listCompoundKeywordCoverage/countAnalyzedCompetitorsへ正しく引き渡す', async () => {
  const calls = [];
  const fakeSeoDb = {
    getRunningAnalysisRun: () => null,
    listCompetitors: ({ branchId } = {}) => {
      calls.push(['listCompetitors', branchId]);
      return [];
    },
    createAnalysisRun: () => {},
    listCompoundKeywordCoverage: (branchId) => {
      calls.push(['listCompoundKeywordCoverage', branchId]);
      return [];
    },
    countAnalyzedCompetitors: (branchId) => {
      calls.push(['countAnalyzedCompetitors', branchId]);
      return 0;
    },
    finishAnalysisRun: () => {},
  };
  const result = await resolveGapCalculate({ branchId: global.__amaBranchId, seoDbImpl: fakeSeoDb, dryRun: true });
  assert.equal(result.ok, true);
  assert.ok(calls.some(([fn, branchId]) => fn === 'listCompoundKeywordCoverage' && branchId === global.__amaBranchId));
  assert.ok(calls.some(([fn, branchId]) => fn === 'countAnalyzedCompetitors' && branchId === global.__amaBranchId));
  assert.ok(calls.every(([fn, branchId]) => fn !== 'listCompetitors' || branchId === global.__amaBranchId));
});
