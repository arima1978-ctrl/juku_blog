'use strict';

// Sprint 3.3/3.3.1: scripts/seo_page_task_group_preview.js(dry-run CLI)のテスト。
// DB書き込み・LLM呼び出し・外部通信・WordPress接続は一切発生しない。
// pageContext取得はbuildPageContext(既存draft_generator.js)経由のため、fakeテストでは
// 必ずpageContextDepsを注入し、実ネットワーク接続を避ける。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_page_task_group_preview_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { ROOT } = require('../scripts/lib/config');
const { closeDb, getDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { resolveGroupPreview } = require('../scripts/seo_page_task_group_preview');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-15T00:00:00.000Z';
const DUMMY_URL = 'https://an-english.com/school/cli-fixture-not-registered/';

// 実通信を避けるため、DUMMY_URLを「登録済み校舎ページ」としてfakeする依存注入。
// bodyExcerptに実際に含める語句はテストごとに変えられるようbodyパラメータを受け取る。
function fakePageContextDeps({ title = '', headings = [], bodyExcerpt = '' } = {}) {
  return {
    getSchoolPage: (url) => (url === DUMMY_URL ? { id: 'cli-fixture', name: 'CLIテスト教室', url: DUMMY_URL } : null),
    listSchoolPages: () => [{ url: DUMMY_URL }],
    loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }),
    fetchPage: async () => ({
      status: 'fetched', url: DUMMY_URL, finalUrl: DUMMY_URL, title, headings, bodyExcerpt, fetchedAt: nowIso, contentHash: 'abc',
    }),
  };
}

function unfetchablePageContextDeps() {
  return {
    getSchoolPage: () => null, // 未登録扱い→fetchPage自体が呼ばれない
    listSchoolPages: () => [],
    loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }),
    fetchPage: async () => {
      throw new Error('fetchPageが呼ばれてはいけない');
    },
  };
}

function seedTask({ keyword, taskType = 'improve_school_page', pageId = 'cli-fixture', gapType = 'weak', dataConfidence = 70, searchIntent = 'general_service', templateType = 'area_juku', keywordComponents = { area: 'x', service: '塾' }, opportunityScore = 70 }) {
  const candidate = seoDb.upsertKeywordCandidate(
    {
      normalized_keyword: keyword,
      target_area: 'x',
      gap_type: gapType,
      priority_score: 70,
      data_confidence: dataConfidence,
      search_intent: searchIntent,
      template_type: templateType,
      keyword_components: keywordComponents,
    },
    nowIso
  );
  return seoDb.upsertTask(
    {
      task_type: taskType,
      target_keyword: keyword,
      source_candidate_id: candidate.id,
      opportunity_score: opportunityScore,
      recommended_action: taskType,
      target_url: taskType === 'improve_school_page' ? DUMMY_URL : null,
      target_page_type: taskType === 'improve_school_page' ? 'school_page' : null,
      target_page_id: taskType === 'improve_school_page' ? pageId : null,
      target_page_name: taskType === 'improve_school_page' ? 'CLIテスト教室' : null,
      reason: ['school_page_template'],
    },
    nowIso
  );
}

test('CLI: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_page_task_group_preview.js'), '--format=json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(output, /無処理で終了/);
});

test('resolveGroupPreview: 同一ページの複数Taskを1グループへまとめ、fake pageContextでprimary/supporting(verified)/excludedを返す', async () => {
  seedTask({ keyword: 'CLIテスト 塾', gapType: 'weak', dataConfidence: 80, opportunityScore: 70 });
  seedTask({ keyword: 'CLIテスト 個別指導', gapType: 'untapped', dataConfidence: 50, templateType: 'area_teaching_style', keywordComponents: { area: 'x', teaching_style: '個別指導' }, opportunityScore: 60 });
  seedTask({ keyword: 'CLIテスト 無料体験', gapType: 'untapped', dataConfidence: 20, searchIntent: 'trial_inquiry', templateType: 'area_muryou_taiken', keywordComponents: { area: 'x', exam: '無料体験' }, opportunityScore: 65 });

  const pageContextDeps = fakePageContextDeps({ bodyExcerpt: '当教室では個別指導を行っています。' });
  const preview = await resolveGroupPreview({ pageType: 'school_page', pageId: 'cli-fixture', pageContextDeps });
  assert.equal(preview.groupCount, 1);
  const group = preview.groups[0];
  assert.equal(group.groupKey, 'school_page:cli-fixture');
  assert.equal(group.primaryTask.targetKeyword, 'CLIテスト 塾');
  const supportingKobetsu = group.supportingTasks.find((t) => t.targetKeyword === 'CLIテスト 個別指導');
  assert.ok(supportingKobetsu);
  assert.equal(supportingKobetsu.factStatus, 'verified');
  assert.ok(group.excludedTasks.some((t) => t.targetKeyword === 'CLIテスト 無料体験' && t.reason === 'separate_section_intent'));
});

test('resolveGroupPreview: ページ本文に根拠が無いSupportingはunverifiedとしてExcludedへ移動する', async () => {
  const pageContextDeps = fakePageContextDeps({ bodyExcerpt: '英会話・そろばん・プログラミングのみ紹介しています。' });
  const preview = await resolveGroupPreview({ pageType: 'school_page', pageId: 'cli-fixture', pageContextDeps });
  const group = preview.groups[0];
  assert.ok(!group.supportingTasks.some((t) => t.targetKeyword === 'CLIテスト 個別指導'));
  const excluded = group.excludedTasks.find((t) => t.targetKeyword === 'CLIテスト 個別指導');
  assert.equal(excluded.reason, 'supporting_fact_unverified');
  assert.equal(excluded.factStatus, 'unverified');
});

test('page取得失敗(未登録URL)時はSupportingをunverifiedにする(fetchPage自体は呼ばれない)', async () => {
  const preview = await resolveGroupPreview({ pageType: 'school_page', pageId: 'cli-fixture', pageContextDeps: unfetchablePageContextDeps() });
  const group = preview.groups[0];
  assert.ok(!group.supportingTasks.some((t) => t.targetKeyword === 'CLIテスト 個別指導'));
  const excluded = group.excludedTasks.find((t) => t.targetKeyword === 'CLIテスト 個別指導');
  assert.equal(excluded.reason, 'supporting_fact_unverified');
});

test('resolveGroupPreview: page-type/page-id指定で対象を絞り込める', async () => {
  seedTask({ keyword: '別ページテスト 塾', pageId: 'another-fixture', gapType: 'weak', dataConfidence: 90 });
  const preview = await resolveGroupPreview({ pageType: 'school_page', pageId: 'another-fixture', pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(preview.groupCount, 1);
  assert.equal(preview.groups[0].groupKey, 'school_page:another-fixture');
});

test('resolveGroupPreview: 出力JSONが有効なJSONである', async () => {
  const preview = await resolveGroupPreview({ pageContextDeps: unfetchablePageContextDeps() });
  const json = JSON.stringify(preview, null, 2);
  const parsed = JSON.parse(json);
  assert.ok(parsed.groupCount >= 1);
  assert.ok(Array.isArray(parsed.groups));
  assert.ok(Array.isArray(parsed.ungrouped));
  assert.ok(Array.isArray(parsed.warnings));
});

test('CLI --format=text: テキスト形式で出力できる', async () => {
  const { formatText } = require('../scripts/seo_page_task_group_preview');
  const preview = await resolveGroupPreview({ pageType: 'school_page', pageId: 'cli-fixture', pageContextDeps: unfetchablePageContextDeps() });
  const text = formatText(preview);
  assert.match(text, /groupCount:/);
  assert.match(text, /school_page:cli-fixture/);
});

test('入力不正: 存在しないpage-idを指定した場合はgroupCount=0で安全に終了する(例外を投げない)', async () => {
  const preview = await resolveGroupPreview({ pageType: 'school_page', pageId: 'does-not-exist', pageContextDeps: unfetchablePageContextDeps() });
  assert.equal(preview.groupCount, 0);
});

test('DBを書き換えない: resolveGroupPreview実行前後でseo_tasks/seo_keyword_candidatesの件数が変化しない', async () => {
  const conn = getDb();
  const before = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  await resolveGroupPreview({ pageContextDeps: unfetchablePageContextDeps() });
  const after1 = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  assert.deepEqual(after1, before);
});

test('Task statusを変更しない: resolveGroupPreview実行前後で対象Taskのstatusが変わらない', async () => {
  const conn = getDb();
  const statusesBefore = conn.prepare("SELECT id, status FROM seo_tasks WHERE task_type='improve_school_page'").all();
  await resolveGroupPreview({ pageContextDeps: unfetchablePageContextDeps() });
  const statusesAfter = conn.prepare("SELECT id, status FROM seo_tasks WHERE task_type='improve_school_page'").all();
  assert.deepEqual(statusesAfter, statusesBefore);
});

test('外部通信・WordPress・LLM呼び出しが無いこと: 対象ファイルにネットワーク/API呼び出しの記述が無い', () => {
  const files = [
    path.join(ROOT, 'scripts', 'seo_page_task_group_preview.js'),
    path.join(ROOT, 'scripts', 'lib', 'seo', 'page_task_grouper.js'),
    path.join(ROOT, 'scripts', 'lib', 'seo', 'supporting_task_fact_checker.js'),
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
  const content = fs.readFileSync(path.join(ROOT, 'scripts', 'seo_page_task_group_preview.js'), 'utf8');
  assert.ok(content.includes("require('./lib/seo/draft_generator')"), '既存draft_generator.jsのbuildPageContextを利用していません');
});
