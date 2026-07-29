'use strict';

// marked.parse()が出力するHTMLを、WordPress Gutenbergのブロックマークアップ
// (<!-- wp:paragraph -->等のコメント付き)へ変換する(2026-07-29)。
//
// 背景: ブロックコメントを含まない素のHTMLは、WordPress側で人間がブロック
// エディタで開いて編集・保存すると、内部のHTML正規化処理で段落・インライン要素
// (CTAリンク等)が失われることがある(既知のGutenberg挙動)。あま本部校の
// セルフ運用(山口先生がWP下書きを編集・公開)で実際にCTAリンクが消失する
// インシデントが発生したため、生成段階でブロック形式にしておくことで、
// ブロックエディタが素のHTMLを再構成する必要が無いようにする。
//
// 対象タグ(実データで確認済みの範囲): p, h1-h6, ul, ol, blockquote。
// これらはmarked.parse()の出力でトップレベル要素として入れ子にならない前提
// (段落内のa/strongはインライン要素としてそのまま保持される)。
//
// 安全設計: 変換後のHTMLからブロックコメント・追加classを取り除いたものが
// 元のHTMLと一致することを検証し、一致しなければ想定外のパターンとして
// 例外を投げる(変換漏れを黙って見逃さない)。

const BLOCK_TAG_RE = /<(p|h1|h2|h3|h4|h5|h6|ul|ol|blockquote)\b[^>]*>[\s\S]*?<\/\1>/g;

function headingOpenComment(level) {
  return level === 2 ? '<!-- wp:heading -->' : `<!-- wp:heading {"level":${level}} -->`;
}

function wrapBlock(matchedHtml, tag) {
  if (tag === 'p') {
    return `<!-- wp:paragraph -->\n${matchedHtml}\n<!-- /wp:paragraph -->`;
  }
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const withClass = matchedHtml.replace(new RegExp(`^<${tag}`), `<${tag} class="wp-block-heading"`);
    return `${headingOpenComment(level)}\n${withClass}\n<!-- /wp:heading -->`;
  }
  if (tag === 'ul') {
    const withClass = matchedHtml.replace(/^<ul/, '<ul class="wp-block-list"');
    return `<!-- wp:list -->\n${withClass}\n<!-- /wp:list -->`;
  }
  if (tag === 'ol') {
    const withClass = matchedHtml.replace(/^<ol/, '<ol class="wp-block-list"');
    return `<!-- wp:list {"ordered":true} -->\n${withClass}\n<!-- /wp:list -->`;
  }
  if (tag === 'blockquote') {
    return `<!-- wp:quote -->\n${matchedHtml}\n<!-- /wp:quote -->`;
  }
  return matchedHtml; // 未知タグは変更しない(安全弁。呼び出し側の検証で検出される)
}

// 変換後のHTMLからブロックコメント・追加classを取り除き、元のHTML(空白差異を除く)と
// 一致するか検証する。想定外のタグ・構造が混ざっていた場合に、内容の欠落を検知するため。
function stripBlockMarkup(blockHtml) {
  return blockHtml
    .replace(/<!--\s*\/?wp:[^>]*-->/g, '')
    .replace(/ class="wp-block-(heading|list)"/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function normalizeWhitespace(html) {
  return html.replace(/\s+/g, ' ').trim();
}

// html: marked.parse()の出力(トップレベルのp/h1-h6/ul/ol/blockquoteの連続を想定)。
// 戻り値: ブロックマークアップ付きHTML文字列。
function toGutenbergBlocks(html) {
  if (!html || !html.trim()) return html;

  let consumed = 0;
  const blocks = [];
  const unmatched = [];
  BLOCK_TAG_RE.lastIndex = 0;
  let match;
  while ((match = BLOCK_TAG_RE.exec(html)) !== null) {
    const gap = html.slice(consumed, match.index).trim();
    if (gap) unmatched.push(gap);
    blocks.push(wrapBlock(match[0], match[1]));
    consumed = BLOCK_TAG_RE.lastIndex;
  }
  const tail = html.slice(consumed).trim();
  if (tail) unmatched.push(tail);

  if (unmatched.length > 0) {
    throw new Error(
      `toGutenbergBlocks: 想定外のHTML構造を検出しました(変換対象外のタグ、またはトップレベル要素の入れ子)。` +
        `該当箇所: ${JSON.stringify(unmatched.slice(0, 3))}`
    );
  }

  const result = blocks.join('\n\n');

  // 変換の正しさを自己検証する(ブロックマークアップを除去したら元HTMLと一致するはず)。
  if (normalizeWhitespace(stripBlockMarkup(result)) !== normalizeWhitespace(html)) {
    throw new Error('toGutenbergBlocks: 変換後の内容が元のHTMLと一致しません(内容欠落の疑い)。');
  }

  return result;
}

module.exports = { toGutenbergBlocks };
