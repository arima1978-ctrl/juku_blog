'use strict';

// 競合サイトの取得(sitemap優先、無ければstart_urlからの内部リンク探索)。
// features.competitor_keyword_analysis.enabled と .crawl_enabled が両方trueの場合のみ動作する。
// 1競合の失敗は他競合の処理を止めない。取得本文はDBに入れずdata/seo/pages/配下に保存する
// (DB肥大化を避けるため。DBにはメタデータ・見出し・ハッシュのみ保持)。
//
// 使い方:
//   node scripts/seo_competitor_crawl.js [--dry-run] [--competitor=<id>]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadJukuConfig, loadSeoCompetitorsConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const { fetchExternalUrl } = require('./lib/seo/fetcher');
const { extractFromHtml } = require('./lib/seo/html_extract');
const { resolveCanonicalUrl } = require('./lib/seo/url_normalize');
const { parseSitemapXml } = require('./lib/seo/sitemap_parser');
const { buildCrawlQueue } = require('./lib/seo/crawl_frontier');
const { logError } = require('./log_error');

const PAGES_DIR = path.join(ROOT, 'data', 'seo', 'pages');

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const competitorArg = argv.find((a) => a.startsWith('--competitor='));
  const competitorId = competitorArg ? competitorArg.split('=')[1] : null;
  return { dryRun, competitorId };
}

function contentHashOf(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

function savePageBody(hash, bodyText) {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  fs.writeFileSync(path.join(PAGES_DIR, `${hash}.txt`), bodyText, 'utf8');
}

async function fetchSitemapLocs(sitemapUrl, fetchOptions) {
  const result = await fetchExternalUrl(sitemapUrl, fetchOptions);
  if (!result.ok) return [];
  const parsed = parseSitemapXml(result.body.toString('utf8'));
  if (parsed.type === 'urlset') return parsed.locs;
  if (parsed.type === 'index') {
    const nested = [];
    for (const loc of parsed.locs) {
      // eslint-disable-next-line no-await-in-loop
      const sub = await fetchSitemapLocs(loc, fetchOptions);
      nested.push(...sub);
    }
    return nested;
  }
  return [];
}

async function crawlCompetitor(competitor, seoConfig, dryRun) {
  const fetchOptions = {
    allowedBaseUrls: [`https://${competitor.domain}/`],
    userAgent: seoConfig.user_agent,
    timeoutMs: seoConfig.request_timeout_ms,
    intervalMs: seoConfig.request_interval_ms,
    maxRetries: seoConfig.max_retries,
  };
  const maxPages = competitor.max_pages || seoConfig.max_pages_per_site;

  const stats = { pages_fetched: 0, pages_new: 0, pages_updated: 0, pages_unchanged: 0, pages_skipped: 0, robots_disallowed_count: 0, error_count: 0 };

  let sitemapLocs = [];
  if (competitor.sitemap_url) {
    sitemapLocs = await fetchSitemapLocs(competitor.sitemap_url, fetchOptions);
  } else if (competitor.start_url) {
    sitemapLocs = await fetchSitemapLocs(new URL('/sitemap.xml', `https://${competitor.domain}/`).toString(), fetchOptions);
  }

  let discoveredLinks = [];
  if (sitemapLocs.length === 0 && competitor.start_url) {
    const startResult = await fetchExternalUrl(competitor.start_url, fetchOptions);
    if (startResult.ok && startResult.contentType.includes('html')) {
      const extracted = extractFromHtml(startResult.body.toString('utf8'), competitor.start_url);
      discoveredLinks = extracted.links;
    }
  }

  const queue = buildCrawlQueue({
    sitemapLocs,
    startUrl: competitor.start_url,
    discoveredLinks,
    domain: competitor.domain,
    maxPages,
  });

  const nowIso = new Date().toISOString();

  for (const url of queue) {
    // eslint-disable-next-line no-await-in-loop
    const result = await fetchExternalUrl(url, fetchOptions);
    stats.pages_fetched += 1;

    if (!result.ok) {
      if (result.errorCode === 'ROBOTS_DISALLOWED') stats.robots_disallowed_count += 1;
      else stats.error_count += 1;
      continue;
    }
    if (!result.contentType.includes('html')) {
      stats.pages_skipped += 1;
      continue;
    }

    const html = result.body.toString('utf8');
    const extracted = extractFromHtml(html, url);
    const canonicalUrl = resolveCanonicalUrl(result.finalUrl || url, extracted.canonicalUrl);
    const hash = contentHashOf(extracted.bodyText);

    if (dryRun) {
      console.log(`[seo_competitor_crawl][dry-run] ${competitor.id}: ${canonicalUrl} title="${extracted.title}"`);
      continue;
    }

    const pageResult = seoDb.upsertCompetitorPage(
      {
        competitor_id: competitor.id,
        url,
        canonical_url: canonicalUrl,
        http_status: result.statusCode,
        content_type: result.contentType,
        title: extracted.title,
        meta_description: extracted.metaDescription,
        fetched_at: nowIso,
        content_hash: hash,
        robots_allowed: true,
      },
      nowIso
    );

    if (pageResult.isNew) stats.pages_new += 1;
    else if (pageResult.wasUnchanged) stats.pages_unchanged += 1;
    else stats.pages_updated += 1;

    if (pageResult.isNew || !pageResult.wasUnchanged) {
      savePageBody(hash, extracted.bodyText);
      seoDb.replacePageHeadings(pageResult.id, extracted.headings, nowIso);
    }
  }

  return stats;
}

async function main() {
  const { dryRun, competitorId } = parseArgs(process.argv.slice(2));
  const config = loadJukuConfig();
  const feature = config.features && config.features.competitor_keyword_analysis;

  if (!feature || !feature.enabled || !feature.crawl_enabled) {
    console.log('[seo_competitor_crawl] competitor_keyword_analysis.enabled または crawl_enabled が false のため無処理で終了します');
    process.exit(0);
  }

  const seoConfig = config.seo.competitor_analysis;
  const competitorsConfig = loadSeoCompetitorsConfig();
  const nowIso = new Date().toISOString();

  const targets = (competitorsConfig.competitors || [])
    .filter((c) => c.crawl_enabled !== false)
    .filter((c) => !competitorId || c.id === competitorId);

  if (targets.length === 0) {
    console.log('[seo_competitor_crawl] 対象の競合が登録されていません(config/seo_competitors.yaml)');
    process.exit(0);
  }

  if (!dryRun) {
    targets.forEach((c) => seoDb.upsertCompetitor(c, nowIso));
  }

  const summary = [];
  for (const competitor of targets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const stats = await crawlCompetitor(competitor, seoConfig, dryRun);
      if (!dryRun) seoDb.recordCompetitorCrawlSuccess(competitor.id, new Date().toISOString());
      summary.push({ competitor: competitor.id, ...stats });
      console.log(`[seo_competitor_crawl] ${competitor.id}: ${JSON.stringify(stats)}`);
    } catch (err) {
      if (!dryRun) seoDb.recordCompetitorCrawlError(competitor.id, new Date().toISOString(), err.message);
      logError('seo_competitor_crawl', `${competitor.id}: ${err.message}`);
      console.error(`[seo_competitor_crawl] ${competitor.id} で失敗しましたが他の競合の処理を継続します: ${err.message}`);
    }
  }

  console.log(`[seo_competitor_crawl] 完了(dry-run=${dryRun}): ${JSON.stringify(summary)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_competitor_crawl] 予期しないエラー: ${err.message}`);
    logError('seo_competitor_crawl', err.message);
    process.exit(1);
  });
}

module.exports = { main, crawlCompetitor };
