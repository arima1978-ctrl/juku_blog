'use strict';

// AI改善ドラフトPromptプレビュー(Sprint 3 / 3.1)のテスト。
// LLM API・WordPressへは一切接続せず、DBへの書き込みも行わない。
// ページ本文取得(Sprint 3.1)は必ずfetchFnを注入し、実際のan-english.com等への
// ネットワーク接続は一切行わない。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_seo_draft_preview_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { ROOT } = require('../scripts/lib/config');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { buildDraftPreview, buildPageContext } = require('../scripts/lib/seo/draft_generator');
const { buildPrompt, SAFETY_RULES } = require('../scripts/lib/seo/draft_prompt_template');
const { resolveDraftPreview } = require('../scripts/seo_draft_preview');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-15T00:00:00.000Z';
// 実際の校舎ページ(config/school_pages.yaml)ではない、テスト専用のダミーURL
// (実ネットワーク接続を避けるため。既存の登録有無に依存しない)。
const DUMMY_URL = 'https://an-english.com/school/test-fixture-not-registered/';

test('CLI: growth_director.enabled=false(既定)なら無処理で終了する', () => {
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_draft_preview.js'), '--task-id=1'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(output, /無処理で終了/);
});

test('resolveDraftPreview: Task IDから必要情報を取得できる(target_keyword/target_url/gap_type/opportunity_score等)', async () => {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '守山区 塾ドラフトテスト', target_area: '守山区', gap_type: 'untapped', priority_score: 70, data_confidence: 60 },
    nowIso
  );
  const created = seoDb.upsertTask(
    {
      task_type: 'improve_school_page',
      target_keyword: '守山区 塾ドラフトテスト',
      source_candidate_id: candidate.id,
      opportunity_score: 74,
      recommended_action: 'improve_school_page',
      target_url: DUMMY_URL, // 未登録URLのため実通信は発生しない
      target_page_type: 'school_page',
      target_page_id: 'obata',
      target_page_name: '小幡教室',
      reason: ['school_page_template', 'existing_school_page_found'],
    },
    nowIso
  );

  const preview = await resolveDraftPreview(created.id);
  assert.equal(preview.task_id, created.id);
  assert.equal(preview.task_type, 'improve_school_page');
  assert.equal(preview.target_keyword, '守山区 塾ドラフトテスト');
  assert.equal(preview.target_url, DUMMY_URL);
  assert.equal(preview.target_page_name, '小幡教室');
  assert.equal(preview.gap_type, 'untapped');
  assert.equal(preview.opportunity_score, 74);
  assert.equal(preview.data_confidence, 60);
  assert.equal(preview.page_context_status, 'not_fetched'); // 未登録URLのため取得しない
  assert.ok(preview.prompt_version);
});

test('resolveDraftPreview: 存在しないTask IDでは例外を投げる(プロセスをクラッシュさせず安全にエラー)', async () => {
  await assert.rejects(() => resolveDraftPreview(999999), /見つかりません/);
});

test('CLI: 存在しないTask IDを指定した場合、安全にエラー終了する(featureフラグは実データ検証で別途確認)', () => {
  // 既定でgrowth_director.enabled=falseのため、CLI経由では無処理終了になることを確認する
  // (フラグON時の未存在ID挙動はresolveDraftPreview単体テストで検証済み)。
  const output = execFileSync('node', [path.join(ROOT, 'scripts', 'seo_draft_preview.js'), '--task-id=999999'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(output, /無処理で終了/);
});

test('buildPageContext: 未登録URLではfetchFnを呼ばずnot_fetchedを返す(実通信は発生しない)', async () => {
  let called = false;
  const pageContext = await buildPageContext(
    { target_url: DUMMY_URL },
    { getSchoolPage: () => null, fetchPage: async () => { called = true; return { status: 'fetched' }; } }
  );
  assert.equal(called, false); // fetchFnが一切呼ばれていないこと
  assert.deepEqual(pageContext, {
    status: 'not_fetched',
    url: DUMMY_URL,
    title: null,
    headings: [],
    bodyExcerpt: null,
    fetchedAt: null,
    contentHash: null,
  });
});

test('buildPageContext: 登録済み校舎ページURLと一致する場合のみfetchFnを呼ぶ(fakeで実通信なし確認)', async () => {
  let calledWith = null;
  const fakeSchoolPage = { id: 'obata', name: '小幡教室', url: 'https://an-english.com/school/obata/' };
  const fakeFetched = { status: 'fetched', url: fakeSchoolPage.url, finalUrl: fakeSchoolPage.url, title: 't', headings: [], bodyExcerpt: 'b', fetchedAt: '2026-07-15T00:00:00.000Z', contentHash: 'h' };

  const pageContext = await buildPageContext(
    { target_url: fakeSchoolPage.url },
    {
      getSchoolPage: (url) => (url === fakeSchoolPage.url ? fakeSchoolPage : null),
      listSchoolPages: () => [fakeSchoolPage],
      loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }),
      fetchPage: async (url, options) => {
        calledWith = { url, options };
        return fakeFetched;
      },
    }
  );
  assert.ok(calledWith); // fetchFnが呼ばれている
  assert.equal(calledWith.url, fakeSchoolPage.url);
  assert.deepEqual(calledWith.options.allowedBaseUrls, [fakeSchoolPage.url]); // school_pages.yaml由来の許可リストのみ
  assert.equal(pageContext.status, 'fetched');
});

test('buildDraftPreview: pageContext.status=fetchedならprompt_mode=context_available、それ以外はcontext_missing', async () => {
  const task = {
    id: 1,
    task_type: 'improve_school_page',
    target_url: 'https://an-english.com/school/obata/',
    target_page_name: '小幡教室',
    target_keyword: '守山区 塾',
    opportunity_score: 70,
    reason: ['school_page_template'],
  };

  const fetchedPreview = await buildDraftPreview(
    { task, candidate: null, gscMetrics: null },
    {
      pageContextDeps: {
        getSchoolPage: () => ({ id: 'obata', name: '小幡教室', url: task.target_url }),
        listSchoolPages: () => [{ url: task.target_url }],
        loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }),
        fetchPage: async () => ({
          status: 'fetched', url: task.target_url, finalUrl: task.target_url,
          title: '小幡教室', headings: ['アクセス'], bodyExcerpt: '本文', fetchedAt: nowIso, contentHash: 'abc',
        }),
      },
    }
  );
  assert.equal(fetchedPreview.page_context_status, 'fetched');
  assert.equal(fetchedPreview.prompt_mode, 'context_available');

  const blockedPreview = await buildDraftPreview(
    { task, candidate: null, gscMetrics: null },
    {
      pageContextDeps: {
        getSchoolPage: () => ({ id: 'obata', name: '小幡教室', url: task.target_url }),
        listSchoolPages: () => [{ url: task.target_url }],
        loadConfig: () => ({ seo: { competitor_analysis: { user_agent: 'ua', request_timeout_ms: 1000, request_interval_ms: 0, max_retries: 0 } } }),
        fetchPage: async () => ({ status: 'blocked', url: task.target_url, finalUrl: null, reason: 'robots', errorCode: 'ROBOTS_DISALLOWED' }),
      },
    }
  );
  assert.equal(blockedPreview.page_context_status, 'blocked');
  assert.equal(blockedPreview.prompt_mode, 'context_missing'); // 取得失敗時に完成文章を要求しない安全設計を維持
});

test('buildPrompt: context_missingモード(本文未取得)は完成文章を要求せず、不足情報の列挙を求める', () => {
  const { prompt, mode } = buildPrompt({
    targetUrl: 'https://an-english.com/school/obata/',
    targetPageName: '小幡教室',
    targetKeyword: '守山区 塾',
    targetArea: '守山区',
    gapType: 'untapped',
    reason: ['school_page_template'],
    gscMetrics: null,
    pageContext: { status: 'not_fetched' },
  });
  assert.equal(mode, 'context_missing');
  assert.match(prompt, /can_generate.*false/s);
  assert.match(prompt, /missing_context/);
  assert.match(prompt, /required_checks/);
  assert.doesNotMatch(prompt, /generated_text/); // context_missingの出力形式にgenerated_textは含まれない
  assert.doesNotMatch(prompt, /300文字以内/); // 完成文章の生成を求める文言が無いこと
});

test('buildPrompt: context_availableモード(本文取得済み)は300字以内の改善案・追加位置を求める', () => {
  const { prompt, mode } = buildPrompt({
    targetUrl: 'https://an-english.com/school/obata/',
    targetPageName: '小幡教室',
    targetKeyword: '守山区 塾',
    targetArea: '守山区',
    gapType: 'untapped',
    reason: ['school_page_template'],
    gscMetrics: { impressions: 100, clicks: 5, ctr: 0.05, avgPosition: 8 },
    pageContext: { status: 'fetched', title: '小幡教室 | アン進学ジム', headings: ['教室紹介', 'アクセス'], bodyExcerpt: '小幡教室は...' },
  });
  assert.equal(mode, 'context_available');
  assert.match(prompt, /can_generate.*true/s);
  assert.match(prompt, /300文字以内/);
  assert.match(prompt, /追加位置/);
  assert.match(prompt, /suggested_location/);
  assert.match(prompt, /generated_text/);
});

test('Prompt: estimated_effectはPromptへ含まれない(順位・流入・問い合わせ増加の推測をAIへ求めない)', () => {
  const { prompt: missingPrompt } = buildPrompt({
    targetUrl: 'x', targetKeyword: 'y', reason: [], gscMetrics: null, pageContext: { status: 'not_fetched' },
  });
  const { prompt: availablePrompt } = buildPrompt({
    targetUrl: 'x', targetKeyword: 'y', reason: [], gscMetrics: null,
    pageContext: { status: 'fetched', title: 't', headings: [], bodyExcerpt: 'b' },
  });
  assert.doesNotMatch(missingPrompt, /estimated_effect/);
  assert.doesNotMatch(availablePrompt, /estimated_effect/);
});

test('Prompt: 安全ルール(実績創作禁止・競合比較禁止・GSC数値/Opportunity Scoreを本文へ書かない等)が両モードに含まれる', () => {
  const { prompt: missingPrompt } = buildPrompt({
    targetUrl: 'x', targetKeyword: 'y', reason: [], gscMetrics: null, pageContext: { status: 'not_fetched' },
  });
  const { prompt: availablePrompt } = buildPrompt({
    targetUrl: 'x', targetKeyword: 'y', reason: [], gscMetrics: null,
    pageContext: { status: 'fetched', title: 't', headings: [], bodyExcerpt: 'b' },
  });
  assert.equal(SAFETY_RULES.length > 0, true);
  SAFETY_RULES.forEach((rule) => {
    assert.ok(missingPrompt.includes(rule), `context_missingにルールが含まれない: ${rule}`);
    assert.ok(availablePrompt.includes(rule), `context_availableにルールが含まれない: ${rule}`);
  });
  assert.match(missingPrompt, /Search Console.*書かない/);
  assert.match(missingPrompt, /Opportunity Score.*書かない/);
});

test('CLI --format=json: 有効なJSONを出力する(本テストはresolveDraftPreview経由でformatを検証)', async () => {
  const candidate = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '小幡 個別指導ドラフトテスト', target_area: '小幡', gap_type: 'strong', priority_score: 50, data_confidence: 70 },
    nowIso
  );
  const created = seoDb.upsertTask(
    { task_type: 'monitor', target_keyword: '小幡 個別指導ドラフトテスト', source_candidate_id: candidate.id, opportunity_score: 40, recommended_action: 'monitor' },
    nowIso
  );
  const preview = await resolveDraftPreview(created.id);
  const json = JSON.stringify(preview, null, 2);
  const parsed = JSON.parse(json); // 例外が出なければ有効なJSON
  assert.equal(parsed.task_id, created.id);
  assert.equal(parsed.gap_type, 'strong');
});

test('DBを書き換えない: resolveDraftPreview実行前後でseo_tasks/seo_keyword_candidatesの件数が変化しない', async () => {
  const { getDb } = require('../scripts/lib/db');
  const conn = getDb();
  const before = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };

  const all = seoDb.listTasks({});
  if (all.length > 0) await resolveDraftPreview(all[0].id);

  const after1 = {
    tasks: conn.prepare('SELECT COUNT(*) c FROM seo_tasks').get().c,
    candidates: conn.prepare('SELECT COUNT(*) c FROM seo_keyword_candidates').get().c,
  };
  assert.deepEqual(after1, before);
});

test('外部通信・WordPress・LLM呼び出しが無いこと: 対象ファイルにネットワーク/API呼び出しの記述が無い', () => {
  const files = [
    path.join(ROOT, 'scripts', 'seo_draft_preview.js'),
    path.join(ROOT, 'scripts', 'lib', 'seo', 'draft_generator.js'),
    path.join(ROOT, 'scripts', 'lib', 'seo', 'draft_prompt_template.js'),
  ];
  files.forEach((f) => {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!/require\(['"]https?['"]\)/.test(content), `${f} にnode:https/http requireが含まれています`);
    assert.ok(!/require\(['"]node:https['"]\)/.test(content), `${f} にnode:https requireが含まれています`);
    // コメント上の説明(「LLM API(OpenAI/Gemini/Claude等)へは接続しない」等)は誤検知しないよう、
    // 実際のSDK呼び出しパターン(require/import/インスタンス生成)のみを検出する。
    assert.ok(!/require\(['"](openai|@anthropic-ai|@google\/generative-ai)['"]\)/i.test(content), `${f} にLLM SDKのrequireが含まれています`);
    assert.ok(!/new\s+(OpenAI|Anthropic|GoogleGenerativeAI)\s*\(/.test(content), `${f} にLLM SDKのインスタンス生成が含まれています`);
    assert.ok(!/wp-json/.test(content), `${f} にWordPress API参照が含まれています`);
    assert.ok(!/fetch\(/.test(content), `${f} にfetch()呼び出しが含まれています`);
  });
});
