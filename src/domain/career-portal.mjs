export const PAGE_TYPES = Object.freeze([
  'CORPORATE_HOME',
  'CAREER_HOME',
  'CAMPAIGN',
  'JOB_LIST',
  'JOB_DETAIL',
  'APPLY',
  'UNKNOWN',
]);

export const VERIFICATION_STATUSES = Object.freeze([
  'CANDIDATE',
  'VERIFIED',
  'REVIEW',
  'REJECTED',
  'BLOCKED',
]);

const RECRUITMENT_TYPES = new Set(['campus', 'internship', 'experienced']);

function cleanUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    url.hash = '';
    return url.href;
  } catch {
    throw new Error(`invalid CareerPortal URL: ${value}`);
  }
}

export function createCareerPortal(input = {}, {
  now = new Date().toISOString(),
} = {}) {
  if (!input.id || !input.companyId || !input.canonicalUrl) {
    throw new Error('CareerPortal id, companyId and canonicalUrl are required');
  }
  if (!PAGE_TYPES.includes(input.pageType)) throw new Error('unsupported pageType');
  if (!VERIFICATION_STATUSES.includes(input.verificationStatus)) {
    throw new Error('unsupported verificationStatus');
  }
  return Object.freeze({
    id: String(input.id),
    companyId: String(input.companyId),
    url: cleanUrl(input.url || input.canonicalUrl),
    canonicalUrl: cleanUrl(input.canonicalUrl),
    registrableDomain: String(input.registrableDomain || '').toLowerCase(),
    atsType: String(input.atsType || ''),
    pageType: input.pageType,
    verificationStatus: input.verificationStatus,
    confidenceScore: Math.max(0, Math.min(100, Number(input.confidenceScore) || 0)),
    recruitmentTypes: Object.freeze([
      ...new Set((input.recruitmentTypes || [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => RECRUITMENT_TYPES.has(value))),
    ]),
    evidence: Object.freeze([...(input.evidence || [])]),
    firstSeenAt: input.firstSeenAt || now,
    lastVerifiedAt: input.lastVerifiedAt || null,
  });
}
