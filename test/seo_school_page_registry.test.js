'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSchoolPages,
  filterEnabled,
  findSchoolPageIn,
  listEnabledSchoolPages,
  findSchoolPageByArea,
  getSchoolPageById,
  getSchoolPageByUrl,
} = require('../scripts/lib/seo/school_page_registry');
const { loadSeoCompetitorsConfig } = require('../scripts/lib/config');

test('validateSchoolPages: idが重複していれば例外', () => {
  assert.throws(
    () =>
      validateSchoolPages([
        { id: 'a', url: 'https://example.com/a/', target_areas: ['小幡'] },
        { id: 'a', url: 'https://example.com/b/', target_areas: ['守山区'] },
      ]),
    /重複/
  );
});

test('validateSchoolPages: urlがhttps://でなければ例外', () => {
  assert.throws(
    () => validateSchoolPages([{ id: 'a', url: 'http://example.com/a/', target_areas: ['小幡'] }]),
    /https/
  );
});

test('validateSchoolPages: target_areasが空配列なら例外', () => {
  assert.throws(
    () => validateSchoolPages([{ id: 'a', url: 'https://example.com/a/', target_areas: [] }]),
    /target_areas/
  );
});

test('validateSchoolPages: idが無ければ例外', () => {
  assert.throws(() => validateSchoolPages([{ url: 'https://example.com/a/', target_areas: ['小幡'] }]));
});

test('validateSchoolPages: 妥当なデータは例外を投げない', () => {
  assert.doesNotThrow(() =>
    validateSchoolPages([{ id: 'a', url: 'https://example.com/a/', target_areas: ['小幡'] }])
  );
});

test('filterEnabled: enabled=falseのページを除外する', () => {
  const pages = [
    { id: 'a', enabled: true, target_areas: ['小幡'] },
    { id: 'b', enabled: false, target_areas: ['本山'] },
    { id: 'c', target_areas: ['大森'] }, // enabled省略 → 既定true扱い
  ];
  const result = filterEnabled(pages);
  assert.deepEqual(result.map((p) => p.id), ['a', 'c']);
});

test('findSchoolPageIn: 完全一致のみ(過度な部分一致はしない)', () => {
  const pages = [{ id: 'a', url: 'https://example.com/a/', target_areas: ['守山区'] }];
  assert.equal(findSchoolPageIn(pages, '守山区'), pages[0]);
  assert.equal(findSchoolPageIn(pages, '守山区役所前'), null); // 部分一致では拾わない
  assert.equal(findSchoolPageIn(pages, null), null);
});

test('findSchoolPageIn: normalizeKeyword経由で表記揺れ(名古屋市守山区→守山区)を吸収する', () => {
  const pages = [{ id: 'a', url: 'https://example.com/a/', target_areas: ['守山区'] }];
  assert.equal(findSchoolPageIn(pages, '名古屋市守山区'), pages[0]);
});

test('listEnabledSchoolPages: 実データ(小幡教室)がenabled=trueで登録されている', () => {
  const pages = listEnabledSchoolPages();
  const obata = pages.find((p) => p.id === 'obata');
  assert.ok(obata, '小幡教室(id=obata)が見つかりません');
  assert.equal(obata.url, 'https://an-english.com/school/obata/');
  assert.ok(obata.target_areas.includes('守山区'));
});

test('findSchoolPageByArea: 小幡/守山区/瓢箪山のいずれからも小幡教室にマッチする', () => {
  assert.equal(findSchoolPageByArea('小幡').id, 'obata');
  assert.equal(findSchoolPageByArea('守山区').id, 'obata');
  assert.equal(findSchoolPageByArea('瓢箪山').id, 'obata');
});

test('findSchoolPageByArea: 対応する校舎ページが無い地域はnull', () => {
  assert.equal(findSchoolPageByArea('本山'), null);
});

test('getSchoolPageById / getSchoolPageByUrl: idまたはurlで取得できる', () => {
  assert.equal(getSchoolPageById('obata').name, '小幡教室');
  assert.equal(getSchoolPageByUrl('https://an-english.com/school/obata/').id, 'obata');
  assert.equal(getSchoolPageById('not_exist'), null);
});

test('config/school_pages.yamlはconfig/seo_competitors.yamlと完全に分離している(自社ドメインが競合として登録されていない)', () => {
  const competitors = loadSeoCompetitorsConfig();
  const competitorDomains = (competitors.competitors || []).map((c) => c.domain);
  assert.ok(!competitorDomains.includes('an-english.com'));
});
