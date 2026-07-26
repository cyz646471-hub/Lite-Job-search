import { createHash } from 'node:crypto';

export const RECRUITMENT_TYPES = Object.freeze([
  'CAMPUS_FULL_TIME',
  'CAMPUS_INTERNSHIP',
  'DAILY_INTERNSHIP',
  'EXPERIENCED',
  'SPECIAL_PROGRAM',
]);

export const RECRUITMENT_EVENT_STATUSES = Object.freeze([
  'OPEN',
  'CLOSED',
  'UNKNOWN',
]);

export const SOURCE_TIERS = Object.freeze([
  'OFFICIAL_SITE',
  'OFFICIAL_ATS',
  'PLATFORM_ONLY',
]);

export const PUBLICATION_CLASSES = Object.freeze([
  'EXPLICIT',
  'INFERRED',
  'UNKNOWN',
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanUrl(value, fieldName = 'directoryUrl') {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    url.hash = '';
    return url.href;
  } catch {
    throw new Error(`invalid RecruitmentEvent ${fieldName}: ${value}`);
  }
}

function uniqueClean(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

export function stableRecruitmentEventId(input = {}) {
  if (input.id) return String(input.id);
  const companyId = clean(input.companyId);
  const recruitmentType = clean(input.recruitmentType).toUpperCase();
  const cohort = clean(input.cohort).toLowerCase();
  const directoryUrl = cleanUrl(input.directoryUrl);
  const identity = [companyId, recruitmentType, cohort, directoryUrl].join('|');
  return createHash('sha256').update(identity).digest('hex');
}

export function createRecruitmentEvent(input = {}, {
  now = new Date().toISOString(),
} = {}) {
  const companyId = clean(input.companyId);
  const careerPortalId = clean(input.careerPortalId);
  const recruitmentType = clean(input.recruitmentType).toUpperCase();
  const sourceTier = clean(input.sourceTier || 'OFFICIAL_SITE').toUpperCase();
  const status = clean(input.status || 'UNKNOWN').toUpperCase();
  const publicationClass = clean(input.publicationClass || 'UNKNOWN').toUpperCase();
  const directoryUrl = cleanUrl(input.directoryUrl);

  if (!companyId || !careerPortalId) {
    throw new Error('RecruitmentEvent companyId and careerPortalId are required');
  }
  if (!RECRUITMENT_TYPES.includes(recruitmentType)) {
    throw new Error(`unsupported RecruitmentEvent recruitmentType: ${input.recruitmentType}`);
  }
  if (!SOURCE_TIERS.includes(sourceTier)) {
    throw new Error(`unsupported RecruitmentEvent sourceTier: ${input.sourceTier}`);
  }
  if (!RECRUITMENT_EVENT_STATUSES.includes(status)) {
    throw new Error(`unsupported RecruitmentEvent status: ${input.status}`);
  }
  if (!PUBLICATION_CLASSES.includes(publicationClass)) {
    throw new Error(`unsupported RecruitmentEvent publicationClass: ${input.publicationClass}`);
  }

  return Object.freeze({
    id: stableRecruitmentEventId({
      ...input,
      companyId,
      recruitmentType,
      directoryUrl,
    }),
    companyId,
    careerPortalId,
    sourceTier,
    recruitmentType,
    cohort: clean(input.cohort) || null,
    campaignName: clean(input.campaignName) || null,
    status,
    startAt: input.startAt || null,
    closesAt: input.closesAt || null,
    directoryUrl,
    locations: Object.freeze(uniqueClean(input.locations)),
    publicationClass,
    firstSeenAt: input.firstSeenAt || now,
    lastSeenAt: input.lastSeenAt || now,
    lastVerifiedAt: input.lastVerifiedAt || null,
  });
}
