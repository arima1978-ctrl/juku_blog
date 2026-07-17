'use strict';

// 取得済み競合ページ(seo_competitor_pages)からキーワード候補を抽出し、
// seo_topics/seo_page_topicsへ保存する。未解析、または前回解析後に本文が
// 更新されたページのみを対象にする(content_hashが同じページはcrawl側で
// last_analyzed_at < fetched_atにならないためここでは再解析されない)。
//
// 複数校舎対応(Keyword Gap Lite): 辞書生成に使うarea(地域名の集合)は校舎ごとの
// target_area(branchesテーブル)を反映する必要があるため、branchIdは必須引数。
// 引数なし実行時はscripts/lib/branches_db.jsの全校舎を1校舎ずつ処理する(main()参照)。
//
// 使い方:
//   node scripts/seo_page_analyze.js [--dry-run]        # 全校舎を順に処理
//   node scripts/seo_page_analyze.js --branch <id> [--dry-run]  # 指定校舎のみ(デバッグ用)

const fs = require('node:fs');
const path = require('node:path');
const { loadJukuConfig } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const branchesDb = require('./lib/branches_db');
const { applyBranchArea } = require('./lib/branch_area');
const { buildDictionaryEntries, extractKeywordCandidates } = require('./lib/seo/keyword_extractor');
const { buildCompoundKeywords } = require('./lib/seo/compound_keyword_builder');
const { GENERIC_EXCLUSION_TERMS } = require('./lib/seo/dictionaries');
const { ROOT } = require('./lib/config');
const { logError } = require('./log_error');

const PAGES_DIR = path.join(ROOT, 'data', 'seo', 'pages');

const CATEGORY_TO_AXIS = {
  area: 'target_area',
  school: 'target_school',
  grade: 'target_grade',
  subject: 'target_subject',
};

function readPageBody(contentHash) {
  if (!contentHash) return '';
  const filePath = path.join(PAGES_DIR, `${contentHash}.txt`);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function pickDominantZone(occurrences) {
  const zonePriority = ['title', 'h1', 'h2', 'h3', 'meta_description', 'body'];
  let best = null;
  for (const zone of zonePriority) {
    if (occurrences[zone] && (!best || occurrences[zone] > occurrences[best])) best = zone;
  }
  return best || 'body';
}

function buildExclusionTerms() {
  const competitorNames = seoDb.listCompetitors().map((c) => c.name);
  return [...GENERIC_EXCLUSION_TERMS, ...competitorNames];
}

// コア処理(テスト容易性・API層からの呼び出しのため、process.exitを含まない形で分離)。
// branchIdは必須(applyBranchAreaが不正値なら即throwする)。その校舎の競合
// (seo_competitors.branch_id)が保有するページのみを解析対象にし、辞書生成にも
// その校舎のtarget_areaを反映したconfigを使う(校舎ごとに地域辞書が正しく切り替わる)。
async function resolvePageAnalyze({ dryRun = false, branchId, seoDbImpl = seoDb, branchesDbImpl = branchesDb } = {}) {
  const sharedConfig = loadJukuConfig();
  const feature = sharedConfig.features && sharedConfig.features.competitor_keyword_analysis;

  if (!feature || !feature.enabled) {
    return { ok: false, reason: 'feature_disabled', stats: null };
  }

  const { config, branch } = applyBranchArea(sharedConfig, branchId, branchesDbImpl);
  console.log(`[seo_page_analyze] 辞書エリア: ${config.area.city}(${branch.name})`);

  const weights = config.seo.competitor_analysis.extraction_weights;
  const dictionaryEntries = buildDictionaryEntries(config);
  const exclusionTerms = buildExclusionTerms();

  const pages = seoDbImpl.listPagesNeedingAnalysis(branchId);
  if (pages.length === 0) {
    return { ok: true, reason: 'no_pages', stats: null };
  }

  const nowIso = new Date().toISOString();
  const saveBranchId = branch.id;
  let topicsExtracted = 0;
  let compoundsExtracted = 0;

  for (const page of pages) {
    const bodyText = readPageBody(page.content_hash);
    const headings = seoDbImpl.listPageHeadings(page.id);
    const pageForExtraction = {
      title: page.title || '',
      metaDescription: page.meta_description || '',
      headings,
      bodyText,
    };

    let candidates = [];
    try {
      candidates = extractKeywordCandidates(pageForExtraction, dictionaryEntries, weights, exclusionTerms);
    } catch (err) {
      logError('seo_page_analyze', `page_id=${page.id}: ${err.message}`);
      continue;
    }

    const compounds = buildCompoundKeywords(candidates);

    if (dryRun) {
      console.log(`[seo_page_analyze][dry-run] page_id=${page.id} candidates=${candidates.length} compounds=${compounds.length}`);
      continue;
    }

    for (const candidate of candidates) {
      const axisKey = CATEGORY_TO_AXIS[candidate.category] || null;
      const topicId = seoDbImpl.upsertTopic(
        {
          raw_keyword: candidate.rawKeyword,
          normalized_keyword: candidate.normalizedKeyword,
          normalization_rule: candidate.normalizationRule,
          target_area: axisKey === 'target_area' ? candidate.normalizedKeyword : null,
          target_school: axisKey === 'target_school' ? candidate.normalizedKeyword : null,
          target_grade: axisKey === 'target_grade' ? candidate.normalizedKeyword : null,
          target_subject: axisKey === 'target_subject' ? candidate.normalizedKeyword : null,
          branch_id: saveBranchId,
        },
        nowIso
      );
      const occurrenceCount = Object.values(candidate.occurrences).reduce((a, b) => a + b, 0);
      seoDbImpl.upsertPageTopic(
        {
          page_id: page.id,
          topic_id: topicId,
          score: candidate.score,
          occurrence_count: occurrenceCount,
          extraction_method: pickDominantZone(candidate.occurrences),
          confidence: candidate.confidence,
        },
        nowIso
      );
      topicsExtracted += 1;
    }

    // 複合キーワード(「地域×塾」等)。単語単体(seo_topics)とは別テーブルに保存し、
    // seo_gap_calculate.jsはこちらを候補生成の主単位として使う。
    for (const compound of compounds) {
      const compoundKeywordId = seoDbImpl.upsertCompoundKeyword(
        {
          compound_keyword: compound.compoundKeyword,
          template_type: compound.templateType,
          keyword_components: compound.components,
          target_area: compound.components.area || null,
          target_school: compound.components.school || null,
          target_grade: compound.components.grade || null,
          target_subject: compound.components.subject || null,
          branch_id: saveBranchId,
        },
        nowIso
      );
      seoDbImpl.upsertPageCompoundKeyword(
        {
          page_id: page.id,
          compound_keyword_id: compoundKeywordId,
          cooccurrence_score: compound.cooccurrenceScore,
          same_zone: compound.sameZone,
        },
        nowIso
      );
      compoundsExtracted += 1;
    }

    seoDbImpl.markPageAnalyzed(page.id, nowIso);
  }

  const stats = { pages_analyzed: pages.length, topics_extracted: topicsExtracted, compounds_extracted: compoundsExtracted };
  console.log(
    `[seo_page_analyze] 完了: ページ${pages.length}件を解析、単語テーマ${topicsExtracted}件・複合キーワード${compoundsExtracted}件を保存しました`
  );
  return { ok: true, dryRun, stats };
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const branchArgIndex = argv.indexOf('--branch');
  const branchId = branchArgIndex !== -1 ? Number(argv[branchArgIndex + 1]) : null;
  return { dryRun, branchId };
}

// 校舎ごとに独立したconfig(area辞書)で解析するため、全校舎を1校舎ずつ順に処理する。
// --branch <id> 指定時はその校舎のみ処理する(デバッグ用)。1校舎の失敗は他校舎の処理を
// 止めず、いずれかが失敗していればexit codeを非ゼロにする(cronでの検知用)。
async function main() {
  const { dryRun, branchId } = parseArgs(process.argv.slice(2));

  const targets = branchId ? [branchesDb.getBranchById(branchId)].filter(Boolean) : branchesDb.listBranches();
  if (branchId && targets.length === 0) {
    console.error(`[seo_page_analyze] branch_id=${branchId} に該当する校舎が見つかりません`);
    process.exitCode = 1;
    return;
  }

  for (const branch of targets) {
    console.log(`=== ${branch.name} (branchId=${branch.id}, area=${branch.target_area || '未設定'}) ===`);
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await resolvePageAnalyze({ dryRun, branchId: branch.id });
      if (result.reason === 'feature_disabled') {
        console.log('[seo_page_analyze] competitor_keyword_analysis.enabled が false のため無処理で終了します');
        return; // 全校舎共通の設定のため、これ以降のループも同じ結果になる
      }
      if (result.reason === 'no_pages') {
        console.log(`[seo_page_analyze] ${branch.name}: 解析対象のページがありません`);
      }
    } catch (err) {
      console.error(`[seo_page_analyze] ${branch.name}(branchId=${branch.id})で失敗しましたが他校舎の処理を継続します: ${err.message}`);
      logError('seo_page_analyze', `branchId=${branch.id}: ${err.message}`, branch.id);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_page_analyze] 予期しないエラー: ${err.message}`);
    logError('seo_page_analyze', err.message);
    process.exit(1);
  });
}

module.exports = { main, resolvePageAnalyze };
