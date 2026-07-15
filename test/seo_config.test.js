'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadJukuConfig, loadSeoCompetitorsConfig } = require('../scripts/lib/config');

test('loadJukuConfig: competitor_keyword_analysisは既定で全フラグfalse', () => {
  const config = loadJukuConfig();
  const feature = config.features.competitor_keyword_analysis;
  assert.equal(feature.enabled, false);
  assert.equal(feature.use_for_topic_selection, false);
  assert.equal(feature.crawl_enabled, false);
  assert.equal(feature.search_console_enabled, false);
});

test('loadJukuConfig: seo.competitor_analysisのパラメータがハードコードされず設定から読める', () => {
  const config = loadJukuConfig();
  const seo = config.seo.competitor_analysis;
  assert.equal(seo.max_pages_per_site, 100);
  assert.equal(seo.request_interval_ms, 3000);
  assert.equal(seo.extraction_weights.title, 5);
  assert.equal(seo.priority_score_weights.area_relevance, 25);
});

test('loadJukuConfig: growth_directorはSprint 3.9アクティベーション後はtrue', () => {
  const config = loadJukuConfig();
  assert.equal(config.features.growth_director.enabled, true);
});

test('loadJukuConfig: seo.growth_directorのパラメータがハードコードされず設定から読める', () => {
  const config = loadJukuConfig();
  const gd = config.seo.growth_director;
  assert.equal(gd.opportunity_score_weights.competitor_adoption, 20);
  assert.equal(gd.effort_minutes_by_task_type.create_article, 30);
});

test('loadSeoCompetitorsConfig: 登録済み競合はid/domain/crawl_enabledを持つ', () => {
  const config = loadSeoCompetitorsConfig();
  assert.ok(Array.isArray(config.competitors));
  config.competitors.forEach((c) => {
    assert.ok(c.id);
    assert.ok(c.domain);
    assert.ok(typeof c.crawl_enabled === 'boolean');
  });
});
