'use strict';

// Sprint 3.3.1: supporting_task_fact_checker.jsの単体テスト(DB非依存、純粋関数のみを対象)。
// LLM呼び出し・DB書き込み・外部通信は一切発生しない(そもそもこのモジュールに依存が無い)。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateSupportingTaskFact,
  evaluateSupportingTasks,
  extractServiceTerm,
} = require('../scripts/lib/seo/supporting_task_fact_checker');

function makeTask(overrides = {}) {
  return {
    taskId: 1,
    targetKeyword: 'テスト 個別指導',
    templateType: 'area_teaching_style',
    keywordComponents: { area: 'テスト', teaching_style: '個別指導' },
    ...overrides,
  };
}

function fetchedContext({ title = '', headings = [], bodyExcerpt = '' } = {}) {
  return { status: 'fetched', title, headings, bodyExcerpt };
}

// --- serviceTerm抽出 ---

test('extractServiceTerm: keyword_componentsのteaching_style/service/exam優先順で抽出する', () => {
  assert.equal(extractServiceTerm(makeTask({ keywordComponents: { teaching_style: '集団指導' } })), '集団指導');
  assert.equal(extractServiceTerm(makeTask({ keywordComponents: { service: '塾' } })), '塾');
  assert.equal(extractServiceTerm(makeTask({ keywordComponents: { exam: '無料体験' } })), '無料体験');
});

test('extractServiceTerm: keyword_componentsが無い/該当フィールドが無い場合はnull', () => {
  assert.equal(extractServiceTerm(makeTask({ keywordComponents: null })), null);
  assert.equal(extractServiceTerm(makeTask({ keywordComponents: {} })), null);
});

// --- 正常系: verified ---

test('verified: titleに中心語(の同義語含む)があれば確認できる', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '個別指導' } });
  const pageContext = fetchedContext({ title: '小幡教室 - 個別指導塾 英会話 そろばん' });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'verified');
  assert.equal(result.serviceTerm, '個別指導');
  assert.ok(result.evidenceSources.includes('title'));
});

test('verified: headingに中心語があれば確認できる', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '個別指導' } });
  const pageContext = fetchedContext({ headings: ['アンイングリッシュGROUP', '個別指導コース一覧'] });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'verified');
  assert.ok(result.evidenceSources.includes('heading'));
});

test('verified: bodyExcerptに中心語があれば確認できる', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '個別指導' } });
  const pageContext = fetchedContext({ bodyExcerpt: '当教室では個別指導を行っています。' });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'verified');
  assert.ok(result.evidenceSources.includes('body'));
});

test('verified: 同義語(集団授業/一斉指導/個別授業等)でも確認できる', () => {
  const kobetsu = evaluateSupportingTaskFact(
    makeTask({ keywordComponents: { teaching_style: '個別指導' } }),
    fetchedContext({ bodyExcerpt: '個別授業を中心に指導しています' })
  );
  assert.equal(kobetsu.status, 'verified');

  const shudan = evaluateSupportingTaskFact(
    makeTask({ keywordComponents: { teaching_style: '集団指導' } }),
    fetchedContext({ bodyExcerpt: '集団授業も開講しています' })
  );
  assert.equal(shudan.status, 'verified');

  const taiken = evaluateSupportingTaskFact(
    makeTask({ templateType: 'area_muryou_taiken', keywordComponents: { exam: '無料体験' } }),
    fetchedContext({ bodyExcerpt: '体験レッスンを実施中です' })
  );
  assert.equal(taiken.status, 'verified');
});

test('verified: matchedTermsとevidenceSourcesを返す', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '個別指導' } });
  const pageContext = fetchedContext({ title: '個別指導塾', bodyExcerpt: '個別指導のご案内' });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.ok(result.matchedTerms.length > 0);
  assert.ok(result.evidenceSources.includes('title'));
  assert.ok(result.evidenceSources.includes('body'));
});

// --- 異常・安全系: unverified ---

test('unverified: ページ本文に該当語句が無い', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '集団指導' } });
  const pageContext = fetchedContext({ title: '個別指導塾', bodyExcerpt: '英会話・そろばん・プログラミング' });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'no_matching_term_in_page_content');
});

test('unverified: pageContext.status!=fetchedの場合は全てunverified', () => {
  const task = makeTask();
  ['not_fetched', 'blocked', 'fetch_failed', 'empty'].forEach((status) => {
    const result = evaluateSupportingTaskFact(task, { status });
    assert.equal(result.status, 'unverified');
    assert.equal(result.reason, 'page_context_not_available');
  });
});

test('unverified: pageContext自体がnull/undefinedでも安全にunverifiedを返す', () => {
  const result = evaluateSupportingTaskFact(makeTask(), null);
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'page_context_not_available');
});

test('unverified: Task中心語抽出不可の場合', () => {
  const task = makeTask({ keywordComponents: null });
  const result = evaluateSupportingTaskFact(task, fetchedContext({ bodyExcerpt: '個別指導' }));
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'service_term_extraction_failed');
});

test('unverified: 未知template_typeでもkeyword_componentsが無ければ中心語抽出不可でunverified', () => {
  const task = makeTask({ templateType: 'area_unknown_future_template', keywordComponents: null });
  const result = evaluateSupportingTaskFact(task, fetchedContext({ bodyExcerpt: '何かの内容' }));
  assert.equal(result.status, 'unverified');
});

test('unverified: 無料体験Taskで「お問い合わせください」「体験についてご相談ください」だけではverifiedにしない', () => {
  const task = makeTask({ templateType: 'area_muryou_taiken', keywordComponents: { exam: '無料体験' } });
  const pageContext = fetchedContext({ bodyExcerpt: 'ご質問はお問い合わせください。体験についてご相談ください。' });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'unverified');
});

test('GSC実績の有無はfact checkの判定に一切影響しない(引数として受け取らない)', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '個別指導' }, gscImpressions: 999 });
  const noEvidence = evaluateSupportingTaskFact(task, fetchedContext({ bodyExcerpt: '英会話のみ' }));
  assert.equal(noEvidence.status, 'unverified'); // GSC impressionsが多くても本文根拠が無ければunverified

  const taskNoGsc = makeTask({ keywordComponents: { teaching_style: '個別指導' }, gscImpressions: null });
  const withEvidence = evaluateSupportingTaskFact(taskNoGsc, fetchedContext({ bodyExcerpt: '個別指導を実施' }));
  assert.equal(withEvidence.status, 'verified'); // GSC実績が無くても本文根拠があればverified
});

test('個別指導と集団指導を混同しない', () => {
  const kobetsuTask = makeTask({ keywordComponents: { teaching_style: '個別指導' } });
  const result = evaluateSupportingTaskFact(kobetsuTask, fetchedContext({ bodyExcerpt: '集団指導のクラスがあります' }));
  assert.equal(result.status, 'unverified'); // 集団指導の記載だけでは個別指導のverifiedにならない
});

test('体験相談と無料体験を混同しない', () => {
  const taikenTask = makeTask({ templateType: 'area_muryou_taiken', keywordComponents: { exam: '無料体験' } });
  const result = evaluateSupportingTaskFact(taikenTask, fetchedContext({ bodyExcerpt: '体験相談は随時受け付けています' }));
  assert.equal(result.status, 'unverified');
});

// --- conflicting ---

test('conflicting: 「集団指導は実施していません」→集団指導Taskでconflicting', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '集団指導' } });
  const pageContext = fetchedContext({ bodyExcerpt: '集団指導は実施していません。個別指導のみを行っています。' });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'conflicting');
});

test('conflicting: 「個別指導のみ」→集団指導Taskでconflicting', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '集団指導' } });
  const pageContext = fetchedContext({ bodyExcerpt: '当教室は個別指導のみで運営しています。' });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'conflicting');
});

test('「個別指導のみ」→個別指導Taskではverified(排他表現は対象語自身には効かない)', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '個別指導' } });
  const pageContext = fetchedContext({ bodyExcerpt: '当教室は個別指導のみで運営しています。' });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'verified');
});

test('否定語が遠い場合は誤ってconflictingにしない', () => {
  const task = makeTask({ keywordComponents: { teaching_style: '集団指導' } });
  // 「集団指導」の記載と「実施していません」の間が30文字を大きく超える
  const farText = `集団指導のクラスもございます。${'　'.repeat(5)}英会話・そろばん・プログラミング・将棋・美文字など幅広いコースを開講しております教室です。他塾では対応していません`;
  const result = evaluateSupportingTaskFact(task, fetchedContext({ bodyExcerpt: farText }));
  assert.equal(result.status, 'verified');
});

test('実データ相当: 小幡教室ページ(集団指導の記載なし)で69(集団指導)はunverifiedになる', () => {
  const task = makeTask({ targetKeyword: '守山区 集団指導', keywordComponents: { teaching_style: '集団指導' } });
  const pageContext = fetchedContext({
    title: '小幡教室 - 個別指導塾 英会話 そろばん 習字 プログラミング 将棋',
    headings: ['アンイングリッシュGROUP -教室案内-', '小幡教室', '小幡教室 開講コース一覧'],
    bodyExcerpt: 'アンイングリッシュクラブ アンそろばんクラブ アン美文字クラブ アンプログラミングクラブ アン将棋クラブ アンさんこくキッズ アン進学ジム(個別指導) アンまなびワールド',
  });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'unverified'); // 集団指導・集団授業・一斉指導の記載が無い
});

test('実データ相当: 小幡教室ページ(個別指導塾の記載あり)で64(個別指導)はverifiedになる', () => {
  const task = makeTask({ targetKeyword: '守山区 個別指導', keywordComponents: { teaching_style: '個別指導' } });
  const pageContext = fetchedContext({
    title: '小幡教室 - 個別指導塾 英会話 そろばん 習字 プログラミング 将棋',
    headings: ['アンイングリッシュGROUP -教室案内-', '小幡教室'],
    bodyExcerpt: 'アン進学ジム(個別指導)など幅広いコースを開講しています。',
  });
  const result = evaluateSupportingTaskFact(task, pageContext);
  assert.equal(result.status, 'verified');
  assert.ok(result.evidenceSources.includes('title'));
});

// --- 複数Task一括評価 ---

test('evaluateSupportingTasks: 複数Taskを一括評価できる', () => {
  const tasks = [
    makeTask({ taskId: 1, keywordComponents: { teaching_style: '個別指導' } }),
    makeTask({ taskId: 2, keywordComponents: { teaching_style: '集団指導' } }),
  ];
  const pageContext = fetchedContext({ bodyExcerpt: '個別指導を実施しています' });
  const results = evaluateSupportingTasks(tasks, pageContext);
  assert.equal(results.length, 2);
  assert.equal(results[0].status, 'verified');
  assert.equal(results[1].status, 'unverified');
});
