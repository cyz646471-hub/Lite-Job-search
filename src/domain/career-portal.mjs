import { SOURCE_TIERS } from './recruitment-event.mjs';

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
export const HIRING_AVAILABILITIES = Object.freeze([
  'OPENINGS_FOUND',
  'NO_OPENINGS',
  'UNKNOWN',
]);
export const SEARCH_COVERAGES = Object.freeze(['COMPLETE', 'PARTIAL']);
export const CHANNEL_TYPES = Object.freeze([
  'WEB_PORTAL',
  'ATS',
  'WECHAT_OFFICIAL_ACCOUNT',
]);
export const FALLBACK_REASONS = Object.freeze([
  'NO_OFFICIAL_FOUND',
  'OFFICIAL_INACCESSIBLE',
  'OFFICIAL_NO_OPENINGS',
]);

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
  const atsType = String(input.atsType || '');
  const sourceTier = String(input.sourceTier || (
    atsType ? 'OFFICIAL_ATS' : 'OFFICIAL_SITE'
  )).toUpperCase();
  const confidenceScore = Math.max(0, Math.min(100, Number(input.confidenceScore) || 0));
  const officialIdentityConfirmed = input.officialIdentityConfirmed == null
    ? input.verificationStatus === 'VERIFIED'
    : input.officialIdentityConfirmed === true;
  const platformIdentityConfirmed = input.platformIdentityConfirmed === true;
  const hiringAvailability = String(input.hiringAvailability || 'UNKNOWN').toUpperCase();
  const searchCoverage = String(input.searchCoverage || 'PARTIAL').toUpperCase();
  const fallbackReason = input.fallbackReason == null
    ? null
    : String(input.fallbackReason).toUpperCase();
  const channelType = String(input.channelType || (
    sourceTier === 'OFFICIAL_SOCIAL'
      ? 'WECHAT_OFFICIAL_ACCOUNT'
      : atsType
        ? 'ATS'
        : 'WEB_PORTAL'
  )).toUpperCase();

  if (!SOURCE_TIERS.includes(sourceTier)) throw new Error('unsupported sourceTier');
  if (!CHANNEL_TYPES.includes(channelType)) throw new Error('unsupported channelType');
  if (sourceTier === 'OFFICIAL_SOCIAL' && channelType !== 'WECHAT_OFFICIAL_ACCOUNT') {
    throw new Error('OFFICIAL_SOCIAL source requires WECHAT_OFFICIAL_ACCOUNT channelType');
  }
  if (channelType === 'WECHAT_OFFICIAL_ACCOUNT' && sourceTier !== 'OFFICIAL_SOCIAL') {
    throw new Error('WECHAT_OFFICIAL_ACCOUNT channel requires OFFICIAL_SOCIAL sourceTier');
  }
  if (!HIRING_AVAILABILITIES.includes(hiringAvailability)) {
    throw new Error('unsupported hiringAvailability');
  }
  if (!SEARCH_COVERAGES.includes(searchCoverage)) throw new Error('unsupported searchCoverage');
  if (fallbackReason && !FALLBACK_REASONS.includes(fallbackReason)) {
    throw new Error('unsupported fallbackReason');
  }
  if (sourceTier === 'PLATFORM_ONLY') {
    if (input.verificationStatus === 'VERIFIED') {
      throw new Error('PLATFORM_ONLY source cannot be VERIFIED');
    }
    if (confidenceScore > 49) {
      throw new Error('PLATFORM_ONLY confidenceScore cannot exceed 49');
    }
    if (officialIdentityConfirmed) {
      throw new Error('PLATFORM_ONLY source cannot confirm official identity');
    }
    if (hiringAvailability === 'OPENINGS_FOUND' && !platformIdentityConfirmed) {
      throw new Error('PLATFORM_ONLY openings require platformIdentityConfirmed');
    }
  } else if (input.verificationStatus === 'VERIFIED' && !officialIdentityConfirmed) {
    throw new Error('VERIFIED official source requires officialIdentityConfirmed');
  }

  return Object.freeze({
    id: String(input.id),
    companyId: String(input.companyId),
    url: cleanUrl(input.url || input.canonicalUrl),
    canonicalUrl: cleanUrl(input.canonicalUrl),
    registrableDomain: String(input.registrableDomain || '').toLowerCase(),
    atsType,
    pageType: input.pageType,
    verificationStatus: input.verificationStatus,
    confidenceScore,
    sourceTier,
    channelType,
    officialAccountName: String(input.officialAccountName || '').trim() || null,
    officialAccountId: String(input.officialAccountId || '').trim() || null,
    verifiedSubject: String(input.verifiedSubject || '').trim() || null,
    officialIdentityConfirmed,
    platformIdentityConfirmed,
    hiringAvailability,
    fallbackReason,
    searchCoverage,
    supersededByPortalId: input.supersededByPortalId == null
      ? null
      : String(input.supersededByPortalId),
    recruitmentTypes: Object.freeze([
      ...new Set((input.recruitmentTypes || [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => RECRUITMENT_TYPES.has(value))),
    ]),
    evidence: Object.freeze([...(input.evidence || [])]),
    firstSeenAt: input.firstSeenAt || now,
    lastVerifiedAt: input.lastVerifiedAt || null,
    lastCheckedAt: input.lastCheckedAt || null,
  });
}
