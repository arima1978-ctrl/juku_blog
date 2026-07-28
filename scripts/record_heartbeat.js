'use strict';

// シェルスクリプト(daily_blog_all.sh/seo_weekly_analysis.sh/backup_db.sh)から呼ぶCLI。
// 使い方: node scripts/record_heartbeat.js <name> [--failed] [--detail="text"] [--completed-at=<ISO8601>]
// --completed-atは、監視導入前に実際に完了していたバッチの初期heartbeatを手動バックフィル
// する場合のみ使う(通常のcron呼び出しでは省略し、現在時刻が使われる)。
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
  const completedAtArg = argv.find((a) => a.startsWith('--completed-at='));
  const completedAt = completedAtArg ? completedAtArg.slice('--completed-at='.length) : undefined;

  const payload = recordHeartbeat(name, { ok: !failed, detail, completedAt });
  console.log(`[record_heartbeat] ${name}: ok=${payload.ok} at=${payload.completedAt}`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
