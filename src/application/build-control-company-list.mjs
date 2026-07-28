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

const PORTAL_STATUS_PRIORITY = Object.freeze({
  VERIFIED: 0,
  REVIEW: 1,
  BLOCKED: 2,
  CANDIDATE: 3,
  REJECTED: 4,
});

function companyIdentityValues(company = {}) {
  return [
    company.id,
    company.canonicalName,
    company.chineseName,
    company.englishName,
    ...(company.aliases || []),
    ...(company.officialDomains || []),
  ].map(normalized).filter(Boolean);
}

function bestPortal(portals = []) {
  return [...portals].sort((left, right) => (
    (PORTAL_STATUS_PRIORITY[left.verificationStatus] ?? 9)
      - (PORTAL_STATUS_PRIORITY[right.verificationStatus] ?? 9)
    || Number(right.confidenceScore || 0) - Number(left.confidenceScore || 0)
    || Date.parse(right.lastCheckedAt || right.lastVerifiedAt || 0)
      - Date.parse(left.lastCheckedAt || left.lastVerifiedAt || 0)
  ))[0] || null;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
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
  const companies = typeof repository.listCompanies === 'function'
    ? repository.listCompanies()
    : [];
  const portals = typeof repository.listCareerPortals === 'function'
    ? repository.listCareerPortals()
    : [];
  const jobs = typeof repository.listJobOpenings === 'function'
    ? repository.listJobOpenings()
    : [];
  const companyByIdentity = new Map();
  for (const company of companies) {
    for (const identity of companyIdentityValues(company)) {
      if (!companyByIdentity.has(identity)) companyByIdentity.set(identity, company);
    }
  }
  const portalsByCompany = new Map();
  const jobsByCompany = new Map();
  for (const portal of portals) {
    if (!portalsByCompany.has(portal.companyId)) portalsByCompany.set(portal.companyId, []);
    portalsByCompany.get(portal.companyId).push(portal);
  }
  for (const job of jobs) {
    jobsByCompany.set(job.companyId, (jobsByCompany.get(job.companyId) || 0) + 1);
  }
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
  const page = filtered.slice(selectedOffset, selectedOffset + selectedLimit).map((item) => {
    const storedCompany = [
      item.input?.companyId,
      item.input?.company,
      item.input?.canonicalName,
      item.input?.chineseName,
      item.input?.englishName,
      item.input?.officialDomain,
    ].map(normalized).filter(Boolean)
      .map((identity) => companyByIdentity.get(identity))
      .find(Boolean);
    const portal = bestPortal(portalsByCompany.get(storedCompany?.id) || []);
    return {
      company: companyName(item),
      chineseName: item.input?.chineseName || null,
      englishName: item.input?.englishName || null,
      market: item.input?.market || null,
      countryRegion: item.input?.countryRegion || null,
      officialDomain: item.input?.officialDomain || storedCompany?.primaryOfficialDomain || null,
      status: item.status,
      attemptCount: item.attemptCount,
      reason: item.errorMessage || item.deferReason || item.retryClass || null,
      position: item.position,
      portalUrl: safeHttpUrl(portal?.canonicalUrl),
      portalStatus: portal?.verificationStatus || null,
      portalPageType: portal?.pageType || null,
      hiringAvailability: portal?.hiringAvailability || null,
      confidenceScore: portal?.confidenceScore ?? null,
      activeJobCount: jobsByCompany.get(storedCompany?.id) || 0,
      lastCheckedAt: portal?.lastCheckedAt || portal?.lastVerifiedAt || null,
    };
  });
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
