'use strict';

// daily_blog.shのrun_agent()が失敗時、logs/errors.jsonのdetailへ含める末尾抜粋を組み立てる
// (2026-08-08)。旧実装はbash側で`tail -n 10 "$LOG" | tr '\n' ' ' | cut -c1-500`としていたが、
// claude起動のたびに出るNode本体のExperimentalWarning等のノイズ行が先頭側で500文字の枠を
// 埋め尽くし、本当に必要な末尾のエラー文言(例: "Failed to authenticate: OAuth session
// expired")が毎回失われるバグがあった(実インシデントで発覚)。ノイズ行を除外してから
// 末尾側を残すことで解消する。
//
// 使い方: node scripts/build_failure_excerpt.js <logファイルパス>
// 標準出力へ抜粋文字列を書き出す(末尾改行なし)。

const fs = require('node:fs');

// 除外するノイズ行のパターン(2026-08-08〜)。claude起動のたびに出るNode本体の警告や、
// daily_blog.sh冒頭の定型完了ログ等、実際のエラー原因とは無関係な行をここに追加していく
// (要素を1つ増やすだけでよい)。
const NOISE_PATTERNS = [/ExperimentalWarning/, /--trace-warnings/, /^\[sync_wordpress_status\] 完了/, /^\[refresh_indexes\]/];

const DEFAULT_MAX_CHARS = 500;
const DEFAULT_FILTERED_TAIL_LINES = 50;
const DEFAULT_FALLBACK_TAIL_LINES = 10;

function isNoiseLine(line, noisePatterns) {
  return noisePatterns.some((pattern) => pattern.test(line));
}

// マルチバイト文字(絵文字等のサロゲートペアを含む)の途中で切れないよう、文字列を実際の
// Unicodeコードポイント単位の配列にしてから末尾を取る(String.prototype.sliceはUTF-16
// コード単位区切りのため、サロゲートペアの片方だけを切り出して壊れた文字列を生む恐れがある)。
function takeLastChars(text, maxChars) {
  const codePoints = Array.from(text);
  if (codePoints.length <= maxChars) return text;
  return codePoints.slice(-maxChars).join('');
}

// logText: ログファイルの内容全体。ノイズ除外後に1行も残らなければ、除外前の末尾を使う
// フォールバックを行う(ノイズ除外が効きすぎて情報ゼロになるのを防ぐため)。
function buildFailureExcerpt(
  logText,
  {
    noisePatterns = NOISE_PATTERNS,
    maxChars = DEFAULT_MAX_CHARS,
    filteredTailLines = DEFAULT_FILTERED_TAIL_LINES,
    fallbackTailLines = DEFAULT_FALLBACK_TAIL_LINES,
  } = {}
) {
  const lines = (logText || '').split('\n').map((line) => line.trim());
  const nonEmptyLines = lines.filter((line) => line !== '');
  const filteredLines = nonEmptyLines.filter((line) => !isNoiseLine(line, noisePatterns));
  const useLines = filteredLines.length > 0 ? filteredLines.slice(-filteredTailLines) : nonEmptyLines.slice(-fallbackTailLines);
  return takeLastChars(useLines.join(' '), maxChars);
}

module.exports = { buildFailureExcerpt, takeLastChars, isNoiseLine, NOISE_PATTERNS, DEFAULT_MAX_CHARS };

if (require.main === module) {
  const logPath = process.argv[2];
  if (!logPath) {
    console.error('使い方: node scripts/build_failure_excerpt.js <logファイルパス>');
    process.exitCode = 1;
  } else {
    const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    process.stdout.write(buildFailureExcerpt(content));
  }
}
