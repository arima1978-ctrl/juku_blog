'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateUrl, containsFaqTerm } = require('../scripts/lib/seo/url_allocator');

test('containsFaqTerm: FAQ語(料金/月謝等)を検出する', () => {
  assert.equal(containsFaqTerm('料金'), true);
  assert.equal(containsFaqTerm('月謝 相場'), true);
  assert.equal(containsFaqTerm('守山区 塾'), false);
});

test('例1: 守山区 塾(area_juku、既存校舎ページあり) → improve_school_page', () => {
  const result = allocateUrl({
    normalizedKeyword: '守山区 塾',
    templateType: 'area_juku',
    gapType: 'untapped',
    existingPostId: 12,
  });
  assert.equal(result.taskType, 'improve_school_page');
});

test('例2: 守山東中 定期テスト(school_teiki_test、既存記事なし) → create_article', () => {
  const result = allocateUrl({
    normalizedKeyword: '守山東中学校 定期テスト',
    templateType: 'school_teiki_test',
    gapType: 'missing',
  });
  assert.equal(result.taskType, 'create_article');
});

test('例3: 高校入試 内申点(既存記事に一致) → improve_existing_article', () => {
  const result = allocateUrl({
    normalizedKeyword: '高校入試 内申点',
    templateType: null,
    gapType: 'weak',
    existingPostId: 34,
  });
  assert.equal(result.taskType, 'improve_existing_article');
});

test('例4: 料金 → add_faq(他の条件より優先)', () => {
  const result = allocateUrl({
    normalizedKeyword: '料金',
    templateType: null,
    gapType: 'missing',
  });
  assert.equal(result.taskType, 'add_faq');
});

test('isLowIntent=trueは他の条件より優先してexclude', () => {
  const result = allocateUrl({
    normalizedKeyword: '守山区 塾 求人',
    templateType: 'area_juku',
    gapType: 'missing',
    isLowIntent: true,
    existingPostId: 1,
  });
  assert.equal(result.taskType, 'exclude');
});

test('gapType=strongはmonitor(FAQ/school_pageより後、isLowIntentより前ではない)', () => {
  const result = allocateUrl({ normalizedKeyword: '守山区 塾', templateType: null, gapType: 'strong' });
  assert.equal(result.taskType, 'monitor');
});

test('school_page系テンプレートで既存ページが無ければcreate_article', () => {
  const result = allocateUrl({
    normalizedKeyword: '瓢箪山 無料体験',
    templateType: 'area_muryou_taiken',
    gapType: 'untapped',
    existingPostId: null,
  });
  assert.equal(result.taskType, 'create_article');
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
