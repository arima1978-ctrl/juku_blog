'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideRecommendedAction } = require('../scripts/lib/seo/recommended_action');

test('isLowIntent=true(求人語等)は常にexclude', () => {
  assert.equal(decideRecommendedAction({ gapType: 'missing', isLowIntent: true, ownHasArticle: false }), 'exclude');
});

test('高意図語が無い(isLowIntent=false)だけでは除外しない(教科名・学年名・地域名単体等)', () => {
  assert.equal(decideRecommendedAction({ gapType: 'missing', isLowIntent: false, ownHasArticle: false }), 'create_article');
});

test('missing/untapped/content_gapはcreate_article(templateType未指定時)', () => {
  assert.equal(decideRecommendedAction({ gapType: 'missing', isLowIntent: false, ownHasArticle: false }), 'create_article');
  assert.equal(decideRecommendedAction({ gapType: 'untapped', isLowIntent: false, ownHasArticle: false }), 'create_article');
  assert.equal(decideRecommendedAction({ gapType: 'content_gap', isLowIntent: false, ownHasArticle: false }), 'create_article');
});

test('weak かつ自社記事ありはimprove_existing_article(テンプレートに関わらず優先)', () => {
  assert.equal(
    decideRecommendedAction({ gapType: 'weak', isLowIntent: false, ownHasArticle: true, templateType: 'area_juku', existingPostId: 5 }),
    'improve_existing_article'
  );
});

test('strongはmonitor', () => {
  assert.equal(decideRecommendedAction({ gapType: 'strong', isLowIntent: false, ownHasArticle: true }), 'monitor');
});

test('sharedはmonitor', () => {
  assert.equal(decideRecommendedAction({ gapType: 'shared', isLowIntent: false, ownHasArticle: true }), 'monitor');
});

test('area_juku/area_muryou_taikenは既存校舎ページがあればimprove_school_page', () => {
  assert.equal(
    decideRecommendedAction({ gapType: 'missing', isLowIntent: false, ownHasArticle: false, templateType: 'area_juku', existingPostId: 12 }),
    'improve_school_page'
  );
  assert.equal(
    decideRecommendedAction({ gapType: 'untapped', isLowIntent: false, ownHasArticle: false, templateType: 'area_muryou_taiken', existingPostId: 3 }),
    'improve_school_page'
  );
});

test('area_juku/area_muryou_taikenでも既存校舎ページが無ければcreate_article', () => {
  assert.equal(
    decideRecommendedAction({ gapType: 'missing', isLowIntent: false, ownHasArticle: false, templateType: 'area_juku', existingPostId: null }),
    'create_article'
  );
});

test('school_teiki_test/area_koko_nyushi/area_teiki_testはcreate_article', () => {
  assert.equal(decideRecommendedAction({ gapType: 'untapped', isLowIntent: false, templateType: 'school_teiki_test' }), 'create_article');
  assert.equal(decideRecommendedAction({ gapType: 'untapped', isLowIntent: false, templateType: 'area_koko_nyushi' }), 'create_article');
  assert.equal(decideRecommendedAction({ gapType: 'missing', isLowIntent: false, templateType: 'area_teiki_test' }), 'create_article');
});

test('未指定テンプレート(area_grade_juku等)は既定でcreate_article', () => {
  assert.equal(decideRecommendedAction({ gapType: 'untapped', isLowIntent: false, templateType: 'area_grade_juku' }), 'create_article');
  assert.equal(decideRecommendedAction({ gapType: 'untapped', isLowIntent: false, templateType: 'school_juku' }), 'create_article');
});
