import { createHash } from 'node:crypto';
import { SOURCE_TIERS } from './recruitment-event.mjs';

const STATUSES = new Set(['ACTIVE', 'CLOSED', 'UNKNOWN']);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function stableOpeningId(input = {}) {
  if (input.id) return String(input.id);
  const companyId = String(input.companyId || '');
  const eventIdentity = input.recruitmentEventId
    ? `event:${String(input.recruitmentEventId)}`
    : null;
  const identity = input.sourceJobId
    ? [
      companyId,
      eventIdentity,
      `source:${String(input.sourceJobId)}`,
    ].filter(Boolean).join('|')
    : [
      companyId,
      eventIdentity,
      cleanUrl(input.jobDetailUrl) || cleanUrl(input.sourceUrl) || '',
      clean(input.title).toLowerCase(),
      clean(input.locations?.[0]).toLowerCase(),
    ].filter((value) => value != null).join('|');
  return createHash('sha256').update(identity).digest('hex');
}

export function createJobOpening(input = {}, {
  now = new Date().toISOString(),
} = {}) {
  const title = clean(input.title);
  const sourceUrl = cleanUrl(input.sourceUrl);
  if (!input.companyId || !input.careerPortalId || !title || !sourceUrl) {
    throw new Error('JobOpening companyId, careerPortalId, title and sourceUrl are required');
  }
  const status = input.status || 'UNKNOWN';
  if (!STATUSES.has(status)) throw new Error('unsupported JobOpening status');
  const sourceTier = clean(input.sourceTier || 'OFFICIAL_SITE').toUpperCase();
  if (!SOURCE_TIERS.includes(sourceTier)) throw new Error('unsupported JobOpening sourceTier');
  return Object.freeze({
    id: stableOpeningId({ ...input, sourceUrl }),
    companyId: String(input.companyId),
    careerPortalId: String(input.careerPortalId),
    recruitmentEventId: input.recruitmentEventId == null
      ? null
      : String(input.recruitmentEventId),
    sourceTier,
    sourceJobId: input.sourceJobId == null ? null : String(input.sourceJobId),
    title,
    normalizedTitle: clean(input.normalizedTitle || title).toLowerCase(),
    roleFamily: clean(input.roleFamily) || 'OTHER',
    locations: Object.freeze([...(input.locations || []).map(clean).filter(Boolean)]),
    employmentType: input.employmentType ? clean(input.employmentType) : null,
    publishedAt: input.publishedAt || null,
    closesAt: input.closesAt || null,
    jobDetailUrl: cleanUrl(input.jobDetailUrl),
    applyUrl: cleanUrl(input.applyUrl),
    status,
    sourceUrl,
    firstSeenAt: input.firstSeenAt || now,
    lastSeenAt: input.lastSeenAt || now,
  });
}

export function isRecentOpening(job, {
  freshnessDays,
  now = Date.now(),
} = {}) {
  const published = Date.parse(job?.publishedAt || '');
  const days = Number(freshnessDays);
  return Number.isFinite(published)
    && Number.isFinite(days)
    && days > 0
    && published >= now - days * 86_400_000;
}
