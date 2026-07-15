'use strict';

// Sprint 3.8: 検索ボリューム(search_demand)と想定順位から、流入増加予測(clicks)・
// 問い合わせ増加予測(CV)を算出する決定的処理。DB書き込み・LLM呼び出しは一切行わない。
// 既存のopportunity_score.js(加算式スコア)とは完全に別軸の指標であり、両者を混同しない。

// 想定CTR(順位帯ごと)。31位以降・未ランク(null)は0。
const CTR_CURVE = [
  { maxPosition: 3, ctr: 0.2 },
  { maxPosition: 5, ctr: 0.1 },
  { maxPosition: 10, ctr: 0.03 },
  { maxPosition: 20, ctr: 0.01 },
  { maxPosition: 30, ctr: 0.005 },
];

// task_type別のデフォルト目標順位(解決策①: 順位押し上げロジックのベースライン)。
// 未登録のtask_type(monitor/excludeなど)は目標順位なし(=Impactは常に0)。
const DEFAULT_TARGET_POSITION_BY_TASK_TYPE = {
  improve_school_page: 5,
  add_faq: 5,
  add_internal_links: 5,
  improve_existing_article: 6,
  create_article: 8,
};

const CVR_SCHOOL_PAGE = 0.015;
const CVR_DEFAULT = 0.001;

// position: 1始まりの掲載順位。nullは未ランク(CTR=0)。
function estimateCtr(position) {
  if (position == null) return 0;
  const band = CTR_CURVE.find((b) => position <= b.maxPosition);
  return band ? band.ctr : 0;
}

// 解決策①: 順位押し上げロジック。現在順位が既にデフォルト目標順位以下(=同順位か
// それより上位)であれば、現状維持ではなく「さらに1つ上」を目指す目標へ引き上げる。
// これにより、既に上位にいるキーワードのImpactが常にゼロになってしまうのを防ぐ。
function resolveTargetPosition(taskType, currentPosition) {
  const defaultTarget = DEFAULT_TARGET_POSITION_BY_TASK_TYPE[taskType] ?? null;
  if (defaultTarget == null) return null;
  if (currentPosition != null && currentPosition <= defaultTarget) {
    return Math.max(1, currentPosition - 1);
  }
  return defaultTarget;
}

// targetPageType: 'school_page'ならCVR高め、それ以外(null/ブログ等)は低め。
function resolveCvr(targetPageType) {
  return targetPageType === 'school_page' ? CVR_SCHOOL_PAGE : CVR_DEFAULT;
}

// searchDemand: seo_keyword_candidates.search_demand相当(月間検索数、null可)。
// currentPosition: own_avg_position相当(null=未ランク)。
// taskType: task_type(目標順位の決定に使用)。
// targetPageType: 'school_page'またはnull/その他(CVR決定に使用)。
// 戻り値: searchDemandがnullの場合、全項目nullを返す(0ではなく「算出不能」を明示する)。
function computeExpectedImpact({ searchDemand, currentPosition, taskType, targetPageType } = {}) {
  if (searchDemand == null) {
    return {
      expectedImpactClicks: null,
      expectedImpactCv: null,
      targetPosition: null,
      ctrBefore: null,
      ctrAfter: null,
      cvr: null,
    };
  }

  const targetPosition = resolveTargetPosition(taskType, currentPosition);
  const ctrBefore = estimateCtr(currentPosition);
  const ctrAfter = estimateCtr(targetPosition);
  const trafficBefore = searchDemand * ctrBefore;
  const trafficAfter = searchDemand * ctrAfter;
  const expectedImpactClicks = Math.max(0, trafficAfter - trafficBefore);
  const cvr = resolveCvr(targetPageType);
  const expectedImpactCv = expectedImpactClicks * cvr;

  return { expectedImpactClicks, expectedImpactCv, targetPosition, ctrBefore, ctrAfter, cvr };
}

module.exports = {
  computeExpectedImpact,
  estimateCtr,
  resolveTargetPosition,
  resolveCvr,
  CTR_CURVE,
  DEFAULT_TARGET_POSITION_BY_TASK_TYPE,
  CVR_SCHOOL_PAGE,
  CVR_DEFAULT,
};
