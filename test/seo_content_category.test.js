'use strict';

// content_category分類(2026-07-29)のテスト。DB不使用の純粋関数。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyContentCategory } = require('../scripts/lib/seo/content_category');

test('classifyContentCategory: 習い事語句を含むキーワードはnaraigotoになる', () => {
  assert.equal(classifyContentCategory('そろばん 効果'), 'naraigoto');
  assert.equal(classifyContentCategory('小幡 英会話'), 'naraigoto');
  assert.equal(classifyContentCategory('習字 書き初め'), 'naraigoto');
  assert.equal(classifyContentCategory('プログラミング教室'), 'naraigoto');
  assert.equal(classifyContentCategory('将棋 強くなる'), 'naraigoto');
});

test('classifyContentCategory: 塾の一般語・学年・教科・受験関連語はjukuになる', () => {
  assert.equal(classifyContentCategory('個別指導'), 'juku');
  assert.equal(classifyContentCategory('小6 塾'), 'juku');
  assert.equal(classifyContentCategory('数学'), 'juku');
  assert.equal(classifyContentCategory('守山区 高校入試'), 'juku');
  assert.equal(classifyContentCategory('自立学習'), 'juku');
});

test('classifyContentCategory: 校舎名・地域名単体など判定できないものはnull(無理に分類しない)', () => {
  assert.equal(classifyContentCategory('守山区'), null);
  assert.equal(classifyContentCategory('小幡'), null);
  assert.equal(classifyContentCategory('瓢箪山'), null);
});

test('classifyContentCategory: naraigoto判定はjuku判定より優先される(英会話はSUBJECTSにも含まれるがnaraigoto)', () => {
  assert.equal(classifyContentCategory('英会話'), 'naraigoto');
});

test('classifyContentCategory: 空文字・null・undefinedはnull', () => {
  assert.equal(classifyContentCategory(''), null);
  assert.equal(classifyContentCategory(null), null);
  assert.equal(classifyContentCategory(undefined), null);
});
