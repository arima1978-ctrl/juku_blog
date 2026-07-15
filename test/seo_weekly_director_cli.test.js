'use strict';

// Sprint 3.9: scripts/seo_weekly_director.js(週次選定・Prompt事前生成・保存)のテスト。
// fakeテストでは実DB・実ネットワーク接続を避けるため、seoDbImpl/curateWeeklyTasksImpl/
// dispatchWeeklyDraftsImplを注入する。CLIサブプロセステストは必ず一時SQLite
// (JUKU_BLOG_DB_PATH)・一時config(JUKU_BLOG_CONFIG_PATH)を使う。

const os = require('node:os');
const path = require('node:path');
const TMP_DB = path.join(os.tmpdir(), `juku_blog_weekly_director_cli_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const yaml = require('js-yaml');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { resolveWeeklyDirector, mondayOfWeek, mergeItems, parseArgs } = require('../scripts/seo_weekly_director');
const { promptFilePath } = require('../scripts/lib/seo/weekly_draft_dispatcher');

const TMP_CONFIG = path.join(os.tmpdir(), `juku_blog_weekly_director_config_${process.pid}.yaml`);

// CLIサブプロセステスト(下記)は既定のoutputDir(data/seo_drafts、CLIに上書き
// オプションが無いため)を実際に使うため、生成されるPromptファイルを明示的に
// 記録して後始末する(data/seo_drafts/自体はgitignore対象だが、テスト実行後の
// ローカル作業ディレクトリを汚さないため)。
const CLI_INTEGRATION_BATCH_DATE = '2026-07-13';
const CLI_INTEGRATION_TASK_IDS = [1, 2, 3];

after(() => {
  closeDb();
  [TMP_DB, TMP_CONFIG].forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  });
  CLI_INTEGRATION_TASK_IDS.forEach((id) => {
    try {
      fs.unlinkSync(promptFilePath(path.join(ROOT, 'data', 'seo_drafts'), CLI_INTEGRATION_BATCH_DATE, id));
    } catch {
      // 既に無ければ無視
    }
  });
});

const nowIso = '2026-07-13T09:00:00.000Z';

test('mondayOfWeek: 水曜日(2026-07-15)は同じ週の月曜日(2026-07-13)を返す', () => {
  assert.equal(mondayOfWeek(new Date(2026, 6, 15)), '2026-07-13');
});

test('mondayOfWeek: 月曜日自身はそのままの日付を返す', () => {
  assert.equal(mondayOfWeek(new Date(2026, 6, 13)), '2026-07-13');
});

test('mondayOfWeek: 日曜日は前日までを含む週の月曜日を返す', () => {
  assert.equal(mondayOfWeek(new Date(2026, 6, 19)), '2026-07-13');
});

test('mergeItems: タスク本体の情報とdispatch結果をtaskId単位でマージする', () => {
  const tasks = [
    { id: 1, task_type: 'improve_school_page', target_keyword: 'k1', roi_priority_score: 80, opportunity_score: 70, difficulty_score: 30, expected_impact_cv: 1.2, expected_impact_clicks: 50, estimated_effort_minutes: 10 },
  ];
  const dispatched = [{ taskId: 1, draftStatus: 'prompt_generated', draftPromptPath: '/tmp/x.json', pagePlanId: 5, pagePlanStatus: 'approved' }];
  const merged = mergeItems(tasks, dispatched);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].taskId, 1);
  assert.equal(merged[0].draftStatus, 'prompt_generated');
  assert.equal(merged[0].draftPromptPath, '/tmp/x.json');
  assert.equal(merged[0].roiPriorityScore, 80);
  assert.equal(merged[0].pagePlanId, 5);
});

test('mergeItems: dispatch結果が無いタスクはdraftStatus等がnullになる(存在しない添字アクセスにならない)', () => {
  const tasks = [{ id: 99, task_type: 'create_article', target_keyword: 'k', roi_priority_score: null, opportunity_score: 50, estimated_effort_minutes: 5 }];
  const merged = mergeItems(tasks, []);
  assert.equal(merged[0].draftStatus, null);
  assert.equal(merged[0].draftPromptPath, null);
});

test('resolveWeeklyDirector: dry-run(save=false)ではupsertWeeklyRecommendationを呼ばずDB非更新', async () => {
  let upsertCalled = false;
  const fakeSeoDb = {
    listTasks: () => [{ id: 1, task_type: 'improve_school_page', target_keyword: 'k', roi_priority_score: 90, opportunity_score: 80, estimated_effort_minutes: 10, expected_impact_cv: 1.0 }],
    upsertWeeklyRecommendation: () => {
      upsertCalled = true;
      return {};
    },
  };
  const result = await resolveWeeklyDirector({
    save: false,
    seoDbImpl: fakeSeoDb,
    curateWeeklyTasksImpl: (tasks) => ({ selectedTasks: tasks, totalExpectedCv: 1.0, totalEffortMinutes: 10, taskTypeBreakdown: { improve_school_page: 1 }, curationTier: 'strict' }),
    dispatchWeeklyDraftsImpl: async (tasks) => tasks.map((t) => ({ taskId: t.id, draftStatus: 'prompt_generated', draftPromptPath: '/tmp/x', pagePlanId: null, pagePlanStatus: null })),
    now: new Date(2026, 6, 15),
  });

  assert.equal(result.saved, false);
  assert.equal(upsertCalled, false);
  assert.equal(result.batchDate, '2026-07-13');
  assert.equal(result.items.length, 1);
});

test('resolveWeeklyDirector: save=trueならupsertWeeklyRecommendationが正しい引数で呼ばれる', async () => {
  let savedRec = null;
  const fakeSeoDb = {
    listTasks: () => [{ id: 1, task_type: 'improve_school_page', target_keyword: 'k', roi_priority_score: 90, opportunity_score: 80, estimated_effort_minutes: 10, expected_impact_cv: 1.0 }],
    upsertWeeklyRecommendation: (rec) => {
      savedRec = rec;
      return { id: 1, isNew: true, locked: false };
    },
  };
  const result = await resolveWeeklyDirector({
    save: true,
    seoDbImpl: fakeSeoDb,
    curateWeeklyTasksImpl: (tasks) => ({ selectedTasks: tasks, totalExpectedCv: 1.0, totalEffortMinutes: 10, taskTypeBreakdown: { improve_school_page: 1 }, curationTier: 'strict' }),
    dispatchWeeklyDraftsImpl: async (tasks) => tasks.map((t) => ({ taskId: t.id, draftStatus: 'prompt_generated', draftPromptPath: '/tmp/x', pagePlanId: null, pagePlanStatus: null })),
    now: new Date(2026, 6, 15),
    nowIso,
  });

  assert.equal(result.saved, true);
  assert.equal(result.saveResult.isNew, true);
  assert.equal(savedRec.batchDate, '2026-07-13');
  assert.deepEqual(savedRec.taskIds, [1]);
  assert.equal(savedRec.totalExpectedCv, 1.0);
  assert.equal(savedRec.curationTier, 'strict');
  assert.equal(savedRec.items.length, 1);
});

test('CLI: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_weekly_director.js'), '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(output, /無処理で終了/);
});

test('parseArgs: --dry-runと--saveの両方指定を検出できる', () => {
  const args = parseArgs(['--dry-run', '--save']);
  assert.equal(args.dryRun, true);
  assert.equal(args.save, true);
});

function writeEnabledConfig() {
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'juku.yaml'), 'utf8'));
  config.features.growth_director.enabled = true;
  fs.writeFileSync(TMP_CONFIG, yaml.dump(config), 'utf8');
}

test('CLI統合: 一時DB上でTaskを準備し--dry-run実行するとDBは変化せずプレビューが出力される', () => {
  writeEnabledConfig();

  const nowIsoSeed = '2026-07-13T00:00:00.000Z';
  for (let i = 0; i < 3; i += 1) {
    const candidate = seoDb.upsertKeywordCandidate(
      { normalized_keyword: `週次CLI統合テスト${i}`, target_area: 'x', gap_type: 'missing', priority_score: 70, data_confidence: 75, search_intent: 'general_service', template_type: 'area_koko_nyushi' },
      nowIsoSeed
    );
    seoDb.upsertTask(
      {
        task_type: 'create_article',
        target_keyword: `週次CLI統合テスト${i}`,
        source_candidate_id: candidate.id,
        opportunity_score: 60 + i,
        recommended_action: 'create_article',
        estimated_effort_minutes: 10,
        roi_priority_score: 50 + i * 10,
        expected_impact_cv: 0.5,
      },
      nowIsoSeed
    );
  }
  closeDb();

  const before = seoDb.listTasks({});
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_weekly_director.js'), '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB, JUKU_BLOG_CONFIG_PATH: TMP_CONFIG },
  });

  assert.match(output, /batchDate:/);
  assert.match(output, /今週の仕事/);
  assert.match(output, /saved: false/);

  const after = seoDb.listTasks({});
  assert.equal(after.length, before.length); // Task件数は不変
  const rec = seoDb.getWeeklyRecommendation(mondayOfWeek(new Date()));
  assert.equal(rec, null); // dry-runなのでweekly_recommendationsは保存されない
});
