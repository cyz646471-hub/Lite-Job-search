import { randomUUID } from 'node:crypto';

import { canonicalRecruitmentUrl } from '../core/canonical-recruitment-url.mjs';

export const FETCH_OUTCOMES = Object.freeze([
  'SUCCESS',
  'NOT_MODIFIED',
  'NO_OPENINGS',
  'BLOCKED',
  'FAILED',
]);

export const OBSERVED_PAGE_ROLES = Object.freeze([
  'CAREER_HOME',
  'CAMPAIGN',
  'JOB_LIST',
  'JOB_DETAIL',
  'APPLY',
  'SITEMAP',
  'UNKNOWN',
]);

export function createFetchObservation(input = {}, {
  now = new Date().toISOString(),
} = {}) {
  const sourceEndpointId = String(input.sourceEndpointId || '').trim();
  const outcome = String(input.outcome || '').trim().toUpperCase();
  if (!sourceEndpointId || !FETCH_OUTCOMES.includes(outcome)) {
    throw new Error('FetchObservation sourceEndpointId and supported outcome are required');
  }
  const pageRole = String(input.pageRole || 'UNKNOWN').trim().toUpperCase();
  if (!OBSERVED_PAGE_ROLES.includes(pageRole)) {
    throw new Error('unsupported FetchObservation pageRole');
  }
  const finalUrl = canonicalRecruitmentUrl(input.finalUrl) || null;
  const jobCount = Math.max(0, Math.trunc(Number(input.jobCount) || 0));
  if (outcome === 'NO_OPENINGS' && jobCount !== 0) {
    throw new Error('NO_OPENINGS FetchObservation cannot contain jobs');
  }
  return Object.freeze({
    id: String(input.id || randomUUID()),
    sourceEndpointId,
    runId: input.runId ? String(input.runId) : null,
    fetchedAt: input.fetchedAt || now,
    outcome,
    httpStatus: input.httpStatus == null ? null : Number(input.httpStatus),
    finalUrl,
    contentHash: input.contentHash || null,
    structureHash: input.structureHash || null,
    pageRole,
    hiringAvailability: input.hiringAvailability || 'UNKNOWN',
    jobCount,
    reasonCode: input.reasonCode || null,
    evidence: Object.freeze([...(input.evidence || [])]),
    snapshotPath: input.snapshotPath || null,
    durationMs: input.durationMs == null
      ? null
      : Math.max(0, Math.trunc(Number(input.durationMs) || 0)),
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}
