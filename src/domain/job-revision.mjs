import { createHash, randomUUID } from 'node:crypto';

export const JOB_REVISION_TYPES = Object.freeze([
  'DISCOVERED',
  'UPDATED',
  'SEEN',
  'MISSING',
  'CLOSED',
  'REOPENED',
]);

function revisionHash(fields) {
  return createHash('sha256')
    .update(JSON.stringify(fields || {}))
    .digest('hex');
}
export function createJobRevision(input = {}, {
  now = new Date().toISOString(),
} = {}) {
  const jobId = String(input.jobId || '').trim();
  const changeType = String(input.changeType || '').trim().toUpperCase();
  if (!jobId || !JOB_REVISION_TYPES.includes(changeType)) {
    throw new Error('JobRevision jobId and supported changeType are required');
  }
  const fields = Object.freeze({ ...(input.fields || {}) });
  return Object.freeze({
    id: String(input.id || randomUUID()),
    jobId,
    observationId: input.observationId ? String(input.observationId) : null,
    revisionHash: String(input.revisionHash || revisionHash(fields)),
    changeType,
    fields,
    changedFields: Object.freeze([...(input.changedFields || [])]),
    observedAt: input.observedAt || now,
  });
}
