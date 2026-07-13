'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMarkdownHeadings,
  buildOwnCoverageIndex,
  getOwnCoverage,
  buildOwnCompoundCoverageIndex,
  getOwnCompoundCoverage,
  isOwnContentThinner,
} = require('../scripts/lib/seo/own_content_analyzer');
const { buildDictionaryEntries } = require('../scripts/lib/seo/keyword_extractor');
const { loadJukuConfig } = require('../scripts/lib/config');

const WEIGHTS = { title: 5, h1: 5, h2: 3, h3: 2, meta_description: 2, body: 1 };

test('parseMarkdownHeadings: ##/###見出しをlevel付き配列で抽出する', () => {
  const headings = parseMarkdownHeadings('# タイトルではない\n## 見出し2\n本文\n### 見出し3\n');
  assert.deepEqual(headings, [
    { level: 'h2', text: '見出し2' },
    { level: 'h3', text: '見出し3' },
  ]);
});

test('buildOwnCoverageIndex/getOwnCoverage: 記事本文からキーワードカバレッジを索引化する', () => {
  const posts = [
    {
      id: 1,
      title: '守山区の個別指導塾の選び方',
      slug: 'moriyama-juku-guide',
      meta_description: '守山区で塾をお探しの方へ',
      body_md: '## 個別指導のメリット\n守山区にお住まいの方向けの記事です。',
    },
  ];
  const entries = buildDictionaryEntries(loadJukuConfig());
  const index = buildOwnCoverageIndex(posts, entries, WEIGHTS);
  const coverage = getOwnCoverage(index, '守山区');
  assert.ok(coverage);
  assert.equal(coverage.postId, 1);
});

test('getOwnCoverage: 存在しないキーワードはnull', () => {
  const index = buildOwnCoverageIndex([], [], WEIGHTS);
  assert.equal(getOwnCoverage(index, '存在しない'), null);
});

test('isOwnContentThinner: 自社の方が大幅に短ければtrue', () => {
  const result = isOwnContentThinner({ bodyLength: 100 }, 1000);
  assert.equal(result, true);
});

test('isOwnContentThinner: 十分な長さがあればfalse', () => {
  const result = isOwnContentThinner({ bodyLength: 900 }, 1000);
  assert.equal(result, false);
});

test('isOwnContentThinner: 判定材料が無ければnull', () => {
  assert.equal(isOwnContentThinner(null, 1000), null);
  assert.equal(isOwnContentThinner({ bodyLength: 100 }, 0), null);
});

test('buildOwnCompoundCoverageIndex: 同一記事内で共起する複合キーワードをカバー済みとして索引化する', () => {
  const posts = [
    {
      id: 1,
      title: '守山区の個別指導塾の選び方',
      slug: 'moriyama-juku-guide',
      meta_description: '',
      body_md: '本文',
    },
  ];
  const entries = buildDictionaryEntries(loadJukuConfig());
  const index = buildOwnCompoundCoverageIndex(posts, entries, WEIGHTS);
  const areaJuku = getOwnCompoundCoverage(index, '守山区 塾');
  assert.ok(areaJuku);
  assert.equal(areaJuku.postId, 1);
  const areaTeachingStyle = getOwnCompoundCoverage(index, '守山区 個別指導');
  assert.ok(areaTeachingStyle);
});

test('buildOwnCompoundCoverageIndex: 別々の記事が別々の語を扱っているだけではカバー済みにならない', () => {
  const posts = [
    { id: 1, title: '守山区の教育事情', slug: 'a', meta_description: '', body_md: '本文' },
    { id: 2, title: '個別指導のメリット', slug: 'b', meta_description: '', body_md: '本文' },
  ];
  const entries = buildDictionaryEntries(loadJukuConfig());
  const index = buildOwnCompoundCoverageIndex(posts, entries, WEIGHTS);
  assert.equal(getOwnCompoundCoverage(index, '守山区 個別指導'), null);
});

test('getOwnCompoundCoverage: 存在しない複合キーワードはnull', () => {
  const index = buildOwnCompoundCoverageIndex([], [], WEIGHTS);
  assert.equal(getOwnCompoundCoverage(index, '存在しない 複合語'), null);
});
