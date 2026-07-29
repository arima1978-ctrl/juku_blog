'use strict';

// data/plans/YYYY-MM-DD.json(智谷が毎朝生成する企画)を日付範囲で読み、どのテーマが
// 選ばれたかを一覧表示する読み取り専用CLI(2026-07-29)。DB非依存・書き込みなし。
// seasonal_topic_id(季節テーマ)/seo_candidate_id(Keyword Gap Lite候補)/どちらでもない
// (曜日テーマのみ)のいずれかを判定する。
// naraigoto-*テーマ・Task57(自立学習)候補が実際に選ばれているかを数日分まとめて
// 確認する用途を想定(ユーザー指示)。
//
// 使い方:
//   node scripts/seo_theme_selection_report.js --since=2026-07-29 --until=2026-08-19
//   node scripts/seo_theme_selection_report.js --days=14 --format=json

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./lib/config');

const PLANS_DIR = path.join(ROOT, 'data', 'plans');

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    since: get('--since='),
    until: get('--until='),
    days: get('--days=') !== undefined ? Number(get('--days=')) : undefined,
    format: get('--format=') || 'text',
  };
}

// ローカル暦日ベースで日付を加減する(UTC変換は日付境界付近でずれるため使わない。
// scripts/lib/seo/week_math.jsと同じ方針)。
function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatDateLocal(new Date(y, m - 1, d + delta));
}

function todayLocal() {
  return formatDateLocal(new Date());
}

function resolveDateRange({ since, until, days }) {
  const end = until || todayLocal();
  const start = since || addDays(end, -(days || 14) + 1);
  const dates = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

// selectionSourceを1つに決定する。両方nullなら曜日テーマのみで選定されたとみなす。
function classifySelection(plan) {
  if (plan.seo_candidate_id != null) return { source: 'seo_candidate', id: plan.seo_candidate_id };
  if (plan.seasonal_topic_id) return { source: 'seasonal_topic', id: plan.seasonal_topic_id };
  return { source: 'weekday_theme', id: null };
}

function readPlan(date, plansDir = PLANS_DIR) {
  const filePath = path.join(plansDir, `${date}.json`);
  if (!fs.existsSync(filePath)) return { date, found: false };
  try {
    const plan = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const selection = classifySelection(plan);
    return {
      date,
      found: true,
      selection,
      weekdayTheme: plan.weekday_theme || null,
      category: plan.category || null,
      titleCandidate: (plan.title_candidates || [])[0] || null,
      selectionScore: plan.selection_score ?? null,
    };
  } catch (err) {
    return { date, found: false, error: err.message };
  }
}

function buildReport({ since, until, days, plansDir } = {}) {
  const dates = resolveDateRange({ since, until, days });
  return dates.map((date) => readPlan(date, plansDir));
}

function formatText(rows) {
  return rows
    .map((r) => {
      if (!r.found) return `${r.date}: (計画ファイルなし${r.error ? ` / ${r.error}` : ''})`;
      const s = r.selection;
      const sourceLabel =
        s.source === 'seo_candidate'
          ? `候補ID=${s.id}(Keyword Gap Lite)`
          : s.source === 'seasonal_topic'
            ? `季節テーマ=${s.id}`
            : `曜日テーマのみ(${r.weekdayTheme || '-'})`;
      return `${r.date}: ${sourceLabel} / ${r.category || '-'} / 「${r.titleCandidate || '-'}」 / score=${r.selectionScore ?? '-'}`;
    })
    .join('\n');
}

function main() {
  const { since, until, days, format } = parseArgs(process.argv.slice(2));
  const rows = buildReport({ since, until, days });

  if (format === 'json') {
    console.log(JSON.stringify({ ok: true, rows }, null, 2));
  } else {
    console.log(formatText(rows));
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, resolveDateRange, classifySelection, readPlan, buildReport, formatText, main };
