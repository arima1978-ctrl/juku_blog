'use strict';

// LLM応答(Claude Code subagent等が出力したJSONファイル)を検証するCLI。
// 決定的な検証のみを行い、DB・WordPress・LLM・外部サイトへは一切接続しない。
// 入力ファイルも変更しない(読み取り専用)。
//
// 使い方:
//   node scripts/seo_draft_verify.js --input=data/seo_drafts/61.result.json
//   node scripts/seo_draft_verify.js --input=data/seo_drafts/61.result.json --format=json
//   node scripts/seo_draft_verify.js --input=... --format=json --output=data/seo_drafts/61.validation.json

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./lib/config');
const { validateDraftResponse } = require('./lib/seo/draft_response_validator');

function parseArgs(argv) {
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return { input: get('--input='), format: get('--format=') || 'text', output: get('--output=') };
}

function formatText(result) {
  const lines = [`valid: ${result.valid}`, 'errors:'];
  (result.errors.length ? result.errors : ['(なし)']).forEach((e) => lines.push(`  - ${e}`));
  lines.push('warnings:');
  (result.warnings.length ? result.warnings : ['(なし)']).forEach((w) => lines.push(`  - ${w}`));
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('使い方: node scripts/seo_draft_verify.js --input=<path> [--format=text|json] [--output=<path>]');
    process.exit(1);
  }

  const inputPath = path.isAbsolute(args.input) ? args.input : path.join(ROOT, args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`[seo_draft_verify] ファイルが見つかりません: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[seo_draft_verify] JSONとして解析できません: ${err.message}`);
    process.exit(1);
  }

  const result = validateDraftResponse(parsed);
  const output = args.format === 'json' ? JSON.stringify(result, null, 2) : formatText(result);

  if (args.output) {
    const outPath = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`[seo_draft_verify] 出力しました: ${outPath}`);
  } else {
    console.log(output);
  }

  process.exit(result.valid ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { main, formatText };
