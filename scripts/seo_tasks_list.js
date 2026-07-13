'use strict';

// SEO Task一覧表示(CLI)。
//
// 使い方: node scripts/seo_tasks_list.js [--status=proposed] [--task-type=create_article]

const seoDb = require('./lib/seo_db');

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return { status: get('--status='), taskType: get('--task-type=') };
}

function main() {
  const filters = parseArgs(process.argv.slice(2));
  const tasks = seoDb.listTasks(filters);

  if (tasks.length === 0) {
    console.log('[seo_tasks_list] 条件に一致するTaskはありません');
    return;
  }

  console.log('id\topportunity_score\ttask_type\tstatus\testimated_effort_minutes\ttarget_keyword');
  for (const t of tasks) {
    console.log(`${t.id}\t${t.opportunity_score}\t${t.task_type}\t${t.status}\t${t.estimated_effort_minutes ?? ''}\t${t.target_keyword}`);
  }
  console.log(`[seo_tasks_list] ${tasks.length}件`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
