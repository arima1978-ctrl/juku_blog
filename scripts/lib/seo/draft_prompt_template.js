'use strict';

// AI改善ドラフト生成用のPromptテンプレート(文字列組み立てのみ、LLM API呼び出しは行わない)。
// ページ本文が取得済みか否かで2モードに分ける。
//   context_available: 現在のページ内容を踏まえた改善案(300字以内)を求める
//   context_missing:    完成文章を生成させず、不足情報の列挙のみを求める
// Search Console実績・Opportunity Score等の内部評価指標は、AIへの背景情報としては渡すが、
// 生成されるページ本文自体には書かせない(安全ルールで明示する)。

const PROMPT_VERSION = 'v1';

const SAFETY_RULES = [
  '実在しない実績・生徒・保護者・合格者を創作しないこと',
  '競合塾を批判・比較しないこと',
  '根拠のない料金・人数・順位・合格実績を書かないこと',
  '地域名やキーワードを不自然に繰り返さないこと(キーワードスタッフィング禁止)',
  '未取得の情報を推測で補わないこと',
  'Search Consoleの数値(表示回数・クリック数・順位等)をページ本文へ書かないこと',
  'Opportunity Score等の内部評価指標をページ本文へ書かないこと',
  'HTMLやWordPressを更新しないこと(この作業はテキスト提案の作成のみ)',
];

function formatGscMetrics(gscMetrics) {
  if (!gscMetrics) return '実績データなし';
  const avgPosition = gscMetrics.avgPosition != null ? gscMetrics.avgPosition.toFixed(1) : '-';
  return `表示回数${gscMetrics.impressions ?? '-'}件、クリック数${gscMetrics.clicks ?? '-'}件、平均順位${avgPosition}位`;
}

function renderContextSection({ targetUrl, targetPageName, targetKeyword, targetArea, gapType, reason, gscMetrics }) {
  const reasonText = Array.isArray(reason) ? reason.join(' / ') : reason || '-';
  return [
    `# 対象URL\n${targetUrl || '(未設定)'}`,
    `# 対象ページ名\n${targetPageName || '(未設定)'}`,
    `# 対象キーワード\n${targetKeyword}`,
    `# 対象地域\n${targetArea || '(未設定)'}`,
    `# 現在の状況\n- gap_type: ${gapType || '-'}\n- 判定理由: ${reasonText}\n- 検索実績: ${formatGscMetrics(gscMetrics)}`,
  ].join('\n\n');
}

function renderSafetyRulesSection() {
  return `# 安全ルール(必ず守ること)\n${SAFETY_RULES.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}`;
}

function buildContextAvailablePrompt(input) {
  const { pageContext } = input;
  const pageSection = [
    '# 現在のページ内容',
    `タイトル: ${pageContext.title || '(なし)'}`,
    `見出し: ${(pageContext.headings || []).join(' / ') || '(なし)'}`,
    `本文抜粋: ${pageContext.bodyExcerpt || '(なし)'}`,
  ].join('\n');

  const rulesSection = [
    '# 目的',
    '以下のキーワードに対する校舎ページの改善案を提案してください。',
  ].join('\n');

  const improvementRules = [
    '# 改善ルール',
    '- 現在のページ内容と重複しない改善案にすること',
    '- 本文中のどこに追加すべきか(追加位置)を提案すること',
    '- 追加する文章案は300文字以内にすること',
  ].join('\n');

  const outputFormat = [
    '# 出力形式(JSON)',
    '{',
    '  "can_generate": true,',
    '  "summary": "",',
    '  "suggested_location": "",',
    '  "generated_text": "",',
    '  "change_reason": "",',
    '  "search_intent_alignment": "",',
    '  "warnings": []',
    '}',
  ].join('\n');

  return [
    'あなたは学習塾専門のSEOディレクターです。',
    rulesSection,
    renderContextSection(input),
    pageSection,
    improvementRules,
    renderSafetyRulesSection(),
    outputFormat,
  ].join('\n\n');
}

function buildContextMissingPrompt(input) {
  const purpose = [
    '# 目的',
    '以下のキーワードに対する校舎ページの改善を検討していますが、現在のページ内容がまだ取得できていません。',
  ].join('\n');

  const instructions = [
    '# 指示',
    '- この時点で完成した提案文章を生成しないこと(can_generate=falseとすること)',
    '- 改善提案を行うために不足している情報を列挙すること',
    '- ページ内容取得後に確認すべき点を整理すること',
  ].join('\n');

  const outputFormat = [
    '# 出力形式(JSON)',
    '{',
    '  "can_generate": false,',
    '  "missing_context": [],',
    '  "required_checks": [],',
    '  "warnings": []',
    '}',
  ].join('\n');

  return [
    'あなたは学習塾専門のSEOディレクターです。',
    purpose,
    renderContextSection(input),
    '# 現在のページ内容\n(未取得)',
    instructions,
    renderSafetyRulesSection(),
    outputFormat,
  ].join('\n\n');
}

// input.pageContext.status === 'fetched' の場合のみcontext_availableモードとする。
// 'not_fetched'含め、それ以外のstatusは全てcontext_missingモード扱いにする
// (未取得を安全側=文章生成させない側に倒す)。
function buildPrompt(input) {
  const mode = input.pageContext && input.pageContext.status === 'fetched' ? 'context_available' : 'context_missing';
  const prompt = mode === 'context_available' ? buildContextAvailablePrompt(input) : buildContextMissingPrompt(input);
  return { prompt, mode, promptVersion: PROMPT_VERSION };
}

module.exports = { buildPrompt, PROMPT_VERSION, SAFETY_RULES };
