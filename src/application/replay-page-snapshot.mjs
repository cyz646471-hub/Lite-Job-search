import { readFile } from 'node:fs/promises';

import { resolvePageProvider } from '../../engine/upstream/planner/page-providers/_registry.mjs';
import { contentHashOfSnapshotBody } from '../domain/page-snapshot.mjs';

export async function replayPageSnapshot({
  snapshot,
  resolveProvider = resolvePageProvider,
} = {}) {
  if (!snapshot?.bodyPath || !snapshot?.finalUrl) {
    throw new Error('snapshot bodyPath and finalUrl are required');
  }
  const body = await readFile(snapshot.bodyPath, 'utf8');
  const actualHash = contentHashOfSnapshotBody(body);
  if (snapshot.contentHash && actualHash !== snapshot.contentHash) {
    throw new Error('snapshot content hash mismatch');
  }
  const provider = await resolveProvider(snapshot.finalUrl);
  const parsed = provider?.parse
    ? await provider.parse(body, {
      requestedUrl: snapshot.finalUrl,
      finalUrl: snapshot.finalUrl,
      replay: true,
    })
    : null;
  return Object.freeze({
    snapshotId: snapshot.id,
    sourceEndpointId: snapshot.sourceEndpointId,
    provider: provider?.id || null,
    contentHash: actualHash,
    parsed,
  });
}
