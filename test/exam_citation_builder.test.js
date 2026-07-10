'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReferenceSectionHtml } = require('../scripts/lib/exam_research/citation_builder');

test('buildReferenceSectionHtml: 使用したソースのみ・URL重複無しで一覧を生成する', () => {
  const facts = [
    { source_url: 'https://www.pref.aichi.jp/a.html', source_name: '愛知県教育委員会', document_title: '令和9年度入学者選抜' },
    { source_url: 'https://www.pref.aichi.jp/a.html', source_name: '愛知県教育委員会', document_title: '令和9年度入学者選抜' },
    { source_url: 'https://www.sanaru-net.com/x', source_name: '佐鳴予備校' },
  ];
  const html = buildReferenceSectionHtml(facts);
  const matches = html.match(/<li>/g) || [];
  assert.equal(matches.length, 2);
  assert.ok(html.includes('愛知県教育委員会「令和9年度入学者選抜」'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('buildReferenceSectionHtml: 愛知県教育委員会を使った場合は公式ページ誘導文を必ず含める', () => {
  const facts = [{ source_url: 'https://www.pref.aichi.jp/a.html', source_name: '愛知県教育委員会' }];
  const html = buildReferenceSectionHtml(facts);
  assert.ok(html.includes('愛知県教育委員会の公式ページをご確認ください'));
});

test('buildReferenceSectionHtml: 愛知県教育委員会を使っていない場合は誘導文を含めない', () => {
  const facts = [{ source_url: 'https://www.sanaru-net.com/x', source_name: '佐鳴予備校' }];
  const html = buildReferenceSectionHtml(facts);
  assert.ok(!html.includes('公式ページをご確認ください'));
});

test('buildReferenceSectionHtml: 事実が空なら空文字を返す', () => {
  assert.equal(buildReferenceSectionHtml([]), '');
});
