'use strict';

// シェルスクリプト(daily_blog_all.sh/seo_weekly_analysis.sh/backup_db.sh)から呼ぶCLI。
// 使い方: node scripts/record_heartbeat.js <name> [--failed] [--detail="text"]
const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .envが無い場合はスキップ
}
const { recordHeartbeat } = require('./lib/heartbeat');

function main() {
  const argv = process.argv.slice(2);
  const name = argv[0];
  if (!name || name.startsWith('--')) {
    console.error('使い方: node scripts/record_heartbeat.js <name> [--failed] [--detail=<text>]');
    process.exitCode = 1;
    return;
  }
  const failed = argv.includes('--failed');
  const detailArg = argv.find((a) => a.startsWith('--detail='));
  const detail = detailArg ? detailArg.slice('--detail='.length) : null;

  const payload = recordHeartbeat(name, { ok: !failed, detail });
  console.log(`[record_heartbeat] ${name}: ok=${payload.ok} at=${payload.completedAt}`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
