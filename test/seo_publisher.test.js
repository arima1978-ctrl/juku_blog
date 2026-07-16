'use strict';

// Sprint 4.1: scripts/seo_publisher.js(自律パブリッシュバッチ)の結合テスト。
// LLM API・Claude Code subagent・WordPress APIへは一切接続せず、wordpressImplを
// 注入したfakeで代替する。DB(seo_weekly_recommendations)は実際のSQLite(一時ファイル)
// を使い、状態遷移が正しく永続化されることを検証する。

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_seo_publisher_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { closeDb } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const branchesDb = require('../scripts/lib/branches_db');
const { resolvePublisher, publishOneItem, resultFilePathFor } = require('../scripts/seo_publisher');

const TMP_DIR = path.join(os.tmpdir(), `juku_blog_seo_publisher_prompts_${process.pid}`);
fs.mkdirSync(TMP_DIR, { recursive: true });

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // 既に無ければ無視
  }
});

const nowIso = '2026-07-20T00:00:00.000Z';
let batchCounter = 0;

function nextBatchDate() {
  batchCounter += 1;
  return `2099-01-${String(batchCounter).padStart(2, '0')}`;
}

function writeResultFile(fileName, content) {
  const filePath = path.join(TMP_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(content), 'utf8');
  return filePath;
}

// 実DB(seo_weekly_recommendations)へ、create_article Taskを含む'approved'な
// 週次バンドルを直接投入する。promptFilePath相当の絶対パスを組み立て、対応する
// result.jsonを別途writeResultFileで書く想定(呼び出し側が用意する)。
function seedApprovedRecommendation(batchDate, items) {
  // resolvePublisherの?branch_id省略時は現在アクティブな校舎にフォールバックするため、
  // シード時点でconfig由来の自動作成校舎(アクティブ)のIDを明示的に紐づけておく。
  const activeBranchId = branchesDb.getActiveBranch().id;
  seoDb.upsertWeeklyRecommendation(
    {
      batchDate,
      branchId: activeBranchId,
      status: 'proposed',
      taskIds: items.map((i) => i.taskId),
      items,
      totalExpectedCv: 0.5,
      totalEffortMinutes: 30,
      taskTypeBreakdown: { create_article: items.length },
      curationTier: 'strict',
      curationParams: {},
    },
    nowIso
  );
  seoDb.transitionWeeklyRecommendationStatus(
    { batchDate, expectedCurrentStatus: 'proposed', nextStatus: 'approved', branchId: activeBranchId },
    nowIso
  );
}

function fakeWordpress(overrides = {}) {
  return {
    createDraftPost: async () => ({ wpPostId: 12345, link: 'https://an-english.com/?p=12345', status: 'draft' }),
    ...overrides,
  };
}

test('resultFilePathFor: .prompt.jsonを.result.jsonへ置き換える', () => {
  assert.equal(
    resultFilePathFor('data\\seo_drafts\\weekly_2026-07-13_task_57.prompt.json'),
    'data\\seo_drafts\\weekly_2026-07-13_task_57.result.json'
  );
  assert.equal(resultFilePathFor(null), null);
  assert.equal(resultFilePathFor('data/seo_drafts/not_a_prompt_file.json'), null);
});

test('正常系: approvedな週次推薦の未処理create_article Taskがpublished_draftへ遷移しwp_post_idが記録される', async () => {
  const batchDate = nextBatchDate();
  const resultPath = writeResultFile(`${batchDate}_task_1.result.json`, {
    can_generate: true,
    title: '守山区の個別指導塾なら',
    body_html: '<p>守山区で個別指導をお探しの方へ。</p>',
    meta_description: '守山区の個別指導塾の紹介です。',
    warnings: [],
  });
  const draftPromptPath = resultPath.replace(/\.result\.json$/, '.prompt.json');

  seedApprovedRecommendation(batchDate, [
    {
      taskId: 1,
      taskType: 'create_article',
      targetKeyword: '守山区 個別指導',
      roiPriorityScore: 80,
      opportunityScore: 70,
      difficultyScore: 20,
      expectedImpactCv: 0.5,
      expectedImpactClicks: 10,
      estimatedEffortMinutes: 30,
      draftStatus: 'prompt_generated',
      draftPromptPath,
      pagePlanId: null,
      pagePlanStatus: null,
      wpPostId: null,
    },
  ]);

  const result = await resolvePublisher({ batchDate, save: true, wordpressImpl: fakeWordpress(), nowIso });

  assert.equal(result.found, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].outcome, 'published');
  assert.equal(result.results[0].wpPostId, 12345);
  assert.equal(result.archived, true, '唯一の対象Taskが成功したのでarchivedへ遷移するべき');

  const rec = seoDb.getWeeklyRecommendation(batchDate, branchesDb.getActiveBranch().id);
  assert.equal(rec.status, 'archived');
  assert.equal(rec.items[0].wpPostId, 12345);
  assert.equal(rec.items[0].draftStatus, 'published_draft');
});

test('冪等性: 既にwp_post_idが記録済みのTaskはWordPressへ再送されずスキップされる', async () => {
  const batchDate = nextBatchDate();
  let createDraftPostCalls = 0;

  seedApprovedRecommendation(batchDate, [
    {
      taskId: 2,
      taskType: 'create_article',
      targetKeyword: '瓢箪山 塾',
      draftStatus: 'published_draft',
      draftPromptPath: 'data\\seo_drafts\\dummy.prompt.json',
      wpPostId: 555,
    },
  ]);

  const wp = fakeWordpress({
    createDraftPost: async () => {
      createDraftPostCalls += 1;
      throw new Error('この関数は呼ばれてはいけない');
    },
  });

  const result = await resolvePublisher({ batchDate, save: true, wordpressImpl: wp, nowIso });

  assert.equal(result.results[0].outcome, 'already_published');
  assert.equal(result.results[0].wpPostId, 555);
  assert.equal(createDraftPostCalls, 0, 'createDraftPostは一度も呼ばれてはいけない');

  const rec = seoDb.getWeeklyRecommendation(batchDate, branchesDb.getActiveBranch().id);
  assert.equal(rec.items[0].wpPostId, 555, 'DBの値も変化しないべき');
});

test('エラー系: WordPress APIが一時的に失敗した場合、そのTaskのみ影響を受け他のTaskは正常に処理される', async () => {
  const batchDate = nextBatchDate();

  const resultPathOk = writeResultFile(`${batchDate}_task_4.result.json`, {
    can_generate: true,
    title: '正常に投稿されるはずの記事',
    body_html: '<p>本文です。</p>',
    meta_description: '概要です。',
    warnings: [],
  });
  const resultPathFail = writeResultFile(`${batchDate}_task_3.result.json`, {
    can_generate: true,
    title: 'WordPress側が失敗するはずの記事',
    body_html: '<p>本文です。</p>',
    meta_description: '概要です。',
    warnings: [],
  });

  seedApprovedRecommendation(batchDate, [
    {
      taskId: 3,
      taskType: 'create_article',
      targetKeyword: '失敗ケース',
      draftStatus: 'prompt_generated',
      draftPromptPath: resultPathFail.replace(/\.result\.json$/, '.prompt.json'),
      wpPostId: null,
    },
    {
      taskId: 4,
      taskType: 'create_article',
      targetKeyword: '成功ケース',
      draftStatus: 'prompt_generated',
      draftPromptPath: resultPathOk.replace(/\.result\.json$/, '.prompt.json'),
      wpPostId: null,
    },
  ]);

  const wp = fakeWordpress({
    createDraftPost: async ({ title }) => {
      if (title === 'WordPress側が失敗するはずの記事') {
        const err = new Error('WordPress API POST posts が 500 を返しました');
        err.statusCode = 500;
        throw err;
      }
      return { wpPostId: 777, link: 'https://an-english.com/?p=777', status: 'draft' };
    },
  });

  const result = await resolvePublisher({ batchDate, save: true, wordpressImpl: wp, nowIso });

  const failedResult = result.results.find((r) => r.taskId === 3);
  const okResult = result.results.find((r) => r.taskId === 4);

  assert.equal(failedResult.outcome, 'publish_failed');
  assert.match(failedResult.error, /500/);
  assert.equal(okResult.outcome, 'published');
  assert.equal(okResult.wpPostId, 777);

  // 失敗した方はDBが変更されない(次回実行時に自動的に再試行対象になる)。
  const rec = seoDb.getWeeklyRecommendation(batchDate, branchesDb.getActiveBranch().id);
  const failedItem = rec.items.find((i) => i.taskId === 3);
  const okItem = rec.items.find((i) => i.taskId === 4);
  assert.equal(failedItem.wpPostId, null);
  assert.equal(failedItem.draftStatus, 'prompt_generated');
  assert.equal(okItem.wpPostId, 777);
  assert.equal(okItem.draftStatus, 'published_draft');

  // 1件でも未完了(失敗)なので、週次バンドル自体はarchivedへ遷移しないべき
  assert.equal(result.archived, false);
  assert.equal(rec.status, 'approved');
});

test('draftStatusがprompt_generated以外(blocked_*等)のTaskは投稿対象にならない', async () => {
  const batchDate = nextBatchDate();
  seedApprovedRecommendation(batchDate, [
    {
      taskId: 5,
      taskType: 'create_article',
      targetKeyword: 'まだブロックされているTask',
      draftStatus: 'blocked_page_plan_stale',
      draftPromptPath: null,
      wpPostId: null,
    },
  ]);

  const result = await resolvePublisher({ batchDate, save: true, wordpressImpl: fakeWordpress(), nowIso });
  assert.equal(result.results[0].outcome, 'draft_not_ready');
  assert.equal(result.archived, false);
});

test('improve_school_page等のTaskはこのCLIの対象外として扱われる(not_publishable_task_type)', async () => {
  const batchDate = nextBatchDate();
  seedApprovedRecommendation(batchDate, [
    {
      taskId: 6,
      taskType: 'improve_school_page',
      targetKeyword: '校舎ページ改善Task',
      draftStatus: 'blocked_page_plan_stale',
      draftPromptPath: null,
      wpPostId: null,
    },
  ]);

  const result = await resolvePublisher({ batchDate, save: true, wordpressImpl: fakeWordpress(), nowIso });
  assert.equal(result.results[0].outcome, 'not_publishable_task_type');
  // 対象Task(create_article)が1件も無いため、archived判定はfalseのまま
  assert.equal(result.archived, false);
});

test('result.jsonがまだ存在しない場合はawaiting_resultとして待機し、エラーにはならない', async () => {
  const batchDate = nextBatchDate();
  seedApprovedRecommendation(batchDate, [
    {
      taskId: 7,
      taskType: 'create_article',
      targetKeyword: 'まだLLM実行されていないTask',
      draftStatus: 'prompt_generated',
      draftPromptPath: path.join(TMP_DIR, `${batchDate}_task_7.prompt.json`),
      wpPostId: null,
    },
  ]);

  const result = await resolvePublisher({ batchDate, save: true, wordpressImpl: fakeWordpress(), nowIso });
  assert.equal(result.results[0].outcome, 'awaiting_result');
  assert.equal(result.archived, false);
});

test('can_generate=falseの場合はgeneration_blockedとして扱われ、投稿対象にならない', async () => {
  const batchDate = nextBatchDate();
  const resultPath = writeResultFile(`${batchDate}_task_8.result.json`, {
    can_generate: false,
    missing_context: ['ページ内容が未取得'],
    required_checks: [],
    warnings: [],
  });

  seedApprovedRecommendation(batchDate, [
    {
      taskId: 8,
      taskType: 'create_article',
      targetKeyword: '情報不足Task',
      draftStatus: 'prompt_generated',
      draftPromptPath: resultPath.replace(/\.result\.json$/, '.prompt.json'),
      wpPostId: null,
    },
  ]);

  const result = await resolvePublisher({ batchDate, save: true, wordpressImpl: fakeWordpress(), nowIso });
  assert.equal(result.results[0].outcome, 'generation_blocked');
  assert.deepEqual(result.results[0].missingContext, ['ページ内容が未取得']);
});

test('dry-run(save=false)ではresult.jsonが揃っていてもWordPressへ投稿されずDBも変化しない', async () => {
  const batchDate = nextBatchDate();
  const resultPath = writeResultFile(`${batchDate}_task_9.result.json`, {
    can_generate: true,
    title: 'dry-runで投稿されないはずの記事',
    body_html: '<p>本文です。</p>',
    meta_description: '概要です。',
    warnings: [],
  });

  seedApprovedRecommendation(batchDate, [
    {
      taskId: 9,
      taskType: 'create_article',
      targetKeyword: 'dry-runテスト',
      draftStatus: 'prompt_generated',
      draftPromptPath: resultPath.replace(/\.result\.json$/, '.prompt.json'),
      wpPostId: null,
    },
  ]);

  let createDraftPostCalls = 0;
  const wp = fakeWordpress({ createDraftPost: async () => { createDraftPostCalls += 1; return { wpPostId: 1 }; } });

  const result = await resolvePublisher({ batchDate, save: false, wordpressImpl: wp, nowIso });

  assert.equal(result.results[0].outcome, 'ready_to_publish');
  assert.equal(createDraftPostCalls, 0);
  const rec = seoDb.getWeeklyRecommendation(batchDate, branchesDb.getActiveBranch().id);
  assert.equal(rec.items[0].wpPostId, null);
  assert.equal(rec.status, 'approved');
});

test('publishOneItem: 単体でも直接呼び出せる(resolvePublisher経由に限定されない)', async () => {
  const item = {
    taskId: 999,
    taskType: 'create_article',
    draftStatus: 'prompt_generated',
    draftPromptPath: null,
    wpPostId: null,
  };
  const result = await publishOneItem(item, '2099-12-01', { seoDbImpl: seoDb, wordpressImpl: fakeWordpress(), nowIso, save: true });
  assert.equal(result.outcome, 'no_prompt_file');
});
