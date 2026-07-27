export const JOB_QUALITY_GRADES = Object.freeze(['A', 'B', 'C']);
export const JOB_PUBLICATION_STATUSES = Object.freeze([
  'PUBLISHED',
  'REVIEW_REQUIRED',
  'CANDIDATE',
  'REJECTED',
  'EXPIRED',
]);

function hasLocation(opening = {}, event = {}) {
  return [...(opening.locations || []), ...(event.locations || [])]
    .some((value) => String(value || '').trim());
}

function hasApplicationEntry(opening = {}, event = {}) {
  return Boolean(opening.applyUrl || opening.jobDetailUrl || event.directoryUrl);
}

export function evaluateJobPublication({
  opening = {},
  portal = {},
  event = {},
} = {}) {
  const reasons = [];
  const sourceTier = opening.sourceTier || portal.sourceTier || event.sourceTier;

  if (sourceTier === 'PLATFORM_ONLY') {
    return Object.freeze({
      qualityGrade: 'C',
      publicationStatus: 'REVIEW_REQUIRED',
      reasons: Object.freeze(['PLATFORM_ONLY_SOURCE']),
      applicationVerifiedAt: portal.lastVerifiedAt || null,
    });
  }

  if (opening.status === 'CLOSED' || event.status === 'CLOSED') {
    return Object.freeze({
      qualityGrade: 'C',
      publicationStatus: 'EXPIRED',
      reasons: Object.freeze(['JOB_OR_EVENT_CLOSED']),
      applicationVerifiedAt: portal.lastVerifiedAt || null,
    });
  }

  if (!['OFFICIAL_SITE', 'OFFICIAL_ATS'].includes(sourceTier)) {
    reasons.push('SOURCE_NOT_TRUSTED');
  }
  if (portal.verificationStatus !== 'VERIFIED'
    || portal.officialIdentityConfirmed !== true) {
    reasons.push('OFFICIAL_IDENTITY_NOT_VERIFIED');
  }
  if (opening.status !== 'ACTIVE') reasons.push('JOB_NOT_CONFIRMED_ACTIVE');
  if (!event.id) reasons.push('RECRUITMENT_EVENT_MISSING');
  else if (event.status !== 'OPEN') reasons.push('EVENT_NOT_CONFIRMED_OPEN');
  if (!hasApplicationEntry(opening, event)) reasons.push('APPLICATION_ENTRY_MISSING');
  if (!hasLocation(opening, event)) reasons.push('LOCATION_MISSING');
  if (!portal.lastVerifiedAt) reasons.push('VERIFICATION_TIMESTAMP_MISSING');

  const trustedSource = ['OFFICIAL_SITE', 'OFFICIAL_ATS'].includes(sourceTier)
    && portal.verificationStatus === 'VERIFIED'
    && portal.officialIdentityConfirmed === true;
  const publishable = trustedSource && reasons.length === 0;

  return Object.freeze({
    qualityGrade: publishable ? 'A' : trustedSource ? 'B' : 'C',
    publicationStatus: publishable ? 'PUBLISHED' : trustedSource ? 'REVIEW_REQUIRED' : 'CANDIDATE',
    reasons: Object.freeze(reasons),
    applicationVerifiedAt: portal.lastVerifiedAt || null,
  });
}
