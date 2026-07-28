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
const ALLOWED_RECRUITMENT_STATES = new Set([
  'ALL',
  'CAMPUS_OPEN',
  'CAMPUS_NOT_OPEN',
  'OPENINGS_FOUND',
  'NO_OPENINGS',
  'UNKNOWN',
]);
const ALLOWED_CONFIDENCE_SCOPES = new Set([
  'ALL',
  'VERIFIED',
  'C_POSITIVE',
  'ZERO_OR_EMPTY',
]);
const CAMPUS_RECRUITMENT_TYPES = new Set(['CAMPUS_FULL_TIME', 'CAMPUS_INTERNSHIP']);

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
  recruitmentState = 'ALL',
  confidenceScope = 'ALL',
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
      recruitmentState: 'ALL',
      confidenceScope: 'ALL',
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
  const selectedRecruitmentState = ALLOWED_RECRUITMENT_STATES.has(
    String(recruitmentState).toUpperCase(),
  )
    ? String(recruitmentState).toUpperCase()
    : 'ALL';
  const selectedConfidenceScope = ALLOWED_CONFIDENCE_SCOPES.has(
    String(confidenceScope).toUpperCase(),
  )
    ? String(confidenceScope).toUpperCase()
    : 'ALL';
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
  const events = typeof repository.listRecruitmentEvents === 'function'
    ? repository.listRecruitmentEvents()
    : [];
  const companyByIdentity = new Map();
  for (const company of companies) {
    for (const identity of companyIdentityValues(company)) {
      if (!companyByIdentity.has(identity)) companyByIdentity.set(identity, company);
    }
  }
  const portalsByCompany = new Map();
  const jobsByCompany = new Map();
  const eventsByCompany = new Map();
  for (const portal of portals) {
    if (!portalsByCompany.has(portal.companyId)) portalsByCompany.set(portal.companyId, []);
    portalsByCompany.get(portal.companyId).push(portal);
  }
  for (const job of jobs) {
    jobsByCompany.set(job.companyId, (jobsByCompany.get(job.companyId) || 0) + 1);
  }
  for (const event of events) {
    if (!eventsByCompany.has(event.companyId)) eventsByCompany.set(event.companyId, []);
    eventsByCompany.get(event.companyId).push(event);
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
  const enriched = allItems.map((item) => {
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
    const companyEvents = eventsByCompany.get(storedCompany?.id) || [];
    const openEvents = companyEvents.filter((event) => event.status === 'OPEN');
    const openCampusEvents = openEvents.filter(
      (event) => CAMPUS_RECRUITMENT_TYPES.has(event.recruitmentType),
    );
    const campusHiringStatus = openCampusEvents.length
      ? 'OPEN'
      : portal?.verificationStatus === 'VERIFIED'
        && (
          portal.hiringAvailability === 'NO_OPENINGS'
          || openEvents.length > 0
          || (portal.recruitmentTypes || []).length > 0
        )
        ? 'NOT_OPEN'
        : 'UNKNOWN';
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
      campusHiringStatus,
      confidenceScore: portal?.confidenceScore ?? null,
      activeJobCount: jobsByCompany.get(storedCompany?.id) || 0,
      openEventCount: openEvents.length,
      openCampusEventCount: openCampusEvents.length,
      lastCheckedAt: portal?.lastCheckedAt || portal?.lastVerifiedAt || null,
    };
  });
  const filtered = enriched.filter((item) => {
    if (selectedScope === 'REMAINING' && !REMAINING_STATUSES.has(item.status)) return false;
    if (!['ALL', 'REMAINING'].includes(selectedScope) && item.status !== selectedScope) {
      return false;
    }
    if (selectedRecruitmentState === 'CAMPUS_OPEN' && item.campusHiringStatus !== 'OPEN') {
      return false;
    }
    if (
      selectedRecruitmentState === 'CAMPUS_NOT_OPEN'
      && item.campusHiringStatus !== 'NOT_OPEN'
    ) return false;
    if (selectedRecruitmentState === 'OPENINGS_FOUND' && item.openEventCount === 0) return false;
    if (selectedRecruitmentState === 'NO_OPENINGS' && item.hiringAvailability !== 'NO_OPENINGS') {
      return false;
    }
    if (
      selectedRecruitmentState === 'UNKNOWN'
      && item.campusHiringStatus !== 'UNKNOWN'
      && item.hiringAvailability !== 'UNKNOWN'
      && item.hiringAvailability !== null
    ) return false;
    if (selectedConfidenceScope === 'VERIFIED' && item.portalStatus !== 'VERIFIED') return false;
    if (
      selectedConfidenceScope === 'C_POSITIVE'
      && !(Number(item.confidenceScore) > 0 && Number(item.confidenceScore) < 50)
    ) return false;
    if (
      selectedConfidenceScope === 'ZERO_OR_EMPTY'
      && !(item.confidenceScore === null || Number(item.confidenceScore) <= 0)
    ) return false;
    if (!needle) return true;
    return [
      item.company,
      item.chineseName,
      item.englishName,
      item.countryRegion,
      item.officialDomain,
    ].some((value) => normalized(value).includes(needle));
  });
  const page = filtered.slice(selectedOffset, selectedOffset + selectedLimit);
  return Object.freeze({
    status: 'OK',
    batchId,
    scope: selectedScope,
    recruitmentState: selectedRecruitmentState,
    confidenceScope: selectedConfidenceScope,
    query: String(query || ''),
    offset: selectedOffset,
    limit: selectedLimit,
    total: filtered.length,
    counts,
    items: Object.freeze(page),
  });
}
