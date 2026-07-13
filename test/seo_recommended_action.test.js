'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideRecommendedAction } = require('../scripts/lib/seo/recommended_action');

test('isLowIntent=true(求人語等)は常にexclude', () => {
  assert.equal(decideRecommendedAction({ gapType: 'missing', isLowIntent: true, ownHasArticle: false }), 'exclude');
});

test('高意図語が無い(isLowIntent=false)だけでは除外しない(教科名・学年名・地域名単体等)', () => {
  // 過去に inquiryIntentRatio===0 を除外条件に使っていたバグの回帰防止テスト
  assert.equal(decideRecommendedAction({ gapType: 'missing', isLowIntent: false, ownHasArticle: false }), 'create_article');
});

test('missing/untapped/content_gapはcreate_article', () => {
  assert.equal(decideRecommendedAction({ gapType: 'missing', isLowIntent: false, ownHasArticle: false }), 'create_article');
  assert.equal(decideRecommendedAction({ gapType: 'untapped', isLowIntent: false, ownHasArticle: false }), 'create_article');
  assert.equal(decideRecommendedAction({ gapType: 'content_gap', isLowIntent: false, ownHasArticle: false }), 'create_article');
});

test('weak かつ自社記事ありはimprove_existing_article', () => {
  assert.equal(decideRecommendedAction({ gapType: 'weak', isLowIntent: false, ownHasArticle: true }), 'improve_existing_article');
});

test('strongはmonitor', () => {
  assert.equal(decideRecommendedAction({ gapType: 'strong', isLowIntent: false, ownHasArticle: true }), 'monitor');
});

test('sharedはmonitor', () => {
  assert.equal(decideRecommendedAction({ gapType: 'shared', isLowIntent: false, ownHasArticle: true }), 'monitor');
});
