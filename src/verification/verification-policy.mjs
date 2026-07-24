import { EVIDENCE_RULES } from './evidence-codes.mjs';

function normalizeEvidence(evidence) {
  const byCode = new Map();
  for (const item of evidence || []) {
    const code = String(item?.code || '');
    const rule = EVIDENCE_RULES[code];
    if (!rule) throw new Error(`unknown verification evidence: ${code || '(empty)'}`);
    if (!byCode.has(code)) {
      byCode.set(code, Object.freeze({
        ...item,
        code,
        ...rule,
      }));
    }
  }
  return [...byCode.values()];
}

export function applyVerificationPolicy({
  pageType = 'UNKNOWN',
  evidence = [],
} = {}) {
  const normalized = normalizeEvidence(evidence);
  const hardRejectReasons = normalized
    .filter((item) => item.hardReject === true)
    .map((item) => item.code);
  const blocked = normalized.some((item) => item.code === 'blocked_page');
  const identityAnchor = normalized.some(
    (item) => item.direction === 'POSITIVE' && item.identityAnchor === true,
  );
  const rawScore = normalized.reduce((sum, item) => sum + item.weight, 0);
  const confidenceScore = Math.max(0, Math.min(100, rawScore));

  let verificationStatus = 'REVIEW';
  if (hardRejectReasons.length) verificationStatus = 'REJECTED';
  else if (blocked) verificationStatus = 'BLOCKED';
  else if (confidenceScore >= 75 && identityAnchor && pageType !== 'UNKNOWN') {
    verificationStatus = 'VERIFIED';
  } else if (confidenceScore < 45) {
    verificationStatus = 'REJECTED';
  }

  return Object.freeze({
    verificationStatus,
    confidenceScore,
    identityAnchor,
    hardRejectReasons: Object.freeze(hardRejectReasons),
    evidence: Object.freeze(normalized),
  });
}
