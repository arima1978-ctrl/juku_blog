'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./config');

const EPISODES_PATH = path.join(ROOT, 'data', 'episodes.md');

function readRaw() {
  if (!fs.existsSync(EPISODES_PATH)) return '';
  return fs.readFileSync(EPISODES_PATH, 'utf8');
}

function appendEpisode(text) {
  const raw = readRaw();
  const line = `- [ ] ${text.trim()}\n`;
  fs.writeFileSync(EPISODES_PATH, raw.endsWith('\n') ? raw + line : raw + '\n' + line, 'utf8');
}

// 未使用/使用済みの一覧を返す(ダッシュボード表示・writer-blog-btocの選定用)
function listEpisodes() {
  const raw = readRaw();
  const lines = raw.split('\n');
  const episodes = [];
  for (const line of lines) {
    const unusedMatch = line.match(/^- \[ \] (.+)$/);
    const usedMatch = line.match(/^- \[x\] (.+?)\s*\(used: ([^,]+), post: ([^)]+)\)\s*$/i);
    if (usedMatch) {
      episodes.push({ text: usedMatch[1].trim(), used: true, usedAt: usedMatch[2], usedInPost: usedMatch[3] });
    } else if (unusedMatch) {
      episodes.push({ text: unusedMatch[1].trim(), used: false });
    }
  }
  return episodes;
}

module.exports = { EPISODES_PATH, readRaw, appendEpisode, listEpisodes };
