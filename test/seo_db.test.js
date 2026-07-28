'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_db_test_${process.pid}.sqlite`);
process.env.JUKU_BLOG_DB_PATH = TMP_DB;

const seoDb = require('../scripts/lib/seo_db');
const { closeDb, insertPost, setScheduled } = require('../scripts/lib/db');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
});

test('upsertCompetitor: 新規登録と更新の両方でidが変わらない', () => {
  const now = '2026-07-13T00:00:00.000Z';
  seoDb.upsertCompetitor({ id: 'c1', name: '競合A', domain: 'a.example.com', crawl_enabled: true }, now);
  seoDb.upsertCompetitor({ id: 'c1', name: '競合A(改称)', domain: 'a.example.com', crawl_enabled: false }, now);
  const c = seoDb.getCompetitor('c1');
  assert.equal(c.name, '競合A(改称)');
  assert.equal(c.crawl_enabled, 0);
});

test('listCompetitors: crawlEnabledOnlyで絞り込める', () => {
  const now = '2026-07-13T00:00:00.000Z';
  seoDb.upsertCompetitor({ id: 'c2', name: '競合B', domain: 'b.example.com', crawl_enabled: true }, now);
  const enabledOnly = seoDb.listCompetitors({ crawlEnabledOnly: true });
  assert.ok(enabledOnly.some((c) => c.id === 'c2'));
  assert.ok(!enabledOnly.some((c) => c.id === 'c1'));
});

test('upsertCompetitorPage: 同一URLはcontent_hash一致ならwasUnchanged=true', () => {
  const now = '2026-07-13T00:00:00.000Z';
  seoDb.upsertCompetitor({ id: 'c3', name: '競合C', domain: 'c.example.com' }, now);
  const first = seoDb.upsertCompetitorPage(
    { competitor_id: 'c3', url: 'https://c.example.com/a', canonical_url: 'https://c.example.com/a', content_hash: 'hash1', fetched_at: now },
    now
  );
  assert.equal(first.isNew, true);
  const second = seoDb.upsertCompetitorPage(
    { competitor_id: 'c3', url: 'https://c.example.com/a', canonical_url: 'https://c.example.com/a', content_hash: 'hash1', fetched_at: now },
    now
  );
  assert.equal(second.isNew, false);
  assert.equal(second.wasUnchanged, true);
  assert.equal(second.id, first.id);

  const third = seoDb.upsertCompetitorPage(
    { competitor_id: 'c3', url: 'https://c.example.com/a', canonical_url: 'https://c.example.com/a', content_hash: 'hash2', fetched_at: now },
    now
  );
  assert.equal(third.wasUnchanged, false);
});

test('replacePageHeadings/listPageHeadings: 再解析時に見出しを入れ替える', () => {
  const now = '2026-07-13T00:00:00.000Z';
  seoDb.upsertCompetitor({ id: 'c4', name: '競合D', domain: 'd.example.com' }, now);
  const page = seoDb.upsertCompetitorPage(
    { competitor_id: 'c4', url: 'https://d.example.com/a', canonical_url: 'https://d.example.com/a', fetched_at: now },
    now
  );
  seoDb.replacePageHeadings(page.id, [{ level: 'h1', text: '見出し1' }, { level: 'h2', text: '見出し2' }], now);
  assert.equal(seoDb.listPageHeadings(page.id).length, 2);
  seoDb.replacePageHeadings(page.id, [{ level: 'h1', text: '新見出し' }], now);
  const headings = seoDb.listPageHeadings(page.id);
  assert.equal(headings.length, 1);
  assert.equal(headings[0].text, '新見出し');
});

test('upsertTopic: 同一の正規化キーワード+対象軸は重複作成しない', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const id1 = seoDb.upsertTopic({ raw_keyword: '塾', normalized_keyword: '塾', target_area: '守山区' }, now);
  const id2 = seoDb.upsertTopic({ raw_keyword: '学習塾', normalized_keyword: '塾', target_area: '守山区' }, now);
  assert.equal(id1, id2);
  const id3 = seoDb.upsertTopic({ raw_keyword: '塾', normalized_keyword: '塾', target_area: '千種区' }, now);
  assert.notEqual(id1, id3);
});

test('upsertKeywordCandidate: 一意キーで重複作成せず更新する', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const first = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '守山区 塾', gap_type: 'missing', priority_score: 80, status: 'discovered' },
    now
  );
  assert.equal(first.isNew, true);
  const second = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '守山区 塾', gap_type: 'missing', priority_score: 90, status: 'discovered' },
    now
  );
  assert.equal(second.isNew, false);
  assert.equal(second.id, first.id);
  const candidate = seoDb.getKeywordCandidateById(first.id);
  assert.equal(candidate.priority_score, 90);
});

test('updateCandidateStatus: queuedにはapproved以外から遷移できない', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const created = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '瓢箪山 塾', gap_type: 'weak', priority_score: 50, status: 'discovered' },
    now
  );
  assert.throws(() => seoDb.updateCandidateStatus(created.id, { toStatus: 'queued', actor: 'dashboard' }, now));

  seoDb.updateCandidateStatus(created.id, { toStatus: 'approved', reason: '地域関連性が高い', actor: 'dashboard' }, now);
  seoDb.updateCandidateStatus(created.id, { toStatus: 'queued', actor: 'dashboard' }, now);
  const candidate = seoDb.getKeywordCandidateById(created.id);
  assert.equal(candidate.status, 'queued');

  const history = seoDb.listCandidateStatusHistory(created.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].to_status, 'approved');
  assert.equal(history[1].to_status, 'queued');
});

test('insertCandidateEvidence/listCandidateEvidence: 根拠を保存・取得できる', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const created = seoDb.upsertKeywordCandidate(
    { normalized_keyword: '中新 個別指導', gap_type: 'untapped', priority_score: 60 },
    now
  );
  seoDb.insertCandidateEvidence(
    { candidate_id: created.id, evidence_type: 'title', detail: { url: 'https://x.example.com', title: 'サンプル' }, confidence: 0.9 },
    now
  );
  const evidence = seoDb.listCandidateEvidence(created.id);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].detail.title, 'サンプル');
});

test('upsertCandidateExistingArticle/listCandidateExistingArticles: postsとJOINして取得できる', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const postId = insertPost({
    created_at: now,
    title: '守山区の塾選びガイド',
    slug: 'moriyama-juku-guide',
    category: '地域情報',
    body_md: '本文',
    body_html: '<p>本文</p>',
  });
  const created = seoDb.upsertKeywordCandidate({ normalized_keyword: '守山区 塾選び', gap_type: 'weak', priority_score: 55 }, now);
  seoDb.upsertCandidateExistingArticle({ candidate_id: created.id, post_id: postId, similarity_score: 0.82, match_reason: 'title_similarity' }, now);
  const links = seoDb.listCandidateExistingArticles(created.id);
  assert.equal(links.length, 1);
  assert.equal(links[0].post_title, '守山区の塾選びガイド');
});

test('getRunningAnalysisRun/createAnalysisRun/finishAnalysisRun: 二重起動防止に使える', () => {
  const now = '2026-07-13T05:00:00.000Z';
  assert.equal(seoDb.getRunningAnalysisRun(), null);
  seoDb.createAnalysisRun('run-1', now);
  assert.ok(seoDb.getRunningAnalysisRun());
  seoDb.finishAnalysisRun('run-1', { status: 'completed', finishedAtIso: now, pages_fetched: 3 });
  assert.equal(seoDb.getRunningAnalysisRun(), null);
});

test('upsertGscQueryRow: 同一キーの再取得は重複行を作らずupsertする', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const row = { site_property: 'https://an-english.com/', date: '2026-07-01', query: '守山区 塾', page: '/school/obata/', clicks: 1, impressions: 10 };
  seoDb.upsertGscQueryRow(row, now);
  seoDb.upsertGscQueryRow({ ...row, clicks: 5, impressions: 40 }, now);
  const rows = seoDb.listGscQueriesForKeyword('守山区 塾');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clicks, 5);
});

test('upsertGscQueryRows: 複数行を1トランザクションで一括upsertできる(2026-07-28: GSCバックフィル高速化のため追加)', () => {
  const now = '2026-07-28T00:00:00.000Z';
  const rows = [
    { site_property: 'sc-domain:an-english.com', date: '2026-07-01', query: 'bulk テスト A', page: '/a', clicks: 1, impressions: 10 },
    { site_property: 'sc-domain:an-english.com', date: '2026-07-01', query: 'bulk テスト B', page: '/b', clicks: 2, impressions: 20 },
    { site_property: 'sc-domain:an-english.com', date: '2026-07-02', query: 'bulk テスト A', page: '/a', clicks: 3, impressions: 30 },
  ];
  seoDb.upsertGscQueryRows(rows, now);

  const a = seoDb.listGscQueriesForKeyword('bulk テスト A');
  const b = seoDb.listGscQueriesForKeyword('bulk テスト B');
  assert.equal(a.length, 2);
  assert.equal(b.length, 1);
  assert.equal(b[0].clicks, 2);
});

test('upsertGscQueryRows: 同一キーの再取得はupsertGscQueryRow単体と同じく重複行を作らない', () => {
  const now = '2026-07-28T00:00:00.000Z';
  const row = { site_property: 'sc-domain:an-english.com', date: '2026-07-03', query: 'bulk テスト upsert', page: '/c', clicks: 1, impressions: 10 };
  seoDb.upsertGscQueryRows([row], now);
  seoDb.upsertGscQueryRows([{ ...row, clicks: 9, impressions: 90 }], now);

  const rows = seoDb.listGscQueriesForKeyword('bulk テスト upsert');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clicks, 9);
});

test('getPostWpIdsForBranch: branch_idごとのwp_post_id一覧を返す(nullは除外)', () => {
  const now = '2026-07-29T00:00:00.000Z';
  const id1 = insertPost({ created_at: now, slug: 'gsc-attr-b1-p1', branch_id: 901, title: 't1', category: 'c', body_md: 'x', body_html: 'x' });
  const id2 = insertPost({ created_at: now, slug: 'gsc-attr-b1-p2', branch_id: 901, title: 't2', category: 'c', body_md: 'x', body_html: 'x' });
  insertPost({ created_at: now, slug: 'gsc-attr-b1-p3-nowp', branch_id: 901, title: 't3', category: 'c', body_md: 'x', body_html: 'x' }); // wp_post_id無し
  setScheduled(id1, { wpPostId: 20001, wpLink: 'https://an-english.com/?p=20001', scheduledAt: now });
  setScheduled(id2, { wpPostId: 20002, wpLink: 'https://an-english.com/?p=20002', scheduledAt: now });

  const ids = seoDb.getPostWpIdsForBranch(901);
  assert.deepEqual([...ids].sort((a, b) => a - b), [20001, 20002]);
});

test('getGscAttributionInRange: 2026-07-29追加。校舎別ブログ/校舎ページ/その他の4区分に正しく分解する(残差をどちらの校舎にも割り当てない)', () => {
  const now = '2026-07-29T00:00:00.000Z';
  // 校舎A(id=911)のブログ記事(wp_post_id=30001)
  const postA = insertPost({ created_at: now, slug: 'gsc-attr-a-blog', branch_id: 911, title: 'A blog', category: 'c', body_md: 'x', body_html: 'x' });
  setScheduled(postA, { wpPostId: 30001, wpLink: 'https://an-english.com/?p=30001', scheduledAt: now });
  // 校舎B(id=912)のブログ記事(wp_post_id=30002)
  const postB = insertPost({ created_at: now, slug: 'gsc-attr-b-blog', branch_id: 912, title: 'B blog', category: 'c', body_md: 'x', body_html: 'x' });
  setScheduled(postB, { wpPostId: 30002, wpLink: 'https://an-english.com/?p=30002', scheduledAt: now });

  seoDb.upsertGscQueryRows(
    [
      // 校舎Aのブログ記事(日付ベースパーマリンク。末尾がwp_post_idと一致)
      { site_property: 'sc-domain:an-english.com', date: '2026-07-13', query: 'q-a-blog', page: 'https://an-english.com/2026/07/30001/', clicks: 5, impressions: 100 },
      // 校舎Bのブログ記事
      { site_property: 'sc-domain:an-english.com', date: '2026-07-13', query: 'q-b-blog', page: 'https://an-english.com/2026/07/30002/', clicks: 3, impressions: 60 },
      // 校舎Aの校舎ページ(www/末尾スラッシュ無しの表記揺れ込み)
      { site_property: 'sc-domain:an-english.com', date: '2026-07-13', query: 'q-a-school', page: 'https://www.an-english.com/school/attr-a', clicks: 2, impressions: 40 },
      // どちらの校舎にも属さない(トップページ)
      { site_property: 'sc-domain:an-english.com', date: '2026-07-13', query: 'q-other', page: 'https://an-english.com/', clicks: 1, impressions: 20 },
    ],
    now
  );

  const result = seoDb.getGscAttributionInRange({
    startDate: '2026-07-13',
    endDate: '2026-07-19',
    branches: [
      { branchId: 911, postIds: seoDb.getPostWpIdsForBranch(911), schoolPageUrls: ['https://an-english.com/school/attr-a/'] },
      { branchId: 912, postIds: seoDb.getPostWpIdsForBranch(912), schoolPageUrls: [] },
    ],
  });

  assert.equal(result.perBranch[911].impressionsBlog, 100);
  assert.equal(result.perBranch[911].clicksBlog, 5);
  assert.equal(result.perBranch[911].impressionsSchoolPage, 40);
  assert.equal(result.perBranch[911].clicksSchoolPage, 2);

  assert.equal(result.perBranch[912].impressionsBlog, 60);
  assert.equal(result.perBranch[912].clicksBlog, 3);
  assert.equal(result.perBranch[912].impressionsSchoolPage, 0);

  // 校舎Aのブログにも校舎Bのブログにも吸収されず、独立した値として残る
  assert.equal(result.impressionsOther, 20);
  assert.equal(result.clicksOther, 1);

  // サイト全体の合計(4区分の合計と一致する)
  assert.equal(result.impressionsTotal, 100 + 60 + 40 + 20);
  assert.equal(result.clicksTotal, 5 + 3 + 2 + 1);
});

test('getGscAttributionInRange: branchesを渡さなければ全件がその他になる', () => {
  const now = '2026-07-29T00:00:00.000Z';
  seoDb.upsertGscQueryRows(
    [{ site_property: 'sc-domain:an-english.com', date: '2026-07-14', query: 'q-no-branches', page: 'https://an-english.com/2026/07/40001/', clicks: 1, impressions: 10 }],
    now
  );
  const result = seoDb.getGscAttributionInRange({ startDate: '2026-07-14', endDate: '2026-07-14', branches: [] });
  assert.equal(result.impressionsOther, 10);
  assert.deepEqual(result.perBranch, {});
});

test('upsertKeywordMetric/upsertSerpRanking: CSV取込のupsertが重複行を作らない', () => {
  const now = '2026-07-13T00:00:00.000Z';
  seoDb.upsertKeywordMetric({ keyword: '守山区 塾', normalized_keyword: '守山区 塾', average_monthly_searches: 10, source: 'keyword_planner_csv' }, now);
  seoDb.upsertKeywordMetric({ keyword: '守山区 塾', normalized_keyword: '守山区 塾', average_monthly_searches: 20, source: 'keyword_planner_csv' }, now);
  const metric = seoDb.getKeywordMetric('守山区 塾', 'keyword_planner_csv');
  assert.equal(metric.average_monthly_searches, 20);

  seoDb.upsertSerpRanking({ keyword: '守山区 塾', normalized_keyword: '守山区 塾', domain: 'an-english.com', position: 5, checked_at: '2026-07-01', source: 'serp_csv' }, now);
  seoDb.upsertSerpRanking({ keyword: '守山区 塾', normalized_keyword: '守山区 塾', domain: 'an-english.com', position: 3, checked_at: '2026-07-01', source: 'serp_csv' }, now);
  const rankings = seoDb.listSerpRankingsForKeyword('守山区 塾');
  assert.equal(rankings.length, 1);
  assert.equal(rankings[0].position, 3);
});

test('upsertCompoundKeyword/upsertPageCompoundKeyword/listCompoundKeywordCoverage: 複合キーワードの登録・集計ができる', () => {
  const now = '2026-07-13T00:00:00.000Z';
  seoDb.upsertCompetitor({ id: 'ck1', name: '競合CK', domain: 'ck.example.com' }, now);
  const page = seoDb.upsertCompetitorPage(
    { competitor_id: 'ck1', url: 'https://ck.example.com/a', canonical_url: 'https://ck.example.com/a', fetched_at: now },
    now
  );
  const compoundId = seoDb.upsertCompoundKeyword(
    {
      compound_keyword: '小幡 塾',
      template_type: 'area_juku',
      keyword_components: { area: '小幡', service: '塾' },
      target_area: '小幡',
    },
    now
  );
  const compoundId2 = seoDb.upsertCompoundKeyword(
    { compound_keyword: '小幡 塾', template_type: 'area_juku', keyword_components: { area: '小幡', service: '塾' }, target_area: '小幡' },
    now
  );
  assert.equal(compoundId, compoundId2); // 重複作成しない

  seoDb.upsertPageCompoundKeyword({ page_id: page.id, compound_keyword_id: compoundId, cooccurrence_score: 1.0, same_zone: 'title' }, now);
  const coverage = seoDb.listCompoundKeywordCoverage();
  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].compound_keyword, '小幡 塾');
  assert.equal(coverage[0].competitor_id, 'ck1');
});

test('getGscPagesForQuery: 同一クエリのページ別実績を返す', () => {
  const now = '2026-07-13T00:00:00.000Z';
  seoDb.upsertGscQueryRow({ site_property: 'https://an-english.com/', date: '2026-07-01', query: 'カニバリテスト', page: '/a', clicks: 1, impressions: 10 }, now);
  seoDb.upsertGscQueryRow({ site_property: 'https://an-english.com/', date: '2026-07-01', query: 'カニバリテスト', page: '/b', clicks: 1, impressions: 5 }, now);
  const rows = seoDb.getGscPagesForQuery('カニバリテスト');
  assert.equal(rows.length, 2);
});

test('upsertKeywordCandidate: 複合キーワード用の新規カラムを保存・取得できる', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const created = seoDb.upsertKeywordCandidate(
    {
      normalized_keyword: '小幡 個別指導',
      gap_type: 'missing',
      priority_score: 70,
      keyword_components: { area: '小幡', teaching_style: '個別指導' },
      template_type: 'area_teaching_style',
      cooccurrence_score: 1.0,
      search_intent: 'general_service',
      content_type: 'blog_article',
      data_confidence: 55,
      cannibalization_warning: { pages: [{ page: '/a', impressions: 10 }, { page: '/b', impressions: 5 }] },
    },
    now
  );
  const candidate = seoDb.getKeywordCandidateById(created.id);
  assert.equal(candidate.template_type, 'area_teaching_style');
  assert.equal(candidate.data_confidence, 55);
  assert.deepEqual(candidate.keyword_components, { area: '小幡', teaching_style: '個別指導' });
  assert.equal(candidate.cannibalization_warning.pages.length, 2);
});

test('updateCandidateStatus: approvedActionを渡すとapproved_actionも記録される', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const created = seoDb.upsertKeywordCandidate({ normalized_keyword: '瓢箪山 定期テスト対策', gap_type: 'missing', priority_score: 60 }, now);
  seoDb.updateCandidateStatus(created.id, { toStatus: 'approved', actor: 'dashboard', approvedAction: 'create_article' }, now);
  const candidate = seoDb.getKeywordCandidateById(created.id);
  assert.equal(candidate.status, 'approved');
  assert.equal(candidate.approved_action, 'create_article');
});

test('upsertTask: 新規登録と更新の両方でidが変わらず重複作成しない', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const first = seoDb.upsertTask(
    { task_type: 'improve_school_page', target_keyword: '小幡 塾', opportunity_score: 70, recommended_action: 'improve_school_page', reason: ['競合5社'] },
    now
  );
  assert.equal(first.isNew, true);
  const second = seoDb.upsertTask(
    { task_type: 'improve_school_page', target_keyword: '小幡 塾', opportunity_score: 85, recommended_action: 'improve_school_page', reason: ['競合6社に増加'] },
    now
  );
  assert.equal(second.isNew, false);
  assert.equal(second.id, first.id);
  const task = seoDb.getTaskById(first.id);
  assert.equal(task.opportunity_score, 85);
  assert.deepEqual(task.reason, ['競合6社に増加']);
});

test('listTasks: opportunity_score降順で返し、statusで絞り込める', () => {
  const now = '2026-07-13T00:00:00.000Z';
  seoDb.upsertTask({ task_type: 'add_faq', target_keyword: '料金テスト', opportunity_score: 30, recommended_action: 'add_faq' }, now);
  seoDb.upsertTask({ task_type: 'create_article', target_keyword: '守山東中 定期テスト', opportunity_score: 90, recommended_action: 'create_article' }, now);
  const tasks = seoDb.listTasks({});
  assert.ok(tasks[0].opportunity_score >= tasks[1].opportunity_score);

  const proposedOnly = seoDb.listTasks({ status: 'proposed' });
  assert.ok(proposedOnly.every((t) => t.status === 'proposed'));
});

test('updateTaskStatus: proposed→approved→rejectedの遷移ができる', () => {
  const now = '2026-07-13T00:00:00.000Z';
  const created = seoDb.upsertTask({ task_type: 'monitor', target_keyword: 'ステータス遷移テスト', opportunity_score: 10, recommended_action: 'monitor' }, now);
  const result = seoDb.updateTaskStatus(created.id, 'approved', now);
  assert.equal(result.from, 'proposed');
  assert.equal(result.to, 'approved');
  assert.equal(seoDb.getTaskById(created.id).status, 'approved');
});
