'use strict';

// logs/errors.json(ダッシュボードの赤いエラーバナー)の解決済みインシデントを
// resolved=trueにする正式な経路(2026-07-29、従来は手動JSON編集のみだった)。
// 既定はプレビューのみ(書き込みなし)。--confirm明示時のみ実際に書き込む。
//
// 使い方:
//   node scripts/errors_resolve.js --list                              # 未解決一覧(index付き)
//   node scripts/errors_resolve.js --index=3 --note="..." --confirm    # 特定の1件を解決済みに
//   node scripts/errors_resolve.js --before=2026-07-19 --note="..." --confirm  # 日時より前を一括
//   node scripts/errors_resolve.js --step=seo_competitor_crawl --before=2026-07-19 --confirm
//   node scripts/errors_resolve.js --all --note="..." --confirm        # 未解決全件

const { readErrors, resolveErrors } = require('./log_error');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    list: has('--list'),
    index: get('--index=') !== undefined ? Number(get('--index=')) : undefined,
    before: get('--before='),
    step: get('--step='),
    all: has('--all'),
    note: get('--note='),
    confirm: has('--confirm'),
  };
}

function buildMatcher({ index, before, step, all }, errorsSnapshot) {
  if (index !== undefined) {
    const target = errorsSnapshot[index];
    return (e) => e === target;
  }
  if (all) return () => true;
  if (before || step) {
    const beforeDate = before ? new Date(before) : null;
    return (e) => (beforeDate ? new Date(e.at) < beforeDate : true) && (step ? e.step === step : true);
  }
  return null;
}

function formatList(errors) {
  return errors
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.resolved)
    .map(({ e, i }) => `[${i}] ${e.at} | ${e.step} | branch=${e.branch_id ?? 'null'} | ${e.detail}`)
    .join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    const errors = readErrors();
    const list = formatList(errors);
    console.log(list || '(未解決のエラーはありません)');
    return;
  }

  const errorsSnapshot = readErrors();
  const matcher = buildMatcher(args, errorsSnapshot);
  if (!matcher) {
    console.error(
      '使い方: node scripts/errors_resolve.js --list | (--index=<n> | --before=<ISO日時> | --step=<name> | --all) [--note=<text>] [--confirm]'
    );
    process.exitCode = 1;
    return;
  }

  const targets = errorsSnapshot.filter((e) => !e.resolved && matcher(e));
  if (targets.length === 0) {
    console.log('[errors_resolve] 条件に一致する未解決エラーはありません');
    return;
  }

  console.log(`[errors_resolve] 対象${targets.length}件${args.confirm ? '(解決済みにします)' : '(--confirmが無いためプレビューのみ)'}:`);
  targets.forEach((e) => console.log(`  ${e.at} | ${e.step} | ${e.detail}`));

  if (!args.confirm) return;

  const count = resolveErrors(matcher, { note: args.note });
  console.log(`[errors_resolve] ${count}件を解決済みにしました`);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, buildMatcher, formatList, main };
