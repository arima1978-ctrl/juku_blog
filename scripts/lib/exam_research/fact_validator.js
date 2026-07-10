'use strict';

// 記事末尾の参考情報や本文で使われた事実(exam_facts_used)を、決定的なルールで
// 検証する(LLM不使用)。石橋(verifier-local)はこの結果を判定材料として読む。
//
// 検証結果は passed / warning / blocked のいずれか。blocked が1件でもあれば
// WordPress自動投稿をブロックする(api-server.js側)。

const HEDGE_PHRASES = ['とされ', '目安', '参考', 'ではありません', '傾向があります', 'ようです', '可能性があります'];

function isAllowedDomainForFact(sourceUrl, registeredSources) {
  if (!sourceUrl) return false;
  try {
    const host = new URL(sourceUrl).hostname;
    return registeredSources.some((s) => {
      try {
        const baseHost = new URL(s.base_url).hostname;
        return host === baseHost || host.endsWith(`.${baseHost}`);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function findSourceTier(sourceUrl, registeredSources) {
  if (!sourceUrl) return null;
  try {
    const host = new URL(sourceUrl).hostname;
    const match = registeredSources.find((s) => {
      try {
        const baseHost = new URL(s.base_url).hostname;
        return host === baseHost || host.endsWith(`.${baseHost}`);
      } catch {
        return false;
      }
    });
    return match ? match.tier : null;
  } catch {
    return null;
  }
}

// facts: exam_facts_used(檜山のdraft frontmatterに転記された智谷/構造化エージェント出力)
// articleTargetYear: draftのexam_target_year(記事が対象とする年度、西暦整数)
// registeredSources: config/aichi_exam_sources.yamlのsources配列
// bodyText: 記事本文(Tier2/3の数値が断定表現になっていないかの簡易チェック用)
function validateExamFacts({ facts, articleTargetYear, registeredSources, bodyText }) {
  const errors = [];
  const warnings = [];

  for (const fact of facts || []) {
    // YEAR_MISMATCH: 比較目的で明示されたcomparison_yearは除外する
    if (
      fact.target_year != null &&
      articleTargetYear != null &&
      fact.target_year !== articleTargetYear &&
      !fact.comparison_year
    ) {
      errors.push({
        code: 'YEAR_MISMATCH',
        message: `fact_id=${fact.fact_id}: 記事対象年度(${articleTargetYear})と参照データの年度(${fact.target_year})が一致しません`,
      });
    }

    // MISSING_SOURCE_FOR_NUMBER: 数値を伴う事実に出典URLが無い
    if (fact.value_number != null && !fact.source_url) {
      errors.push({ code: 'MISSING_SOURCE_FOR_NUMBER', message: `fact_id=${fact.fact_id}: 数値に出典URLがありません` });
    }

    // INVALID_SOURCE_DOMAIN: 出典URLが登録済みソースのドメインに一致しない
    if (fact.source_url && !isAllowedDomainForFact(fact.source_url, registeredSources)) {
      errors.push({ code: 'INVALID_SOURCE_DOMAIN', message: `fact_id=${fact.fact_id}: 出典URLが登録ソースのドメインと一致しません: ${fact.source_url}` });
    }

    // UNVERIFIED_OFFICIAL_NUMBER: Tier2/3の情報をis_official=trueとして扱っていないか
    const tier = fact.source_tier != null ? fact.source_tier : findSourceTier(fact.source_url, registeredSources);
    if (fact.is_official && tier != null && tier !== 1) {
      errors.push({ code: 'UNVERIFIED_OFFICIAL_NUMBER', message: `fact_id=${fact.fact_id}: Tier${tier}の情報をis_official=trueとして扱っています` });
    }

    // Tier2/3の数値が本文中でヘッジ表現なしに断定されていないか(簡易ヒューリスティック、warning止まり)
    if (tier != null && tier !== 1 && fact.value && bodyText && bodyText.includes(String(fact.value))) {
      const idx = bodyText.indexOf(String(fact.value));
      const surrounding = bodyText.slice(Math.max(0, idx - 40), idx + 40);
      const hedged = HEDGE_PHRASES.some((p) => surrounding.includes(p));
      if (!hedged) {
        warnings.push({ code: 'TIER_23_STATED_AS_OFFICIAL_LIKE', message: `fact_id=${fact.fact_id}: Tier${tier}の数値「${fact.value}」に参考情報であることを示す表現が近傍に見当たりません` });
      }
    }
  }

  // CONFLICTING_FACTS: 同じfact_type+labelで異なる値・同一対象年度のものが無いか
  const byKey = new Map();
  for (const fact of facts || []) {
    const key = `${fact.fact_type}::${fact.label}::${fact.target_year}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(fact);
  }
  for (const [key, group] of byKey) {
    const distinctValues = new Set(group.map((f) => f.value));
    if (distinctValues.size > 1) {
      errors.push({ code: 'CONFLICTING_FACTS', message: `${key}: 異なる値が併存しています(${[...distinctValues].join(' / ')})` });
    }
  }

  const status = errors.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'passed';
  return { status, errors, warnings };
}

module.exports = { validateExamFacts, isAllowedDomainForFact, findSourceTier };
