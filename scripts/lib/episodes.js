'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./config');
const { extractIds, nextId } = require('./citations');

const EPISODES_PATH = path.join(ROOT, 'data', 'episodes.md');

function readRaw() {
  if (!fs.existsSync(EPISODES_PATH)) return '';
  return fs.readFileSync(EPISODES_PATH, 'utf8');
}

// 出典管理(石橋/智谷が参照するepisode_sources)のため、追加時に一意なID(EP-001等)を
// 自動採番して付与する。
function appendEpisode(text) {
  const raw = readRaw();
  const id = nextId(extractIds(raw, 'EP'), 'EP');
  const line = `- [ ] [${id}] ${text.trim()}\n`;
  fs.writeFileSync(EPISODES_PATH, raw.endsWith('\n') ? raw + line : raw + '\n' + line, 'utf8');
  return id;
}

// 未使用/使用済みの一覧を返す(ダッシュボード表示・writer-blog-btocの選定用)
function listEpisodes() {
  const raw = readRaw();
  const lines = raw.split('\n');
  const episodes = [];
  for (const line of lines) {
    const unusedMatch = line.match(/^- \[ \] \[(EP-\d+)\] (.+)$/);
    const usedMatch = line.match(/^- \[x\] \[(EP-\d+)\] (.+?)\s*\(used: ([^,]+), post: ([^)]+)\)\s*$/i);
    if (usedMatch) {
      episodes.push({ id: usedMatch[1], text: usedMatch[2].trim(), used: true, usedAt: usedMatch[3], usedInPost: usedMatch[4] });
    } else if (unusedMatch) {
      episodes.push({ id: unusedMatch[1], text: unusedMatch[2].trim(), used: false });
    }
  }
  return episodes;
}

module.exports = { EPISODES_PATH, readRaw, appendEpisode, listEpisodes };
