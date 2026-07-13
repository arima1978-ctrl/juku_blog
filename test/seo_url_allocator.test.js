'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateUrl, containsFaqTerm, SCHOOL_PAGE_ELIGIBLE_TEMPLATES } = require('../scripts/lib/seo/url_allocator');

test('containsFaqTerm: FAQ語(料金/月謝等)を検出する', () => {
  assert.equal(containsFaqTerm('料金'), true);
  assert.equal(containsFaqTerm('月謝 相場'), true);
  assert.equal(containsFaqTerm('守山区 塾'), false);
});

test('SCHOOL_PAGE_ELIGIBLE_TEMPLATES: area_juku/area_teaching_style/area_muryou_taikenを含む(station_jukuはarea_jukuに統合済み)', () => {
  assert.ok(SCHOOL_PAGE_ELIGIBLE_TEMPLATES.has('area_juku'));
  assert.ok(SCHOOL_PAGE_ELIGIBLE_TEMPLATES.has('area_teaching_style'));
  assert.ok(SCHOOL_PAGE_ELIGIBLE_TEMPLATES.has('area_muryou_taiken'));
});

test('例1: 小幡 塾(area_juku、既存校舎ページあり) → improve_school_page、targetUrlに校舎ページURLを返す', () => {
  const result = allocateUrl({
    normalizedKeyword: '小幡 塾',
    templateType: 'area_juku',
    gapType: 'untapped',
    existingSchoolPageUrl: 'https://an-english.com/school/obata/',
    existingSchoolPageId: 'obata',
    existingSchoolPageName: '小幡教室',
  });
  assert.equal(result.taskType, 'improve_school_page');
  assert.equal(result.targetUrl, 'https://an-english.com/school/obata/');
  assert.equal(result.targetPageId, 'obata');
  assert.equal(result.targetPageName, '小幡教室');
});

test('例2: 守山区 個別指導(area_teaching_style、既存校舎ページあり) → improve_school_page', () => {
  const result = allocateUrl({
    normalizedKeyword: '守山区 個別指導',
    templateType: 'area_teaching_style',
    gapType: 'missing',
    existingSchoolPageUrl: 'https://an-english.com/school/obata/',
    existingSchoolPageId: 'obata',
    existingSchoolPageName: '小幡教室',
  });
  assert.equal(result.taskType, 'improve_school_page');
});

test('例3: 瓢箪山 塾(area_juku、既存校舎ページあり) → improve_school_page(station_juku相当もarea_juku経由でカバー)', () => {
  const result = allocateUrl({
    normalizedKeyword: '瓢箪山 塾',
    templateType: 'area_juku',
    gapType: 'untapped',
    existingSchoolPageUrl: 'https://an-english.com/school/obata/',
    existingSchoolPageId: 'obata',
    existingSchoolPageName: '小幡教室',
  });
  assert.equal(result.taskType, 'improve_school_page');
  assert.notEqual(result.taskType, 'create_article');
  assert.equal(result.targetUrl, 'https://an-english.com/school/obata/');
  assert.equal(result.targetPageName, '小幡教室');
  assert.equal(result.targetPageId, 'obata');
});

test('例4: 校舎ページ対応テンプレートで登録済み校舎ページが無ければmonitor(create_articleへはフォールバックしない)', () => {
  const result = allocateUrl({
    normalizedKeyword: '本山 無料体験',
    templateType: 'area_muryou_taiken',
    gapType: 'untapped',
    existingSchoolPageUrl: null,
  });
  assert.equal(result.taskType, 'monitor');
  assert.equal(result.targetUrl, null);
  assert.ok(result.reasons.includes('no_registered_school_page_or_landing_page'));
});

test('例5: 守山東中 定期テスト(school_teiki_test、既存記事なし) → create_article(校舎ページ対応テンプレート以外は従来どおり)', () => {
  const result = allocateUrl({
    normalizedKeyword: '守山東中学校 定期テスト',
    templateType: 'school_teiki_test',
    gapType: 'missing',
  });
  assert.equal(result.taskType, 'create_article');
});

test('例6: 高校入試 内申点(既存記事に一致) → improve_existing_article', () => {
  const result = allocateUrl({
    normalizedKeyword: '高校入試 内申点',
    templateType: null,
    gapType: 'weak',
    existingPostId: 34,
  });
  assert.equal(result.taskType, 'improve_existing_article');
});

test('例7: 料金 → add_faq(他の条件より優先)', () => {
  const result = allocateUrl({
    normalizedKeyword: '料金',
    templateType: null,
    gapType: 'missing',
  });
  assert.equal(result.taskType, 'add_faq');
});

test('isLowIntent=trueは他の条件より優先してexclude(校舎ページテンプレート・既存ページありでも)', () => {
  const result = allocateUrl({
    normalizedKeyword: '守山区 塾 求人',
    templateType: 'area_juku',
    gapType: 'missing',
    isLowIntent: true,
    existingSchoolPageUrl: 'https://an-english.com/school/obata/',
  });
  assert.equal(result.taskType, 'exclude');
});

test('gapType=strongはmonitor(FAQ/school_pageより後、isLowIntentより前ではない)', () => {
  const result = allocateUrl({ normalizedKeyword: '守山区 塾', templateType: null, gapType: 'strong' });
  assert.equal(result.taskType, 'monitor');
});

test('relatedPostIdのみあればadd_internal_links', () => {
  const result = allocateUrl({
    normalizedKeyword: '定期テスト 勉強法',
    templateType: null,
    gapType: 'untapped',
    existingPostId: null,
    relatedPostId: 7,
  });
  assert.equal(result.taskType, 'add_internal_links');
});

test('該当条件が無くgap_typeがsharedならmonitor', () => {
  const result = allocateUrl({ normalizedKeyword: '英会話 教室', templateType: null, gapType: 'shared' });
  assert.equal(result.taskType, 'monitor');
});
