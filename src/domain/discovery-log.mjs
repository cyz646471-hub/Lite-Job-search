export const DISCOVERY_OUTCOMES = Object.freeze([
  'DISCOVERED',
  'DUPLICATE',
  'FETCH_FAILED',
  'VERIFIED_PORTAL',
  'REVIEW_REQUIRED',
  'REJECTED',
  'JOBS_EXTRACTED',
  'NO_RECENT_JOBS',
]);

export function createDiscoveryLog(input = {}) {
  if (!input.id || !input.runId || !input.searchIntentId) {
    throw new Error('DiscoveryLog id, runId and searchIntentId are required');
  }
  if (!DISCOVERY_OUTCOMES.includes(input.outcome)) throw new Error('unsupported DiscoveryLog outcome');
  return Object.freeze({
    id: String(input.id),
    runId: String(input.runId),
    searchIntentId: String(input.searchIntentId),
    query: String(input.query || ''),
    expandedKeywords: Object.freeze([...(input.expandedKeywords || [])].map(String)),
    searchSource: String(input.searchSource || ''),
    searchedAt: input.searchedAt || new Date().toISOString(),
    resultUrl: input.resultUrl || null,
    resultRank: Number.isFinite(Number(input.resultRank)) ? Number(input.resultRank) : null,
    outcome: input.outcome,
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}
