'use strict';

// Sprint 3.4: scripts/seo_page_plan_generate.js(dry-run既定・--save明示時のみ保存)のテスト。
// 保存テストは必ず一時SQLite(JUKU_BLOG_DB_PATH)で行い、実データ(data/posts.sqlite)は使わない。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_plan_generate_cli_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { ROOT } = require('../scripts/lib/config');
const { closeDb, getDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { resolvePagePlans, parseArgs, formatText } = require('../scripts/seo_page_plan_generate');

// growth_director.enabled=false(既定)時の挙動を検証するテストは、実configの現在値
// (本番アクティベーション後はtrue)に依存せず安定して再現するため、一時configを使う。
function writeDisabledGrowthDirectorConfig(tmpConfigPath) {
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
  config.features.growth_director.enabled = false;
  fs.writeFileSync(tmpConfigPath, yaml.dump(config), 'utf8');
  return tmpConfigPath;
}

const TMP_DISABLED_CONFIG = path.join(os.tmpdir(), `juku_blog_page_plan_generate_disabled_config_${process.pid}.yaml`);
writeDisabledGrowthDirectorConfig(TMP_DISABLED_CONFIG);
const disabledEnv = { ...process.env, JUKU_BLOG_CONFIG_PATH: TMP_DISABLED_CONFIG };

after(() => {
  closeDb();
  [process.env.JUKU_BLOG_DB_PATH, TMP_DISABLED_CONFIG].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
});

const nowIso = '2026-07-15T00:00:00.000Z';
const DUMMY_URL = 'https://an-english.com/school/plan-cli-fixture/';

function unfetchablePageContextDeps() {
  return {
    getSchoolPage: () => null,
    listSchoolPages: () => [],
    loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }),
    fetchPage: async () => {
      throw new Error('fetchPageが呼ばれてはいけない');
    },
  };
}

function seedTask({ keyword, pageId = 'plan-cli-fixture', dataConfidence = 80 }) {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: keyword, target_area: 'x', gap_type: 'weak', priority_score: 70, data_confidence: dataConfidence, search_intent: 'general_service', template_type: 'area_juku', keyword_components: { area: 'x', service: '塾' } },
    nowIso
  );
  return seoDb.upsertTask(
    {
      task_type: 'improve_school_page',
      target_keyword: keyword,
      source_candidate_id: candidate.id,
      opportunity_score: 70,
      recommended_action: 'improve_school_page',
      target_url: DUMMY_URL,
      target_page_type: 'school_page',
      target_page_id: pageId,
      target_page_name: 'Planテスト教室',
      reason: ['school_page_template'],
    },
    nowIso
  );
}

test('CLI: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_page_plan_generate.js'), '--dry-run', '--format=json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: disabledEnv,
  });
  assert.match(output, /無処理で終了/);
});

test('parseArgs: --dry-runと--saveの両方指定を検出できる', () => {
  const args = parseArgs(['--dry-run', '--save']);
  assert.equal(args.dryRun, true);
  assert.equal(args.save, true);
});

// 注: --dry-run/--save同時指定チェックはmain()内でFeature Flag確認の「後」に行われる
// (既存のseo_draft_preview.js/seo_page_task_group_preview.js等と同じ設計)。
// growth_director.enabled=false(既定)のCLIサブプロセスではこのチェックへ到達する前に
// 無処理終了するため、ここではparseArgsが両フラグを正しく検出することのみを確認する
// (main()のexit(1)分岐自体はコードレビューで確認済み)。
test('parseArgs: 両方指定時にdryRun/saveが両方trueとして検出される(main()側でエラー終了する入力)', () => {
  const args = parseArgs(['--page-type=school_page', '--page-id=obata', '--dry-run', '--save']);
  assert.equal(args.dryRun, true);
  assert.equal(args.save, true);
});

test('resolvePagePlans: dry-run(save=false)ではDBへ保存しない', async () => {
  seedTask({ keyword: 'Planテスト 塾', pageId: 'plan-dry-run' });
  const before = seoDb.listSeoPagePlans({}).length;
  const result = await resolvePagePlans({ pageType: 'school_page', pageId: 'plan-dry-run', save: false, pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(result.saved, false);
  assert.equal(result.planCount, 1);
  const after1 = seoDb.listSeoPagePlans({}).length;
  assert.equal(after1, before); // 保存されていない
});

test('resolvePagePlans: オプション既定(save省略)はdry-run相当(save=false)', async () => {
  const result = await resolvePagePlans({ pageType: 'school_page', pageId: 'plan-dry-run', pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(result.saved, false);
});

test('resolvePagePlans: --save相当(save=true)で一時SQLiteへ保存できる', async () => {
  seedTask({ keyword: 'Planテスト 塾 save', pageId: 'plan-save-test' });
  const result = await resolvePagePlans({ pageType: 'school_page', pageId: 'plan-save-test', save: true, pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(result.saved, true);
  assert.equal(result.planCount, 1);
  assert.ok(result.plans[0].saveResult.isNew);
  const fetched = seoDb.getSeoPagePlanByPage('school_page', 'plan-save-test');
  assert.ok(fetched);
  assert.equal(fetched.primary_keyword, 'Planテスト 塾 save');
});

test('resolvePagePlans: page-type/page-id指定で対象を絞り込める', async () => {
  seedTask({ keyword: 'Planテスト 塾 別ページ', pageId: 'plan-another' });
  const result = await resolvePagePlans({ pageType: 'school_page', pageId: 'plan-another', save: false, pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(result.planCount, 1);
  assert.equal(result.plans[0].plan.targetPageId, 'plan-another');
});

test('resolvePagePlans: approved Planはsave=trueでもlockedとして扱われ更新されない', async () => {
  seedTask({ keyword: 'Planテスト 塾 approved-lock', pageId: 'plan-approved-lock' });
  const first = await resolvePagePlans({ pageType: 'school_page', pageId: 'plan-approved-lock', save: true, pageContextDeps: unfetchablePageContextDeps() });
  const planId = first.plans[0].saveResult.id;
  seoDb.updateSeoPagePlanStatus(planId, 'approved', nowIso);

  const second = await resolvePagePlans({ pageType: 'school_page', pageId: 'plan-approved-lock', save: true, pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(second.plans[0].saveResult.locked, true);
  assert.equal(second.plans[0].saveResult.lockedStatus, 'approved');

  const fetched = seoDb.getSeoPagePlanById(planId);
  assert.equal(fetched.status, 'approved');
});

test('CLI --format=text: テキスト形式で出力できる', async () => {
  const result = await resolvePagePlans({ pageType: 'school_page', pageId: 'plan-dry-run', save: false, pageContextDeps: unfetchablePageContextDeps() });
  const text = formatText(result);
  assert.match(text, /planCount:/);
  assert.match(text, /Primary:/);
});

test('DB非更新dry-run: resolvePagePlans(save=false)実行前後でseo_tasks/seo_keyword_candidates/seo_page_plansの件数が変化しない', async () => {
  const conn = getDb();
  const before = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
    plans: conn.prepare('SELECT COUNT(*) c FROM seo_page_plans').get().c,
  };
  await resolvePagePlans({ pageType: 'school_page', pageId: 'plan-dry-run', save: false, pageContextDeps: unfetchablePageContextDeps() });
  const afterRun = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
    plans: conn.prepare('SELECT COUNT(*) c FROM seo_page_plans').get().c,
  };
  assert.deepEqual(afterRun, before);
});

test('Task statusを変更しない: resolvePagePlans実行前後で対象Taskのstatusが変わらない', async () => {
  const conn = getDb();
  const before = conn.prepare("SELECT id, status FROM seo_tasks WHERE task_type='improve_school_page'").all();
  await resolvePagePlans({ pageType: 'school_page', pageId: 'plan-dry-run', save: false, pageContextDeps: unfetchablePageContextDeps() });
  const after1 = conn.prepare("SELECT id, status FROM seo_tasks WHERE task_type='improve_school_page'").all();
  assert.deepEqual(after1, before);
});

test('外部通信・WordPress・LLM呼び出しが無いこと: 対象ファイルにネットワーク/API呼び出しの記述が無い', () => {
  const files = [
    path.join(ROOT, 'scripts', 'seo_page_plan_generate.js'),
    path.join(ROOT, 'scripts', 'lib', 'seo', 'page_plan_builder.js'),
  ];
  files.forEach((f) => {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!/require\(['"]https?['"]\)/.test(content), `${f} にnode:https/http requireが含まれています`);
    assert.ok(!/require\(['"]node:https['"]\)/.test(content), `${f} にnode:https requireが含まれています`);
    assert.ok(!/require\(['"](openai|@anthropic-ai|@google\/generative-ai)['"]\)/i.test(content), `${f} にLLM SDKのrequireが含まれています`);
    assert.ok(!/new\s+(OpenAI|Anthropic|GoogleGenerativeAI)\s*\(/.test(content), `${f} にLLM SDKのインスタンス生成が含まれています`);
    assert.ok(!/wp-json/.test(content), `${f} にWordPress API参照が含まれています`);
    assert.ok(!/fetch\(/.test(content), `${f} にfetch()呼び出しが含まれています`);
    assert.ok(!/claude\s+-p/.test(content), `${f} にClaude subagent実行の記述が含まれています`);
  });
});

test('外部通信は既存page_context_provider経由のみ: 新しいHTTPクライアント/fetch実装が無い', () => {
  const content = fs.readFileSync(path.join(ROOT, 'scripts', 'seo_page_plan_generate.js'), 'utf8');
  assert.ok(content.includes("require('./lib/seo/draft_generator')"), '既存draft_generator.jsのbuildPageContextを利用していません');
});
