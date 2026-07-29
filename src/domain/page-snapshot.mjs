import { createHash, randomUUID } from 'node:crypto';

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

export function createPageSnapshot(input = {}, {
  now = new Date().toISOString(),
} = {}) {
  const sourceEndpointId = String(input.sourceEndpointId || '').trim();
  const observationId = String(input.observationId || '').trim();
  const bodyPath = String(input.bodyPath || '').trim();
  const contentHash = String(input.contentHash || '').trim();
  if (!sourceEndpointId || !observationId || !bodyPath || !contentHash) {
    throw new Error(
      'PageSnapshot sourceEndpointId, observationId, bodyPath and contentHash are required',
    );
  }
  return Object.freeze({
    id: String(input.id || `snapshot-${randomUUID()}`),
    sourceEndpointId,
    observationId,
    capturedAt: input.capturedAt || now,
    finalUrl: input.finalUrl || null,
    contentType: input.contentType || null,
    bodyPath,
    bodyBytes: Math.max(0, Math.trunc(Number(input.bodyBytes) || 0)),
    contentHash,
    structureHash: input.structureHash || null,
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}

export function contentHashOfSnapshotBody(body) {
  return sha256(body);
}
