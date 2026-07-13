'use strict';

// SEO Taskの除外(CLI)。
//
// 使い方: node scripts/seo_tasks_reject.js <task_id>

const seoDb = require('./lib/seo_db');

function main() {
  const id = Number(process.argv[2]);
  if (!id) {
    console.error('使い方: node scripts/seo_tasks_reject.js <task_id>');
    process.exit(1);
  }
  const task = seoDb.getTaskById(id);
  if (!task) {
    console.error(`[seo_tasks_reject] task id=${id} が見つかりません`);
    process.exit(1);
  }
  const result = seoDb.updateTaskStatus(id, 'rejected', new Date().toISOString());
  console.log(`[seo_tasks_reject] task id=${id}: ${result.from} → ${result.to}`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
