'use strict';

// 愛知県高校入試 情報ソース参照機能: draftのfrontmatterにある exam_facts_used
// (智谷が data/exam_research/YYYY-MM-DD.facts.json から選別・記録したもの)を、
// 年度整合性・出典有効性・Tier別断定チェック等の決定的ルールで検証し、
// exam_fact_check として frontmatterに結果を保存する(石橋が判定材料として読む)。
// check_similarity.js/check_citations.jsと同型のパターン。
//
// exam_facts_used が無い(=愛知県高校入試と無関係の通常記事)場合は
// status: 'not_applicable' を書き込むのみで、検証は行わない。
//
// 使い方: node scripts/check_exam_facts.js data/drafts/2026-07-10-slug.md

const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { validateExamFacts } = require('./lib/exam_research/fact_validator');
const { loadExamSourcesConfig, ROOT } = require('./lib/config');
const { getBranchContext } = require('./lib/branch_context');

function main() {
  const relOrAbs = process.argv[2];
  if (!relOrAbs) {
    console.error('使い方: node scripts/check_exam_facts.js <draftファイルパス>');
    process.exit(1);
  }
  const filePath = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data: fm, content } = matter(raw);

  const facts = fm.exam_facts_used || [];
  if (facts.length === 0) {
    const result = { status: 'not_applicable', errors: [], warnings: [] };
    const updated = matter.stringify(content, { ...fm, exam_fact_check: result });
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log('[check_exam_facts] status=not_applicable(exam_facts_used無し)');
    return;
  }

  const ctx = getBranchContext();
  const sourcesConfig = loadExamSourcesConfig(ctx.isLegacy ? undefined : ctx.branchId);
  const result = validateExamFacts({
    facts,
    articleTargetYear: fm.exam_target_year || null,
    registeredSources: sourcesConfig.sources || [],
    bodyText: content,
  });

  const updated = matter.stringify(content, { ...fm, exam_fact_check: result });
  fs.writeFileSync(filePath, updated, 'utf8');

  console.log(`[check_exam_facts] status=${result.status} errors=${result.errors.length} warnings=${result.warnings.length}`);
  if (result.status === 'blocked') {
    console.log(`[check_exam_facts] ブロック理由: ${JSON.stringify(result.errors)}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
