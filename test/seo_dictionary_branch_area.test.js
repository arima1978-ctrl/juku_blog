'use strict';

// Keyword Gap Lite 多校舎対応の回帰テスト:「辞書のねじれ」バグ
// (seo_page_analyze.js/seo_gap_calculate.jsが常にconfig/juku.yamlの共有area(名古屋市守山区)
// で辞書を生成し、新校舎のページ解析で複合キーワードが0件になる/別校舎の地域名が誤って
// 候補化される不具合)が、scripts/lib/branch_area.jsの導入で解消されていることを確認する。

const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_dict_branch_area_${process.pid}.sqlite`);
const TMP_CONFIG = path.join(os.tmpdir(), `juku_blog_seo_dict_branch_area_config_${process.pid}.yaml`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

// resolvePageAnalyzeはconfig.seo.competitor_analysis(重みづけ等)を直接参照するため、
// 実configをベースにfeaturesのみ有効化する(他テストと同じ手法)。
fs.writeFileSync(
  TMP_CONFIG,
  yaml.dump(
    (() => {
      const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
      config.features.competitor_keyword_analysis.enabled = true;
      return config;
    })()
  ),
  'utf8'
);
process.env.JUKU_BLOG_CONFIG_PATH = TMP_CONFIG;

const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const branchesDb = require('../scripts/lib/branches_db');
const { resolvePageAnalyze } = require('../scripts/seo_page_analyze');

const PAGES_DIR = path.join(ROOT, 'data', 'seo', 'pages');
const writtenPageFiles = [];

function seedPage({ competitorId, branchId, bodyText, url }) {
  const nowIso = new Date().toISOString();
  seoDb.upsertCompetitor({ id: competitorId, name: competitorId, domain: `${competitorId}.example.com`, branch_id: branchId, crawl_enabled: true }, nowIso);
  const hash = crypto.createHash('sha256').update(bodyText).digest('hex');
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  const filePath = path.join(PAGES_DIR, `${hash}.txt`);
  fs.writeFileSync(filePath, bodyText, 'utf8');
  writtenPageFiles.push(filePath);
  return seoDb.upsertCompetitorPage(
    { competitor_id: competitorId, url, canonical_url: url, http_status: 200, content_type: 'text/html', title: bodyText.slice(0, 20), meta_description: '', fetched_at: nowIso, content_hash: hash, robots_allowed: true },
    nowIso
  );
}

after(() => {
  closeDb();
  [TMP_DB, TMP_CONFIG, ...writtenPageFiles].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

let obataBranch;
let amaBranch;

test('setup: 小幡校(既存・target_area=名古屋市守山区)とあま本部校(新規・target_area=あま市)を用意し、それぞれの競合ページを登録する', () => {
  obataBranch = branchesDb.getActiveBranch(); // config由来で自動作成される最初の校舎
  branchesDb.updateBranch(obataBranch.id, { target_area: '名古屋市守山区' });
  obataBranch = branchesDb.getBranchById(obataBranch.id);

  amaBranch = branchesDb.createBranch({ name: 'あま本部校', target_area: 'あま市' });

  seedPage({
    competitorId: 'morikobe',
    branchId: obataBranch.id,
    url: 'https://morikobe.example.com/',
    bodyText: '名古屋市守山区で塾をお探しなら。守山区の中学生向け個別指導が評判です。',
  });
  seedPage({
    competitorId: 'itto-amamiwa',
    branchId: amaBranch.id,
    url: 'https://itto-amamiwa.example.com/',
    bodyText: 'あま市で塾をお探しならITTOあま美和校へ。あま市の中学生向け個別指導が評判です。',
  });
});

test('あま本部校(branchId明示)を解析すると、辞書に「あま市」が適用され複合キーワードが0件にならない', async () => {
  const result = await resolvePageAnalyze({ dryRun: false, branchId: amaBranch.id });
  assert.equal(result.ok, true);
  assert.ok(result.stats.compounds_extracted > 0, '複合キーワードが0件のままなら辞書のねじれが再発している');

  const topics = require('../scripts/lib/db')
    .getDb()
    .prepare('SELECT normalized_keyword, target_area FROM seo_topics WHERE branch_id = :branch_id')
    .all({ branch_id: amaBranch.id });
  assert.ok(topics.some((t) => t.target_area === 'あま市'), 'あま市が地域キーワードとして抽出されていること');
  assert.ok(!topics.some((t) => t.target_area === '名古屋市守山区'), '小幡校の地域名(守山区)が混入していないこと');
});

test('小幡校(branchId明示)を解析すると、従来通り辞書に「名古屋市守山区」が適用される(あま市は混入しない)', async () => {
  // 前のテストであま本部のページは解析済み(last_analyzed_at設定済み)のため、対象は小幡校のページのみ
  const result = await resolvePageAnalyze({ dryRun: false, branchId: obataBranch.id });
  assert.equal(result.ok, true);
  assert.ok(result.stats.compounds_extracted > 0);

  const topics = require('../scripts/lib/db')
    .getDb()
    .prepare('SELECT normalized_keyword, target_area FROM seo_topics WHERE branch_id = :branch_id')
    .all({ branch_id: obataBranch.id });
  // normalizeKeyword()のstrip_nagoya_city_prefixルールにより「名古屋市守山区」は
  // 「守山区」に正規化されて保存される(このテストのバグ修正確認とは無関係の既存仕様)。
  assert.ok(topics.some((t) => t.target_area === '守山区'));
  assert.ok(!topics.some((t) => t.target_area === 'あま市'), 'あま本部の地域名(あま市)が混入していないこと');
});

test('存在しないbranch_idを指定するとapplyBranchAreaがthrowする(不正なbranch_idを黙って処理しない)', async () => {
  await assert.rejects(() => resolvePageAnalyze({ dryRun: false, branchId: 999999 }), /branch_id=999999 に該当する校舎が見つかりません/);
});
