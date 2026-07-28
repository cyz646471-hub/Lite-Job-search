const REMAINING_STATUSES = new Set(['PENDING', 'RUNNING', 'FAILED', 'DEFERRED']);
const ALLOWED_SCOPES = new Set([
  'REMAINING',
  'ALL',
  'PENDING',
  'RUNNING',
  'FAILED',
  'DEFERRED',
  'SUCCEEDED',
]);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function companyName(item) {
  return item.input?.company
    || item.input?.canonicalName
    || item.input?.chineseName
    || item.input?.englishName
    || item.itemKey;
}

export function buildControlCompanyList({
  repository,
  batchId,
  scope = 'REMAINING',
  query = '',
  offset = 0,
  limit = 50,
} = {}) {
  if (!repository) throw new Error('repository is required');
  if (!batchId) {
    return Object.freeze({
      status: 'NOT_CONFIGURED',
      batchId: null,
      scope: 'REMAINING',
      query: '',
      offset: 0,
      limit: 50,
      total: 0,
      counts: {},
      items: Object.freeze([]),
    });
  }
  const selectedScope = ALLOWED_SCOPES.has(String(scope).toUpperCase())
    ? String(scope).toUpperCase()
    : 'REMAINING';
  const selectedOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const selectedLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const needle = normalized(query);
  const allItems = repository.listBatchItems(batchId);
  const counts = Object.fromEntries([
    'PENDING',
    'RUNNING',
    'FAILED',
    'DEFERRED',
    'SUCCEEDED',
  ].map((status) => [
    status,
    allItems.filter((item) => item.status === status).length,
  ]));
  const filtered = allItems.filter((item) => {
    if (selectedScope === 'REMAINING' && !REMAINING_STATUSES.has(item.status)) return false;
    if (!['ALL', 'REMAINING'].includes(selectedScope) && item.status !== selectedScope) {
      return false;
    }
    if (!needle) return true;
    return [
      companyName(item),
      item.input?.chineseName,
      item.input?.englishName,
      item.input?.countryRegion,
      item.input?.officialDomain,
    ].some((value) => normalized(value).includes(needle));
  });
  const page = filtered.slice(selectedOffset, selectedOffset + selectedLimit).map((item) => ({
    company: companyName(item),
    chineseName: item.input?.chineseName || null,
    englishName: item.input?.englishName || null,
    market: item.input?.market || null,
    countryRegion: item.input?.countryRegion || null,
    officialDomain: item.input?.officialDomain || null,
    status: item.status,
    attemptCount: item.attemptCount,
    reason: item.errorMessage || item.deferReason || item.retryClass || null,
    position: item.position,
  }));
  return Object.freeze({
    status: 'OK',
    batchId,
    scope: selectedScope,
    query: String(query || ''),
    offset: selectedOffset,
    limit: selectedLimit,
    total: filtered.length,
    counts,
    items: Object.freeze(page),
  });
}
