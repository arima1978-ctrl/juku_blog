'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');

function loadYaml(relPath) {
  const abs = path.join(ROOT, relPath);
  const raw = fs.readFileSync(abs, 'utf8');
  return yaml.load(raw);
}

function loadJukuConfig() {
  return loadYaml('config/juku.yaml');
}

function loadCalendarConfig() {
  return loadYaml('config/calendar.yaml');
}

function loadExamSourcesConfig() {
  return loadYaml('config/aichi_exam_sources.yaml');
}

function loadSeoCompetitorsConfig() {
  return loadYaml('config/seo_competitors.yaml');
}

module.exports = {
  ROOT,
  loadYaml,
  loadJukuConfig,
  loadCalendarConfig,
  loadExamSourcesConfig,
  loadSeoCompetitorsConfig,
};
