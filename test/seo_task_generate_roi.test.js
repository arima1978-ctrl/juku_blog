'use strict';

// Sprint 3.8: seo_task_generate.jsへ統合したImpact×DifficultyのROI優先度スコア計算の
// テスト。必ず一時SQLite(JUKU_BLOG_DB_PATH)・一時config(JUKU_BLOG_CONFIG_PATH)を使い、
// 実データ(data/posts.sqlite・config/juku.yaml)は一切変更しない。

const os = require('node:os');
const path = require('node:path');
const TMP_DB = path.join(os.tmpdir(), `juku_blog_task_generate_roi_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { buildTaskForCandidate, buildCompetitorTypeCountsByKeyword } = require('../scripts/seo_task_generate');

const TMP_CONFIG = path.join(os.tmpdir(), `juku_blog_task_generate_roi_config_${process.pid}.yaml`);

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

const nowIso = '2026-07-19T00:00:00.000Z';

function baseOpts(overrides = {}) {
  return {
    effortMinutesByTaskType: { improve_school_page: 10, create_article: 30, add_faq: 5, add_internal_links: 5, improve_existing_article: 15 },
    opportunityWeights: { competitor_adoption: 20, area_relevance: 20, search_intent: 20, own_coverage_gap: 20, data_confidence: 10, effort_efficiency: 10 },
    totalCompetitorsConsidered: 5,
    ...overrides,
  };
}

function baseCandidate(overrides = {}) {
  return {
    id: 1,
    normalized_keyword: 'ROI統合テスト 塾',
    target_area: 'x',
    gap_type: 'weak',
    priority_score: 70,
    data_confidence: 75,
    search_intent: 'general_service',
    template_type: 'area_juku',
    competitor_count: 2,
    search_demand: 1000,
    own_avg_position: 15,
    existing_post_id: null,
    ...overrides,
  };
}

test('buildTaskForCandidate: Impact/Difficultyフィールドが計算され、_rawRoiScoreも含まれる', () => {
  const task = buildTaskForCandidate(baseCandidate(), baseOpts());

  assert.ok(task.difficulty_score >= 1 && task.difficulty_score <= 100);
  assert.ok(task.difficulty_breakdown);
  assert.ok(task.expected_impact_clicks >= 0);
  assert.ok(task.expected_impact_cv >= 0);
  assert.equal(task.roi_priority_score, null); // main()のバッチ正規化前はnull
  assert.equal(task.roi_score_computed_at, null);
  assert.ok(typeof task._rawRoiScore === 'number'); // 中間値、main()が削除する前提
});

test('buildTaskForCandidate: search_demandが無ければImpactはnull・_rawRoiScoreもnull', () => {
  const task = buildTaskForCandidate(baseCandidate({ search_demand: null }), baseOpts());
  assert.equal(task.expected_impact_clicks, null);
  assert.equal(task.expected_impact_cv, null);
  assert.equal(task._rawRoiScore, null);
});

test('buildTaskForCandidate: competitorTypeCountsByKeywordを渡すとDifficultyの競合種別加点に反映される', () => {
  const withoutBonus = buildTaskForCandidate(baseCandidate({ normalized_keyword: 'ボーナス無し' }), baseOpts());

  const map = new Map([['ボーナスあり', { major_chain: 1 }]]);
  const withBonus = buildTaskForCandidate(
    baseCandidate({ normalized_keyword: 'ボーナスあり' }),
    baseOpts({ competitorTypeCountsByKeyword: map })
  );

  assert.ok(withBonus.difficulty_score > withoutBonus.difficulty_score);
});

test('buildCompetitorTypeCountsByKeyword: 登録競合のcompetitor_typeをキーワード単位で集計する', () => {
  seoDb.upsertCompetitor(
    { id: 'roi-major', name: 'ROI大手テスト', domain: 'roi-major-test.example.com', competitor_type: 'major_chain', crawl_enabled: true },
    nowIso
  );
  seoDb.upsertCompetitor(
    { id: 'roi-local', name: 'ROI地域テスト', domain: 'roi-local-test.example.com', competitor_type: 'local', crawl_enabled: true },
    nowIso
  );

  const compoundKeywordId = seoDb.upsertCompoundKeyword(
    { compound_keyword: 'ROI集計テスト 塾', template_type: 'area_juku', keyword_components: {}, target_area: 'x', target_school: null, target_grade: null, target_subject: null },
    nowIso
  );

  const pageMajor = seoDb.upsertCompetitorPage(
    { competitor_id: 'roi-major', url: 'https://roi-major-test.example.com/a', canonical_url: 'https://roi-major-test.example.com/a', fetched_at: nowIso },
    nowIso
  );
  const pageLocal = seoDb.upsertCompetitorPage(
    { competitor_id: 'roi-local', url: 'https://roi-local-test.example.com/a', canonical_url: 'https://roi-local-test.example.com/a', fetched_at: nowIso },
    nowIso
  );

  seoDb.upsertPageCompoundKeyword({ page_id: pageMajor.id, compound_keyword_id: compoundKeywordId, cooccurrence_score: 1, same_zone: 1 }, nowIso);
  seoDb.upsertPageCompoundKeyword({ page_id: pageLocal.id, compound_keyword_id: compoundKeywordId, cooccurrence_score: 1, same_zone: 1 }, nowIso);

  const map = buildCompetitorTypeCountsByKeyword();
  const counts = map.get('ROI集計テスト 塾');
  assert.ok(counts);
  assert.equal(counts.major_chain, 1);
  assert.equal(counts.local, 1);
});

// --- main()のバッチ正規化を含む結合テスト(CLIサブプロセス、--dry-run固定) ---

function writeEnabledConfig() {
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
  config.features.growth_director.enabled = true;
  fs.writeFileSync(TMP_CONFIG, yaml.dump(config), 'utf8');
}

test('CLI --dry-run: ROIスコア・期待CV数がコンソールへプレビュー出力され、DBは変更されない', () => {
  writeEnabledConfig();

  seoDb.upsertKeywordCandidate(
    {
      normalized_keyword: 'ROI CLIテスト 高impact',
      target_area: 'x',
      gap_type: 'weak',
      priority_score: 70,
      data_confidence: 75,
      search_intent: 'general_service',
      template_type: 'area_juku',
      competitor_count: 1,
      search_demand: 2000,
      own_avg_position: 15,
    },
    nowIso
  );
  seoDb.upsertKeywordCandidate(
    {
      normalized_keyword: 'ROI CLIテスト 低impact',
      target_area: 'x',
      gap_type: 'weak',
      priority_score: 70,
      data_confidence: 75,
      search_intent: 'general_service',
      template_type: 'area_juku',
      competitor_count: 5,
      search_demand: 50,
      own_avg_position: 25,
    },
    nowIso
  );
  closeDb();

  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_task_generate.js'), '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, JUKU_BLOG_CONFIG_PATH: TMP_CONFIG },
  });

  assert.match(output, /roi_score=/);
  assert.match(output, /impact_cv=/);
  assert.match(output, /impact_clicks=/);
  assert.match(output, /difficulty=/);

  // dry-runなのでDBには保存されていないこと
  const tasks = seoDb.listTasks({});
  assert.equal(tasks.length, 0);
});

test('main()実行(--save相当、一時DBのみ): バッチ内でroi_priority_scoreが0〜100へ正規化されて保存される', () => {
  writeEnabledConfig();

  seoDb.upsertKeywordCandidate(
    {
      normalized_keyword: 'ROI保存テスト 高roi',
      target_area: 'x',
      gap_type: 'missing',
      priority_score: 70,
      data_confidence: 75,
      search_intent: 'general_service',
      template_type: 'area_koko_nyushi',
      competitor_count: 0,
      search_demand: 3000,
      own_avg_position: 15,
    },
    nowIso
  );
  seoDb.upsertKeywordCandidate(
    {
      normalized_keyword: 'ROI保存テスト 低roi',
      target_area: 'x',
      gap_type: 'missing',
      priority_score: 70,
      data_confidence: 75,
      search_intent: 'general_service',
      template_type: 'area_koko_nyushi',
      competitor_count: 10,
      search_demand: 30,
      own_avg_position: 28,
    },
    nowIso
  );
  closeDb();

  // このCLIは--dry-run未指定時に実際に保存する設計(既存Sprint1仕様、後方互換のため維持)。
  // 必ずJUKU_BLOG_DB_PATHで一時DBへ限定してから実行する(実データへは絶対に触れない)。
  execFileSync('node', [path.join(ROOT, 'scripts', 'seo_task_generate.js')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, JUKU_BLOG_CONFIG_PATH: TMP_CONFIG },
  });

  const tasks = seoDb.listTasks({});
  const highRoiTask = tasks.find((t) => t.target_keyword === 'ROI保存テスト 高roi');
  const lowRoiTask = tasks.find((t) => t.target_keyword === 'ROI保存テスト 低roi');

  assert.ok(highRoiTask);
  assert.ok(lowRoiTask);
  assert.ok(highRoiTask.roi_priority_score > lowRoiTask.roi_priority_score);
  assert.ok(highRoiTask.roi_priority_score >= 0 && highRoiTask.roi_priority_score <= 100);
  assert.ok(lowRoiTask.roi_priority_score >= 0 && lowRoiTask.roi_priority_score <= 100);
  assert.ok(highRoiTask.roi_score_computed_at);
  assert.ok(lowRoiTask.roi_score_computed_at);
});
