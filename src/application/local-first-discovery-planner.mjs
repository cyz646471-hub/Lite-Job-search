import { createHash } from 'node:crypto';

import { BROWSER_QUEUE_TYPES } from './run-browser-company-batch.mjs';

export const DISCOVERY_STRATEGY_VERSION = 'local-first-v1';
export const REUSABLE_CACHE_OUTCOMES = Object.freeze([
  'SUCCESS',
  'VERIFIED_NO_RESULTS',
]);

function normalizedQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizedHost(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
      .replace(/^www\./, '');
  } catch {
    return raw.replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

export function createSearchCacheKey({
  engine,
  query,
  locale,
  absoluteDateFrom = '',
  absoluteDateTo = '',
  strategyVersion = DISCOVERY_STRATEGY_VERSION,
} = {}) {
  const material = [
    String(engine || '').toLowerCase(),
    normalizedQuery(query),
    String(locale || '').toLowerCase(),
    absoluteDateFrom || '',
    absoluteDateTo || '',
    strategyVersion,
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

export function commonRecruitmentPaths(domain) {
  const normalized = String(domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!normalized) return [];
  return [
    `https://${normalized}/careers`,
    `https://${normalized}/career`,
    `https://${normalized}/jobs`,
    `https://${normalized}/join-us`,
    `https://${normalized}/recruit`,
  ];
}

export function planCompanyDiscovery({
  company,
  roleKeywords = [],
  locale = 'zh-CN',
  absoluteDateFrom = '',
  absoluteDateTo = '',
  allowBaiduFallback = false,
  allowSearchFallback = undefined,
  searchEngine = 'baidu',
  publicLeads = [],
  confirmedPortalsOnly = false,
} = {}, {
  repository,
} = {}) {
  if (!company?.id || !repository) {
    throw new Error('company and repository are required');
  }
  const portals = repository.listCareerPortals()
    .filter((portal) => portal.companyId === company.id);
  const knowledge = typeof repository.listCompanyWebKnowledge === 'function'
    ? repository.listCompanyWebKnowledge(company.id)
    : [];
  const rejectedValues = new Set(knowledge
    .filter((item) => ['REJECTED_DOMAIN', 'REJECTED_PORTAL'].includes(item.knowledgeType))
    .map((item) => item.value));
  const rejectedHosts = new Set([
    ...(company.rejectedOfficialDomains || []),
    ...rejectedValues,
  ].map(normalizedHost).filter(Boolean));
  const isRejectedValue = (value) => (
    rejectedValues.has(value) || rejectedHosts.has(normalizedHost(value))
  );
  const verifiedPortals = portals.filter((portal) => (
    portal.verificationStatus === 'VERIFIED'
    && ['OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL'].includes(portal.sourceTier)
    && portal.officialIdentityConfirmed === true
    && !isRejectedValue(portal.canonicalUrl)
  ));
  const officialDomains = unique([
    ...(company.officialDomains || []),
    company.primaryOfficialDomain,
    ...knowledge.filter((item) => (
      item.knowledgeType === 'OFFICIAL_DOMAIN'
      && item.verificationStatus === 'VERIFIED'
    )).map((item) => item.value),
  ]).filter((value) => !isRejectedValue(value));
  const historicalPortals = knowledge.filter((item) => (
    item.knowledgeType === 'CAREER_PORTAL'
    && item.verificationStatus === 'VERIFIED'
    && !isRejectedValue(item.value)
  )).map((item) => item.value);
  const atsTenants = knowledge.filter((item) => (
    item.knowledgeType === 'ATS_TENANT'
    && item.verificationStatus === 'VERIFIED'
  )).map((item) => item.value);

  const selectedSearchEngine = String(searchEngine || 'baidu').trim().toLowerCase();
  const searchFallbackAllowed = allowSearchFallback == null
    ? allowBaiduFallback === true
    : allowSearchFallback === true;
  const query = `${company.canonicalName} ${roleKeywords.join(' ')} 招聘`.trim();
  const cacheKey = createSearchCacheKey({
    engine: selectedSearchEngine,
    query,
    locale,
    absoluteDateFrom,
    absoluteDateTo,
  });
  const cache = typeof repository.getReusableSearchCache === 'function'
    ? repository.getReusableSearchCache(cacheKey)
    : null;
  const cachedCandidates = cache?.outcome === 'SUCCESS'
    ? (cache.result?.candidates || [])
    : [];
  const leadCandidates = publicLeads
    .filter((lead) => lead.companyId === company.id && lead.officialExternalUrl)
    .map((lead) => lead.officialExternalUrl);
  const commonPaths = officialDomains.flatMap(commonRecruitmentPaths);
  const officialRoots = officialDomains.map((domain) => (
    `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/`
  ));

  const candidates = unique((confirmedPortalsOnly
    ? verifiedPortals.map((portal) => portal.canonicalUrl)
    : [
      ...verifiedPortals.map((portal) => portal.canonicalUrl),
      ...historicalPortals,
      ...atsTenants,
      ...cachedCandidates,
      ...leadCandidates,
      ...officialRoots,
      ...commonPaths,
    ]).filter((value) => !isRejectedValue(value)));
  const plannedOfficialDomains = confirmedPortalsOnly ? [] : officialDomains;
  const hasLocalEvidence = candidates.length > 0
    || (!confirmedPortalsOnly && officialDomains.length > 0);
  const queueType = hasLocalEvidence
    ? BROWSER_QUEUE_TYPES.LOCAL
    : searchFallbackAllowed
      ? selectedSearchEngine === 'baidu'
        ? BROWSER_QUEUE_TYPES.LEGACY_BAIDU
        : BROWSER_QUEUE_TYPES.SEARCH
      : BROWSER_QUEUE_TYPES.LOCAL;
  const terminalAction = hasLocalEvidence
    ? 'VERIFY_CANDIDATES'
    : searchFallbackAllowed
      ? `${selectedSearchEngine.toUpperCase()}_DISCOVERY`
      : 'MANUAL_OFFICIAL_DISCOVERY';

  return Object.freeze({
    companyId: company.id,
    company: company.canonicalName,
    queueType,
    terminalAction,
    query,
    cacheKey,
    cacheOutcome: cache?.outcome || null,
    searchEngine: selectedSearchEngine,
    searchFallbackAllowed,
    candidates: Object.freeze(candidates),
    officialDomains: Object.freeze(plannedOfficialDomains),
    confirmedPortalsOnly,
    stages: Object.freeze([
      { priority: 1, source: 'VERIFIED_CAREER_PORTAL', count: verifiedPortals.length },
      { priority: 2, source: 'KNOWN_OFFICIAL_DOMAIN', count: confirmedPortalsOnly ? 0 : officialDomains.length },
      { priority: 3, source: 'HISTORICAL_CAREER_PORTAL', count: confirmedPortalsOnly ? 0 : historicalPortals.length },
      { priority: 4, source: 'ATS_TENANT_OWNERSHIP', count: confirmedPortalsOnly ? 0 : atsTenants.length },
      { priority: 5, source: 'SEARCH_CACHE', count: confirmedPortalsOnly ? 0 : cachedCandidates.length },
      { priority: 6, source: 'PUBLIC_LEAD_OFFICIAL_LINK', count: confirmedPortalsOnly ? 0 : leadCandidates.length },
      { priority: 7, source: 'COMMON_RECRUITMENT_PATH', count: confirmedPortalsOnly ? 0 : commonPaths.length },
      {
        priority: 8,
        source: `${selectedSearchEngine.toUpperCase()}_BROWSER`,
        enabled: terminalAction === `${selectedSearchEngine.toUpperCase()}_DISCOVERY`,
      },
      { priority: 9, source: 'MANUAL_DISCOVERY', enabled: terminalAction === 'MANUAL_OFFICIAL_DISCOVERY' },
    ]),
  });
}
