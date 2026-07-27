'use strict';

// SEO効果測定 週次スナップショット(2026-07-27)で追加。create_article以外(improve_school_page/
// add_internal_links/add_faq/improve_existing_article)は、WordPress側の手動編集を伴うため
// 実施完了を自動検知できない。人間がこのCLIで確定する(ダッシュボードのボタン化は
// フェーズ2。2026-07-27ユーザー指示によりCLIのみで開始)。
//
// 使い方:
//   node scripts/seo_task_mark_implemented.js --task-id=64 --note="校舎ページ本文に追記済み"
//   node scripts/seo_task_mark_implemented.js --task-id=64 --unset   # 取り消し(implemented_atをNULLへ)

const seoDb = require('./lib/seo_db');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    taskId: get('--task-id=') !== undefined ? Number(get('--task-id=')) : undefined,
    note: get('--note='),
    unset: has('--unset'),
  };
}

function main() {
  const { taskId, note, unset } = parseArgs(process.argv.slice(2));
  if (!taskId) {
    console.error('使い方: node scripts/seo_task_mark_implemented.js --task-id=<id> [--note=<text>] [--unset]');
    process.exitCode = 1;
    return;
  }

  const nowIso = new Date().toISOString();
  const task = unset ? seoDb.unmarkTaskImplemented(taskId, nowIso) : seoDb.markTaskImplemented(taskId, { implementedAt: nowIso, note });

  console.log(
    JSON.stringify(
      {
        ok: true,
        taskId: task.id,
        targetKeyword: task.target_keyword,
        implementedAt: task.implemented_at,
        implementationNote: task.implementation_note,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
