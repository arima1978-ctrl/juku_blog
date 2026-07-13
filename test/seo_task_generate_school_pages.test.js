'use strict';

const os = require('node:os');
const path = require('node:path');
process.env.JUKU_BLOG_DB_PATH = path.join(os.tmpdir(), `juku_blog_seo_task_school_pages_test_${process.pid}.sqlite`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { closeDb, insertPost, updatePostBySlug } = require('../scripts/lib/db');
const seoDb = require('../scripts/lib/seo_db');
const { buildTaskForCandidate } = require('../scripts/seo_task_generate');

after(() => {
  closeDb();
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_DB_PATH);
  } catch {
    // 既に無ければ無視
  }
});

const OPPORTUNITY_WEIGHTS = {
  competitor_adoption: 20,
  area_relevance: 20,
  search_intent: 20,
  own_coverage_gap: 20,
  data_confidence: 10,
  effort_efficiency: 10,
};
const EFFORT_MINUTES = {
  add_faq: 5,
  add_internal_links: 5,
  improve_school_page: 10,
  improve_existing_article: 15,
  create_article: 30,
  monitor: 0,
  exclude: 0,
};

const OBATA_PAGE = { id: 'obata', name: '小幡教室', url: 'https://an-english.com/school/obata/', target_areas: ['小幡', '守山区', '瓢箪山'] };
function fakeFindSchoolPage(targetArea) {
  return OBATA_PAGE.target_areas.includes(targetArea) ? OBATA_PAGE : null;
}

function baseOpts(findSchoolPage = fakeFindSchoolPage) {
  return {
    effortMinutesByTaskType: EFFORT_MINUTES,
    opportunityWeights: OPPORTUNITY_WEIGHTS,
    totalCompetitorsConsidered: 5,
    findSchoolPage,
  };
}

test('校舎ページに一致する候補: improve_school_pageとしてtarget_url/target_page_*を反映する', () => {
  const candidate = {
    id: 1,
    normalized_keyword: '守山区 塾',
    template_type: 'area_juku',
    gap_type: 'untapped',
    target_area: '守山区',
    competitor_count: 3,
    priority_score: 70,
    data_confidence: 60,
    search_intent: 'high',
    score_breakdown: { area_relevance: { ratio: 0.8 } },
    existing_post_id: null,
  };
  const task = buildTaskForCandidate(candidate, baseOpts());
  assert.equal(task.task_type, 'improve_school_page');
  assert.equal(task.target_url, 'https://an-english.com/school/obata/');
  assert.equal(task.target_page_type, 'school_page');
  assert.equal(task.target_page_id, 'obata');
  assert.equal(task.target_page_name, '小幡教室');
});

test('校舎ページに一致しない候補(校舎ページ対応テンプレート): monitorとなりtarget_page_*はnull', () => {
  const candidate = {
    id: 2,
    normalized_keyword: '本山 塾',
    template_type: 'area_juku',
    gap_type: 'untapped',
    target_area: '本山',
    competitor_count: 2,
    priority_score: 60,
    data_confidence: 50,
    search_intent: 'high',
    score_breakdown: { area_relevance: { ratio: 0.5 } },
    existing_post_id: null,
  };
  const task = buildTaskForCandidate(candidate, baseOpts());
  assert.equal(task.task_type, 'monitor');
  assert.equal(task.target_url, null);
  assert.equal(task.target_page_type, null);
  assert.equal(task.target_page_id, null);
  assert.equal(task.target_page_name, null);
});

test('校舎ページ対応テンプレート以外(既存記事あり)は従来どおりimprove_existing_article、target_page_*は無関係のためnull', () => {
  const nowIso = '2026-07-13T00:00:00.000Z';
  const postId = insertPost({
    created_at: nowIso,
    title: '高校入試 内申点',
    slug: 'existing-koko-nyushi',
    category: '受験情報',
    body_md: '本文',
    body_html: '<p>本文</p>',
  });
  updatePostBySlug('existing-koko-nyushi', { wp_link: 'https://an-english.com/existing-koko-nyushi/' });

  const candidate = {
    id: 3,
    normalized_keyword: '高校入試 内申点',
    template_type: null,
    gap_type: 'weak',
    target_area: '守山区', // 校舎ページはあるが対応テンプレートではないため無関係
    competitor_count: 4,
    priority_score: 55,
    data_confidence: 70,
    search_intent: 'medium',
    score_breakdown: { area_relevance: { ratio: 0.3 } },
    existing_post_id: postId,
  };
  const task = buildTaskForCandidate(candidate, baseOpts());
  assert.equal(task.task_type, 'improve_existing_article');
  assert.equal(task.target_url, 'https://an-english.com/existing-koko-nyushi/');
  assert.equal(task.target_page_type, null);
  assert.equal(task.target_page_id, null);
});

test('実際のconfig/school_pages.yaml経由: 「瓢箪山 塾」(area_juku)は小幡教室に割り当てられ、create_articleへは流れない', () => {
  const candidate = {
    id: 10,
    normalized_keyword: '瓢箪山 塾',
    template_type: 'area_juku',
    gap_type: 'untapped',
    target_area: '瓢箪山',
    competitor_count: 2,
    priority_score: 65,
    data_confidence: 55,
    search_intent: 'high',
    score_breakdown: { area_relevance: { ratio: 0.7 } },
    existing_post_id: null,
  };
  // findSchoolPageを注入せず、既定値(実際のscripts/lib/seo/school_page_registry.jsの
  // findSchoolPageByArea、実データconfig/school_pages.yaml参照)をそのまま使う。
  const task = buildTaskForCandidate(candidate, {
    effortMinutesByTaskType: EFFORT_MINUTES,
    opportunityWeights: OPPORTUNITY_WEIGHTS,
    totalCompetitorsConsidered: 5,
  });
  assert.equal(task.task_type, 'improve_school_page');
  assert.notEqual(task.task_type, 'create_article');
  assert.equal(task.recommended_action, 'improve_school_page');
  assert.equal(task.target_url, 'https://an-english.com/school/obata/');
  assert.equal(task.target_page_name, '小幡教室');
  assert.equal(task.target_page_id, 'obata');
  assert.equal(task.target_page_type, 'school_page');
});

test('Opportunity Scoreは校舎ページ一致の有無で変化しない(既存の計算式は変更しない)', () => {
  const candidateMatched = {
    id: 4,
    normalized_keyword: '小幡 塾',
    template_type: 'area_juku',
    gap_type: 'untapped',
    target_area: '小幡',
    competitor_count: 3,
    priority_score: 70,
    data_confidence: 60,
    search_intent: 'high',
    score_breakdown: { area_relevance: { ratio: 0.8 } },
    existing_post_id: null,
  };
  const candidateUnmatched = { ...candidateMatched, id: 5, target_area: '本山' };

  const taskMatched = buildTaskForCandidate(candidateMatched, baseOpts());
  const taskUnmatched = buildTaskForCandidate(candidateUnmatched, baseOpts());

  // task_typeはimprove_school_page/monitorで異なるため effort_minutes は違うが、
  // Opportunity Score自体の算出式(competitor_adoption/area_relevance/search_intent/
  // own_coverage_gap/data_confidence)はgap_type等が同一である限り一致するはず
  // (effort_efficiencyのみ影響し得る)。ここではeffort_efficiency以外の内訳が
  // 一致することを確認する(二重計上されていないことの確認)。
  assert.equal(taskMatched.opportunity_breakdown.competitor_adoption.ratio, taskUnmatched.opportunity_breakdown.competitor_adoption.ratio);
  assert.equal(taskMatched.opportunity_breakdown.area_relevance.ratio, taskUnmatched.opportunity_breakdown.area_relevance.ratio);
  assert.equal(taskMatched.opportunity_breakdown.search_intent.ratio, taskUnmatched.opportunity_breakdown.search_intent.ratio);
  assert.equal(taskMatched.opportunity_breakdown.own_coverage_gap.ratio, taskUnmatched.opportunity_breakdown.own_coverage_gap.ratio);
  assert.equal(taskMatched.opportunity_breakdown.data_confidence.ratio, taskUnmatched.opportunity_breakdown.data_confidence.ratio);
});
