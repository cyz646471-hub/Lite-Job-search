import { createHash } from 'node:crypto';

import { canonicalRecruitmentUrl } from '../core/canonical-recruitment-url.mjs';

export const SOURCE_ENDPOINT_KINDS = Object.freeze([
  'CAREER_PORTAL',
  'JOB_LIST',
  'ATS_API',
  'PUBLIC_JSON',
  'SITEMAP',
  'STRUCTURED_PAGE',
  'OFFICIAL_SOCIAL',
]);

export const SOURCE_ENDPOINT_TRANSPORTS = Object.freeze([
  'HTTP',
  'ATS_ADAPTER',
  'BROWSER',
  'SOCIAL',
]);

export const SOURCE_ENDPOINT_STATES = Object.freeze([
  'ACTIVE',
  'PAUSED',
  'BLOCKED',
  'RETIRED',
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
export function stableSourceEndpointId({ companyId, canonicalUrl }) {
  const digest = createHash('sha256')
    .update(`${String(companyId || '')}|${String(canonicalUrl || '')}`)
    .digest('hex')
    .slice(0, 24);
  return `endpoint-${digest}`;
}

export function createSourceEndpoint(input = {}, {
  now = new Date().toISOString(),
} = {}) {
  const companyId = clean(input.companyId);
  const canonicalUrl = canonicalRecruitmentUrl(input.canonicalUrl || input.url);
  if (!companyId || !canonicalUrl) {
    throw new Error('SourceEndpoint companyId and public http(s) URL are required');
  }
  const endpointKind = clean(input.endpointKind || 'CAREER_PORTAL').toUpperCase();
  const transport = clean(input.transport || 'HTTP').toUpperCase();
  const state = clean(input.state || 'ACTIVE').toUpperCase();
  if (!SOURCE_ENDPOINT_KINDS.includes(endpointKind)) {
    throw new Error('unsupported SourceEndpoint endpointKind');
  }
  if (!SOURCE_ENDPOINT_TRANSPORTS.includes(transport)) {
    throw new Error('unsupported SourceEndpoint transport');
  }
  if (!SOURCE_ENDPOINT_STATES.includes(state)) {
    throw new Error('unsupported SourceEndpoint state');
  }
  const intervalHours = Math.max(1, Math.trunc(Number(input.intervalHours) || 168));
  return Object.freeze({
    id: clean(input.id) || stableSourceEndpointId({ companyId, canonicalUrl }),
    companyId,
    careerPortalId: input.careerPortalId ? clean(input.careerPortalId) : null,
    url: canonicalUrl,
    canonicalUrl,
    endpointKind,
    transport,
    adapterType: clean(input.adapterType) || null,
    state,
    intervalHours,
    etag: clean(input.etag) || null,
    lastModified: clean(input.lastModified) || null,
    contentHash: clean(input.contentHash) || null,
    structureHash: clean(input.structureHash) || null,
    lastCheckedAt: input.lastCheckedAt || null,
    lastSuccessAt: input.lastSuccessAt || null,
    lastFailureAt: input.lastFailureAt || null,
    lastFailureReason: clean(input.lastFailureReason) || null,
    lastHttpStatus: input.lastHttpStatus == null ? null : Number(input.lastHttpStatus),
    nextCheckAt: input.nextCheckAt || null,
    consecutiveFailures: Math.max(0, Math.trunc(Number(input.consecutiveFailures) || 0)),
    metadata: Object.freeze({ ...(input.metadata || {}) }),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  });
}
