'use strict';

// Sprint 3.3: page_task_grouper.jsの単体テスト(DB非依存、純粋関数のみを対象)。
// LLM呼び出し・DB書き込みは一切発生しない(そもそもこのモジュールに依存が無い)。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  groupTasksByPage,
  applySupportingFactChecks,
  checkEligibility,
  selectPrimaryTask,
  classifyIntentPair,
  deriveIntentFamily,
} = require('../scripts/lib/seo/page_task_grouper');

function makeTask(overrides = {}) {
  return {
    taskId: 1,
    status: 'proposed',
    taskType: 'improve_school_page',
    targetUrl: 'https://an-english.com/school/obata/',
    targetPageType: 'school_page',
    targetPageId: 'obata',
    targetPageName: '小幡教室',
    targetKeyword: 'テストキーワード',
    opportunityScore: 50,
    sourceCandidateId: 1,
    gapType: 'untapped',
    dataConfidence: 50,
    searchIntent: 'general_service',
    templateType: 'area_juku',
    keywordComponents: { area: 'test', service: '塾' },
    gscImpressions: null,
    gscAvgPosition: null,
    ...overrides,
  };
}

// 実データ相当(Sprint 3.2 Phase A / Sprint 3.3設計調査で確認した9Task)のfixture。
// 期待結果(61がPrimary)をコードへハードコードせず、一般ルールの結果として検証する。
function obataFixture() {
  return [
    makeTask({
      taskId: 61, targetKeyword: '守山区 塾', opportunityScore: 74, gapType: 'weak', dataConfidence: 75,
      searchIntent: 'general_service', templateType: 'area_juku', keywordComponents: { area: '守山区', service: '塾' },
      gscImpressions: 398, gscAvgPosition: 8.35,
    }),
    makeTask({
      taskId: 62, targetKeyword: '小幡 塾', opportunityScore: 76, gapType: 'weak', dataConfidence: 75,
      searchIntent: 'general_service', templateType: 'area_juku', keywordComponents: { area: '小幡', service: '塾' },
      gscImpressions: 164, gscAvgPosition: 1.5,
    }),
    makeTask({
      taskId: 63, targetKeyword: '小幡 個別指導', opportunityScore: 74, gapType: 'untapped', dataConfidence: 44,
      searchIntent: 'general_service', templateType: 'area_teaching_style', keywordComponents: { area: '小幡', teaching_style: '個別指導' },
      gscImpressions: null, gscAvgPosition: null,
    }),
    makeTask({
      taskId: 64, targetKeyword: '守山区 個別指導', opportunityScore: 73, gapType: 'shared', dataConfidence: 63,
      searchIntent: 'general_service', templateType: 'area_teaching_style', keywordComponents: { area: '守山区', teaching_style: '個別指導' },
      gscImpressions: 1, gscAvgPosition: 10,
    }),
    makeTask({
      taskId: 65, targetKeyword: '瓢箪山 無料体験', opportunityScore: 74, gapType: 'untapped', dataConfidence: 18,
      searchIntent: 'trial_inquiry', templateType: 'area_muryou_taiken', keywordComponents: { area: '瓢箪山', exam: '無料体験' },
      gscImpressions: null, gscAvgPosition: null,
    }),
    makeTask({
      taskId: 66, targetKeyword: '瓢箪山 体験授業', opportunityScore: 74, gapType: 'untapped', dataConfidence: 18,
      searchIntent: 'trial_inquiry', templateType: 'area_muryou_taiken', keywordComponents: { area: '瓢箪山', exam: '体験授業' },
      gscImpressions: null, gscAvgPosition: null,
    }),
    makeTask({
      taskId: 67, targetKeyword: '瓢箪山 個別指導', opportunityScore: 66, gapType: 'untapped', dataConfidence: 44,
      searchIntent: 'general_service', templateType: 'area_teaching_style', keywordComponents: { area: '瓢箪山', teaching_style: '個別指導' },
      gscImpressions: null, gscAvgPosition: null,
    }),
    makeTask({
      taskId: 68, targetKeyword: '瓢箪山 塾', opportunityScore: 66, gapType: 'untapped', dataConfidence: 44,
      searchIntent: 'general_service', templateType: 'area_juku', keywordComponents: { area: '瓢箪山', service: '塾' },
      gscImpressions: null, gscAvgPosition: null,
    }),
    makeTask({
      taskId: 69, targetKeyword: '守山区 集団指導', opportunityScore: 63, gapType: 'untapped', dataConfidence: 28,
      searchIntent: 'general_service', templateType: 'area_teaching_style', keywordComponents: { area: '守山区', teaching_style: '集団指導' },
      gscImpressions: null, gscAvgPosition: null,
    }),
  ];
}

// --- グループ化 ---

test('グループ化: 同一target_page_type+target_page_idを同じGroupにする', () => {
  const tasks = [makeTask({ taskId: 1 }), makeTask({ taskId: 2 })];
  const { groups } = groupTasksByPage(tasks);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupKey, 'school_page:obata');
  assert.equal(groups[0].tasks.length, 2);
});

test('グループ化: target_urlが同じでもpage_idが違えば別Group', () => {
  const tasks = [
    makeTask({ taskId: 1, targetPageId: 'obata' }),
    makeTask({ taskId: 2, targetPageId: 'shin-moriyama', targetUrl: 'https://an-english.com/school/obata/' }),
  ];
  const { groups } = groupTasksByPage(tasks);
  assert.equal(groups.length, 2);
});

test('グループ化: target_url表記揺れに依存しない(group_keyはpage_type+page_idのみ)', () => {
  const tasks = [
    makeTask({ taskId: 1, targetUrl: 'https://an-english.com/school/obata/' }),
    makeTask({ taskId: 2, targetUrl: 'https://an-english.com/school/obata' }), // trailing slash無し
  ];
  const { groups } = groupTasksByPage(tasks);
  assert.equal(groups.length, 1); // page_idが同じなら同一グループ
  assert.equal(groups[0].targetUrl, null); // ただしtarget_url不一致はwarningで検出(勝手に統合しない)
  assert.ok(groups[0].warnings.some((w) => w.type === 'target_url_mismatch'));
});

test('グループ化: target_page_id=nullはungrouped', () => {
  const tasks = [makeTask({ taskId: 1, targetPageId: null })];
  const { groups, ungrouped } = groupTasksByPage(tasks);
  assert.equal(groups.length, 0);
  assert.equal(ungrouped.length, 1);
  assert.equal(ungrouped[0].reason, 'missing_target_page_id');
});

test('グループ化: target_url=nullはungrouped', () => {
  const tasks = [makeTask({ taskId: 1, targetUrl: null })];
  const { ungrouped } = groupTasksByPage(tasks);
  assert.equal(ungrouped[0].reason, 'missing_target_url');
});

test('グループ化: status!=proposedは対象外', () => {
  const tasks = [makeTask({ taskId: 1, status: 'rejected' })];
  const { ungrouped } = groupTasksByPage(tasks);
  assert.equal(ungrouped[0].reason, 'not_proposed');
});

test('グループ化: task_type!=improve_school_pageは対象外', () => {
  const tasks = [makeTask({ taskId: 1, taskType: 'create_article' })];
  const { ungrouped } = groupTasksByPage(tasks);
  assert.equal(ungrouped[0].reason, 'not_improve_school_page');
});

test('checkEligibility: 全条件を満たせばnull(対象)を返す', () => {
  assert.equal(checkEligibility(makeTask()), null);
});

// --- Primary選定 ---

test('Primary: general_serviceを優先する', () => {
  const tasks = [
    makeTask({ taskId: 1, searchIntent: 'trial_inquiry', dataConfidence: 90 }),
    makeTask({ taskId: 2, searchIntent: 'general_service', dataConfidence: 10 }),
  ];
  const warnings = [];
  const primary = selectPrimaryTask(tasks, warnings);
  assert.equal(primary.taskId, 2); // dataConfidenceは低いがgeneral_serviceが優先される
});

test('Primary: general_serviceが無ければ全Taskへフォールバックしwarningを出す', () => {
  const tasks = [makeTask({ taskId: 1, searchIntent: 'trial_inquiry', dataConfidence: 90 })];
  const warnings = [];
  const primary = selectPrimaryTask(tasks, warnings);
  assert.equal(primary.taskId, 1);
  assert.ok(warnings.some((w) => w.type === 'no_general_service_task'));
});

test('Primary: data_confidenceが高い方を優先する', () => {
  const tasks = [
    makeTask({ taskId: 1, dataConfidence: 30 }),
    makeTask({ taskId: 2, dataConfidence: 80 }),
  ];
  const primary = selectPrimaryTask(tasks, []);
  assert.equal(primary.taskId, 2);
});

test('Primary: data_confidence同点はgap_type優先度(weak > shared > missing > untapped > content_gap > strong)で決める', () => {
  const tasks = [
    makeTask({ taskId: 1, dataConfidence: 50, gapType: 'untapped' }),
    makeTask({ taskId: 2, dataConfidence: 50, gapType: 'weak' }),
  ];
  const primary = selectPrimaryTask(tasks, []);
  assert.equal(primary.taskId, 2);
});

test('Primary: data_confidence・GSC impressions・gap_typeが同点ならopportunity_score降順で決める', () => {
  const tasks = [
    makeTask({ taskId: 1, dataConfidence: 50, gapType: 'weak', gscImpressions: 10, opportunityScore: 60 }),
    makeTask({ taskId: 2, dataConfidence: 50, gapType: 'weak', gscImpressions: 10, opportunityScore: 90 }),
  ];
  const primary = selectPrimaryTask(tasks, []);
  assert.equal(primary.taskId, 2);
});

test('Primary: 全て同点ならtask_id昇順(最終tie-break)で決める', () => {
  const tasks = [
    makeTask({ taskId: 5, dataConfidence: 50, gapType: 'weak', gscImpressions: 10, opportunityScore: 60 }),
    makeTask({ taskId: 3, dataConfidence: 50, gapType: 'weak', gscImpressions: 10, opportunityScore: 60 }),
  ];
  const primary = selectPrimaryTask(tasks, []);
  assert.equal(primary.taskId, 3);
});

test('Primary: 小幡教室の実データ相当9Taskで、一般ルールの結果として61がPrimaryになる', () => {
  const { groups } = groupTasksByPage(obataFixture());
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primaryTask.taskId, 61);
  assert.equal(groups[0].primaryTask.targetKeyword, '守山区 塾');
});

test('Primary候補なし: グループ自体が空ならno_primary_candidate警告(防御的、通常は発生しない)', () => {
  // groupTasksByPageの内部でこのケースには到達しないが、selectPrimaryTask単体としての防御を確認
  const warnings = [];
  const primary = selectPrimaryTask([], warnings);
  assert.equal(primary, null);
});

// --- Supporting / Excluded分類 ---

test('search_intent分類: general_service+general_serviceはsame_section_intent(Supporting候補)', () => {
  assert.equal(classifyIntentPair('general_service', 'general_service').category, 'same_section_intent');
});

test('search_intent分類: general_service+trial_inquiryはseparate_section_intent', () => {
  assert.equal(classifyIntentPair('general_service', 'trial_inquiry').category, 'separate_section_intent');
});

test('search_intent分類: general_service+exam_prepはincompatible_intent', () => {
  assert.equal(classifyIntentPair('general_service', 'exam_prep').category, 'incompatible_intent');
});

test('search_intent分類: general_service+seasonal_courseはseparate_section_intent', () => {
  assert.equal(classifyIntentPair('general_service', 'seasonal_course').category, 'separate_section_intent');
});

test('search_intent分類: 未知の組み合わせはincompatible_intentへ安全側フォールバックしunknown=trueを返す', () => {
  const result = classifyIntentPair('general_service', 'totally_unknown_intent');
  assert.equal(result.category, 'incompatible_intent');
  assert.equal(result.unknown, true);
});

test('deriveIntentFamily: area_teaching_styleはteaching_style値ごとに別family(個別指導と集団指導は統合しない)', () => {
  const kobetsu = makeTask({ templateType: 'area_teaching_style', keywordComponents: { teaching_style: '個別指導' } });
  const shudan = makeTask({ templateType: 'area_teaching_style', keywordComponents: { teaching_style: '集団指導' } });
  assert.notEqual(deriveIntentFamily(kobetsu), deriveIntentFamily(shudan));
});

test('deriveIntentFamily: area_muryou_taikenは表記(無料体験/体験授業)によらず同一family', () => {
  const a = makeTask({ templateType: 'area_muryou_taiken', keywordComponents: { exam: '無料体験' } });
  const b = makeTask({ templateType: 'area_muryou_taiken', keywordComponents: { exam: '体験授業' } });
  assert.equal(deriveIntentFamily(a), deriveIntentFamily(b));
});

test('小幡教室9Task分類: trial_inquiry(65,66)はseparate_section_intentでExcluded', () => {
  const { groups } = groupTasksByPage(obataFixture());
  const excluded = groups[0].excludedTasks;
  const t65 = excluded.find((e) => e.taskId === 65);
  const t66 = excluded.find((e) => e.taskId === 66);
  assert.equal(t65.reason, 'separate_section_intent');
  assert.equal(t66.reason, 'separate_section_intent');
});

test('小幡教室9Task分類: Primaryのintent family(area_juku)に属する62/68はSupportingにならずduplicate_intentになる(Primaryが代表)', () => {
  const { groups } = groupTasksByPage(obataFixture());
  const supportingIds = groups[0].supportingTasks.map((t) => t.taskId);
  assert.ok(!supportingIds.includes(62));
  assert.ok(!supportingIds.includes(68));
  const excluded62 = groups[0].excludedTasks.find((e) => e.taskId === 62);
  const excluded68 = groups[0].excludedTasks.find((e) => e.taskId === 68);
  assert.equal(excluded62.reason, 'duplicate_intent');
  assert.equal(excluded62.duplicateOf, 61); // 61(Primary)がarea_jukuの代表
  assert.equal(excluded68.reason, 'duplicate_intent');
  assert.equal(excluded68.duplicateOf, 61);
});

test('小幡教室9Task分類: 近似intent family(teaching_style:個別指導: 63/64/67)は代表1件のみSupportingへ残る', () => {
  const { groups } = groupTasksByPage(obataFixture());
  const supportingIds = groups[0].supportingTasks.map((t) => t.taskId);
  // 64(data_confidence=63)が63/67(data_confidence=44)より優先されるべき
  assert.ok(supportingIds.includes(64));
  assert.ok(!supportingIds.includes(63));
  assert.ok(!supportingIds.includes(67));
  const excluded63 = groups[0].excludedTasks.find((e) => e.taskId === 63);
  const excluded67 = groups[0].excludedTasks.find((e) => e.taskId === 67);
  assert.equal(excluded63.reason, 'duplicate_intent');
  assert.equal(excluded63.duplicateOf, 64);
  assert.equal(excluded67.reason, 'duplicate_intent');
  assert.equal(excluded67.duplicateOf, 64);
});

test('小幡教室9Task分類: 単独family(teaching_style:集団指導: 69)はそのままSupportingへ残る', () => {
  const { groups } = groupTasksByPage(obataFixture());
  const supportingIds = groups[0].supportingTasks.map((t) => t.taskId);
  assert.ok(supportingIds.includes(69));
});

test('小幡教室9Task分類: Primary(61)自身はSupporting/Excludedのどちらにも含まれない', () => {
  const { groups } = groupTasksByPage(obataFixture());
  const supportingIds = groups[0].supportingTasks.map((t) => t.taskId);
  const excludedIds = groups[0].excludedTasks.map((e) => e.taskId);
  assert.ok(!supportingIds.includes(61));
  assert.ok(!excludedIds.includes(61));
});

// --- Primaryのintent family代表化(汎用フィクスチャ。task_idの特別扱いはしない) ---

test('Primaryはintent family代表として扱われる: 同じfamilyの他TaskはSupportingにならずduplicate_intentになる', () => {
  const tasks = [
    makeTask({ taskId: 901, targetKeyword: 'X塾', dataConfidence: 90, gapType: 'weak', templateType: 'area_juku' }),
    makeTask({ taskId: 902, targetKeyword: 'Y塾', dataConfidence: 30, gapType: 'weak', templateType: 'area_juku' }),
  ];
  const { groups } = groupTasksByPage(tasks);
  const group = groups[0];
  assert.equal(group.primaryTask.taskId, 901);
  const supportingIds = group.supportingTasks.map((t) => t.taskId);
  assert.ok(!supportingIds.includes(902)); // Primaryと同じfamilyはSupportingにならない
  const excluded902 = group.excludedTasks.find((e) => e.taskId === 902);
  assert.equal(excluded902.reason, 'duplicate_intent'); // duplicate_intentになる
  assert.equal(excluded902.duplicateOf, 901); // duplicateOfがPrimary Taskを指す
});

test('Primaryとは別familyの代表はSupportingになれる', () => {
  const tasks = [
    makeTask({ taskId: 901, targetKeyword: 'X塾', dataConfidence: 90, gapType: 'weak', templateType: 'area_juku' }),
    makeTask({
      taskId: 903, targetKeyword: 'X個別指導', dataConfidence: 60, gapType: 'untapped',
      templateType: 'area_teaching_style', keywordComponents: { teaching_style: '個別指導' },
    }),
  ];
  const { groups } = groupTasksByPage(tasks);
  const supportingIds = groups[0].supportingTasks.map((t) => t.taskId);
  assert.ok(supportingIds.includes(903));
});

test('Supportingは1familyにつき最大1件: 別family内で複数Taskがあっても代表1件だけがSupportingになる', () => {
  const tasks = [
    makeTask({ taskId: 901, targetKeyword: 'X塾', dataConfidence: 90, gapType: 'weak', templateType: 'area_juku' }),
    makeTask({
      taskId: 904, targetKeyword: 'X個別指導A', dataConfidence: 60, opportunityScore: 50,
      templateType: 'area_teaching_style', keywordComponents: { teaching_style: '個別指導' },
    }),
    makeTask({
      taskId: 905, targetKeyword: 'X個別指導B', dataConfidence: 40, opportunityScore: 80,
      templateType: 'area_teaching_style', keywordComponents: { teaching_style: '個別指導' },
    }),
  ];
  const { groups } = groupTasksByPage(tasks);
  const supportingIds = groups[0].supportingTasks.map((t) => t.taskId);
  // 同一family(teaching_style:個別指導)内では904(data_confidence=60)が代表になる
  assert.equal(supportingIds.filter((id) => id === 904 || id === 905).length, 1);
  assert.ok(supportingIds.includes(904));
  // 同一familyの非代表(905)は代表(904)をduplicateOfとして指す
  const excluded905 = groups[0].excludedTasks.find((e) => e.taskId === 905);
  assert.equal(excluded905.reason, 'duplicate_intent');
  assert.equal(excluded905.duplicateOf, 904);
});

test('Taskを削除・更新しない: groupTasksByPageは入力配列・要素を変更しない', () => {
  const tasks = obataFixture();
  const snapshot = JSON.parse(JSON.stringify(tasks));
  groupTasksByPage(tasks);
  assert.deepEqual(tasks, snapshot);
});

// --- Warning ---

test('Warning: 同groupKeyでtarget_url不一致を検出する', () => {
  const tasks = [
    makeTask({ taskId: 1, targetUrl: 'https://an-english.com/school/obata/' }),
    makeTask({ taskId: 2, targetUrl: 'https://an-english.com/school/obata/?utm=x' }),
  ];
  const { warnings, groups } = groupTasksByPage(tasks);
  assert.ok(warnings.some((w) => w.type === 'target_url_mismatch'));
  assert.equal(groups[0].targetUrl, null);
});

test('Warning: data_confidence nullを検出する', () => {
  const tasks = [makeTask({ taskId: 1, dataConfidence: null })];
  const { warnings } = groupTasksByPage(tasks);
  assert.ok(warnings.some((w) => w.type === 'data_confidence_null' && w.taskIds.includes(1)));
});

test('Warning: 未知search_intentを検出する', () => {
  const tasks = [
    makeTask({ taskId: 1, searchIntent: 'general_service' }),
    makeTask({ taskId: 2, searchIntent: 'unknown_intent_xyz' }),
  ];
  const { warnings } = groupTasksByPage(tasks);
  assert.ok(warnings.some((w) => w.type === 'unknown_search_intent' && w.taskId === 2));
});

test('Warning: supportingが0件を検出する(全Taskがtrial_inquiry等でExcludedの場合)', () => {
  const tasks = [
    makeTask({ taskId: 1, searchIntent: 'general_service' }),
    makeTask({ taskId: 2, searchIntent: 'trial_inquiry' }),
  ];
  const { warnings } = groupTasksByPage(tasks);
  assert.ok(warnings.some((w) => w.type === 'no_supporting_tasks'));
});

test('Warning: general_serviceが1件のみ(Primaryのみ)の場合もsupportingが0件警告が出る', () => {
  const tasks = [makeTask({ taskId: 1, searchIntent: 'general_service' })];
  const { warnings } = groupTasksByPage(tasks);
  assert.ok(warnings.some((w) => w.type === 'no_supporting_tasks'));
});

// --- applySupportingFactChecks(Sprint 3.3.1: Grouper連携)。fakeのfactCheckerを注入し、
// 実際のページ本文照合ロジック(supporting_task_fact_checker.js)自体は
// test/seo_supporting_task_fact_checker.test.jsで別途検証する。 ---

function twoSupportingGroup() {
  const tasks = [
    makeTask({ taskId: 801, targetKeyword: 'X塾', dataConfidence: 90, gapType: 'weak', templateType: 'area_juku' }),
    makeTask({
      taskId: 802, targetKeyword: 'X個別指導', dataConfidence: 60,
      templateType: 'area_teaching_style', keywordComponents: { teaching_style: '個別指導' },
    }),
    makeTask({
      taskId: 803, targetKeyword: 'X集団指導', dataConfidence: 50,
      templateType: 'area_teaching_style', keywordComponents: { teaching_style: '集団指導' },
    }),
  ];
  return groupTasksByPage(tasks).groups[0];
}

test('applySupportingFactChecks: verifiedのSupportingは残る', () => {
  const group = twoSupportingGroup();
  const fakeChecker = (task) => ({ status: 'verified', serviceTerm: task.targetKeyword, matchedTerms: ['x'], evidenceSources: ['title'], reason: 'ok', warnings: [] });
  const result = applySupportingFactChecks(group, { status: 'fetched' }, { factChecker: fakeChecker });
  const supportingIds = result.supportingTasks.map((t) => t.taskId);
  assert.ok(supportingIds.includes(802));
  assert.ok(supportingIds.includes(803));
  assert.equal(result.supportingTasks.find((t) => t.taskId === 802).factStatus, 'verified');
});

test('applySupportingFactChecks: unverifiedのSupportingはExcludedへ移動しreasonはsupporting_fact_unverified', () => {
  const group = twoSupportingGroup();
  const fakeChecker = (task) =>
    task.taskId === 803
      ? { status: 'unverified', serviceTerm: '集団指導', matchedTerms: [], evidenceSources: [], reason: 'no_matching_term_in_page_content', warnings: [] }
      : { status: 'verified', serviceTerm: task.targetKeyword, matchedTerms: ['x'], evidenceSources: ['title'], reason: 'ok', warnings: [] };
  const result = applySupportingFactChecks(group, { status: 'fetched' }, { factChecker: fakeChecker });
  const supportingIds = result.supportingTasks.map((t) => t.taskId);
  assert.ok(!supportingIds.includes(803));
  const excluded803 = result.excludedTasks.find((e) => e.taskId === 803);
  assert.equal(excluded803.reason, 'supporting_fact_unverified');
  assert.equal(excluded803.factStatus, 'unverified');
});

test('applySupportingFactChecks: conflictingのSupportingはExcludedへ移動しreasonはsupporting_fact_conflicting', () => {
  const group = twoSupportingGroup();
  const fakeChecker = (task) =>
    task.taskId === 803
      ? { status: 'conflicting', serviceTerm: '集団指導', matchedTerms: ['個別指導'], evidenceSources: ['body'], reason: 'negation_or_exclusivity_pattern_nearby', warnings: [] }
      : { status: 'verified', serviceTerm: task.targetKeyword, matchedTerms: ['x'], evidenceSources: ['title'], reason: 'ok', warnings: [] };
  const result = applySupportingFactChecks(group, { status: 'fetched' }, { factChecker: fakeChecker });
  const supportingIds = result.supportingTasks.map((t) => t.taskId);
  assert.ok(!supportingIds.includes(803));
  const excluded803 = result.excludedTasks.find((e) => e.taskId === 803);
  assert.equal(excluded803.reason, 'supporting_fact_conflicting');
  assert.equal(excluded803.factStatus, 'conflicting');
  assert.deepEqual(excluded803.factEvidence.matchedTerms, ['個別指導']);
});

test('applySupportingFactChecks: Primaryは変わらない', () => {
  const group = twoSupportingGroup();
  const fakeChecker = () => ({ status: 'unverified', serviceTerm: null, matchedTerms: [], evidenceSources: [], reason: 'x', warnings: [] });
  const result = applySupportingFactChecks(group, { status: 'fetched' }, { factChecker: fakeChecker });
  assert.equal(result.primaryTask.taskId, group.primaryTask.taskId);
});

test('applySupportingFactChecks: duplicate_intent/separate_section_intentで既にExcludedのTaskはfact checkの対象にならない(重複実行しない)', () => {
  const group = twoSupportingGroup();
  const checkedTaskIds = [];
  const fakeChecker = (task) => {
    checkedTaskIds.push(task.taskId);
    return { status: 'verified', serviceTerm: task.targetKeyword, matchedTerms: ['x'], evidenceSources: ['title'], reason: 'ok', warnings: [] };
  };
  applySupportingFactChecks(group, { status: 'fetched' }, { factChecker: fakeChecker });
  // group.supportingTasksは既にPrimary重複整理・意図分類後の代表のみ(802,803)なので、
  // fact checkが呼ばれるのもこの2件だけ(Primary=801は対象外)。
  assert.deepEqual(checkedTaskIds.sort(), [802, 803]);
});

test('applySupportingFactChecks: Task自体(元オブジェクト)を変更しない', () => {
  const group = twoSupportingGroup();
  const snapshot = JSON.parse(JSON.stringify(group.supportingTasks));
  const fakeChecker = () => ({ status: 'verified', serviceTerm: 'x', matchedTerms: [], evidenceSources: [], reason: 'ok', warnings: [] });
  applySupportingFactChecks(group, { status: 'fetched' }, { factChecker: fakeChecker });
  assert.deepEqual(group.supportingTasks, snapshot);
});
