'use strict';

// 記事末尾の「参考情報」セクションを生成する。実際に使用したソースのみを、
// URL重複無しで掲載する。愛知県教育委員会を使用した記事には公式ページ確認の
// 誘導文を必ず添える。

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// facts: exam_facts_used(各要素にsource_url/source_name/document_titleを持つ)
function buildReferenceSectionHtml(facts) {
  const seenUrls = new Set();
  const items = [];
  let usedOfficialBoardOfEducation = false;

  for (const fact of facts || []) {
    if (!fact.source_url || seenUrls.has(fact.source_url)) continue;
    seenUrls.add(fact.source_url);
    const label = fact.document_title ? `${fact.source_name}「${fact.document_title}」` : fact.source_name;
    items.push({ url: fact.source_url, label });
    if (fact.source_name && fact.source_name.includes('愛知県教育委員会')) {
      usedOfficialBoardOfEducation = true;
    }
  }

  if (items.length === 0) return '';

  const listHtml = items
    .map(
      (item) =>
        `  <li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a></li>`
    )
    .join('\n');

  const guidance = usedOfficialBoardOfEducation
    ? '\n\n<p>\n最新・正確な情報は、愛知県教育委員会の公式ページをご確認ください。\n</p>'
    : '';

  return `<h2>参考情報</h2>\n<ul>\n${listHtml}\n</ul>${guidance}`;
}

module.exports = { buildReferenceSectionHtml };
