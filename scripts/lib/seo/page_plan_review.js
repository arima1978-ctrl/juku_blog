'use strict';

// Sprint 3.5: Page Plan(seo_page_plans)の人間レビュー状態遷移を、決定的ルールのみで
// 検証する(LLM判断は行わない)。DB書き込みは一切行わない(scripts/lib/seo_db.jsの
// transitionSeoPagePlanStatus()がこの検証結果を使ってDBへ反映する)。

const ALLOWED_STATUSES = new Set(['proposed', 'reviewing', 'approved', 'rejected']);
const ALLOWED_REVIEW_SOURCES = new Set(['cli', 'api', 'dashboard', 'system']);

const ACTOR_MAX_LENGTH = 100;
const REASON_MAX_LENGTH = 1000;

// 許可する状態遷移。approvedは終端(遷移元にならない)。
// rejectedも今回は終端として扱う(rejected→proposedの明示的な再開操作はV1では未実装。
// 将来Page Plan再生成操作の一部として別途設計する)。
const ALLOWED_TRANSITIONS = {
  proposed: new Set(['reviewing', 'rejected']),
  reviewing: new Set(['approved', 'rejected', 'proposed']),
  approved: new Set(),
  rejected: new Set(),
};

// reasonを必須とする遷移(却下系、およびreviewingからproposedへの差し戻し)。
// proposed→reviewing・reviewing→approvedはreason任意。
function isReasonRequired(fromStatus, toStatus) {
  if (toStatus === 'rejected') return true;
  if (fromStatus === 'reviewing' && toStatus === 'proposed') return true;
  return false;
}

const HTML_TAG_PATTERN = /<[a-z][\s\S]*>/i;
const CODE_FENCE_PATTERN = /```/;

function checkTextSafety(value, label, errors) {
  if (HTML_TAG_PATTERN.test(value)) errors.push(`${label}にHTMLタグを含めることはできません`);
  if (CODE_FENCE_PATTERN.test(value)) errors.push(`${label}にMarkdownコードフェンスを含めることはできません`);
}

// currentStatus/nextStatus/actor/reasonから、状態遷移の可否を決定的に判定する。
// DBアクセス・LLM呼び出しは一切行わない。
function validatePagePlanTransition({ currentStatus, nextStatus, actor, reason } = {}) {
  const errors = [];
  const warnings = [];

  if (!ALLOWED_STATUSES.has(currentStatus)) errors.push(`currentStatusが不正です: ${currentStatus}`);
  if (!ALLOWED_STATUSES.has(nextStatus)) errors.push(`nextStatusが不正です: ${nextStatus}`);

  if (errors.length > 0) {
    return { valid: false, errors, warnings, transition: { from: currentStatus, to: nextStatus } };
  }

  if (currentStatus === nextStatus) {
    errors.push('currentStatusとnextStatusが同じ状態遷移はできません');
  } else if (!ALLOWED_TRANSITIONS[currentStatus].has(nextStatus)) {
    errors.push(`許可されていない状態遷移です: ${currentStatus} → ${nextStatus}`);
  }

  if (!actor || typeof actor !== 'string' || actor.trim().length === 0) {
    errors.push('actorは必須です');
  } else {
    if (actor.length > ACTOR_MAX_LENGTH) errors.push(`actorは${ACTOR_MAX_LENGTH}文字以内である必要があります`);
    checkTextSafety(actor, 'actor', errors);
  }

  const reasonRequired = ALLOWED_STATUSES.has(currentStatus) && ALLOWED_STATUSES.has(nextStatus) && isReasonRequired(currentStatus, nextStatus);
  const hasReason = typeof reason === 'string' && reason.trim().length > 0;

  if (reasonRequired && !hasReason) {
    errors.push(`この遷移(${currentStatus} → ${nextStatus})にはreasonが必須です`);
  }
  if (typeof reason === 'string' && reason.length > 0) {
    if (reason.length > REASON_MAX_LENGTH) errors.push(`reasonは${REASON_MAX_LENGTH}文字以内である必要があります`);
    checkTextSafety(reason, 'reason', errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    transition: { from: currentStatus, to: nextStatus },
  };
}

module.exports = {
  validatePagePlanTransition,
  isReasonRequired,
  ALLOWED_STATUSES,
  ALLOWED_TRANSITIONS,
  ALLOWED_REVIEW_SOURCES,
  ACTOR_MAX_LENGTH,
  REASON_MAX_LENGTH,
};
