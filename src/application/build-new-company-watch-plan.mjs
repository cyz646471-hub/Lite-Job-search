function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value).normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[\s()（）,，.\-_]+/g, '');
}

function list(values = []) {
  return Array.isArray(values) ? values : [values];
}

function unique(values = []) {
  return [...new Set(list(values).map(clean).filter(Boolean))];
}

function names(record = {}) {
  return unique([
    record.company,
    record.canonicalName,
    record.name_cn,
    record.chineseName,
    record.name_en,
    record.englishName,
    ...list(record.aliases),
  ]).map(normalized).filter(Boolean);
}

function findCompany(record, companies) {
  const candidateNames = new Set(names(record));
  const candidateDomains = new Set(unique([
    record.officialDomain,
    ...list(record.officialDomains || record.official_domains),
  ]).map((value) => value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')));
  return companies.find((company) => {
    const companyNames = names(company);
    if (companyNames.some((name) => candidateNames.has(name))) return true;
    const domains = (company.officialDomains || []).map((value) => value.toLowerCase());
    return domains.some((domain) => candidateDomains.has(domain));
  }) || null;
}

function verifiedPortals(companyId, portals) {
  return portals.filter((portal) => (
    portal.companyId === companyId
    && portal.verificationStatus === 'VERIFIED'
    && portal.officialIdentityConfirmed === true
    && ['OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL'].includes(portal.sourceTier)
  ));
}

function latestTimestamp(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function watchCandidate(record, stored, portals, nowMs, staleDays) {
  const company = stored || null;
  const confirmed = company ? verifiedPortals(company.id, portals) : [];
  const checkedAt = latestTimestamp(confirmed.map((portal) => portal.lastCheckedAt));
  const lastObservedAt = checkedAt || company?.updatedAt || null;
  const fresh = lastObservedAt && Date.parse(lastObservedAt) > nowMs - staleDays * 86_400_000;
  const normalizedRecord = {
    id: company?.id || record.id || `watch-${normalized(record.company || record.canonicalName)}`,
    company: company?.canonicalName || clean(record.company || record.canonicalName || record.name_cn || record.name_en),
    chineseName: company?.chineseName || clean(record.chineseName || record.name_cn) || null,
    englishName: company?.englishName || clean(record.englishName || record.name_en) || null,
    aliases: unique([...(company?.aliases || []), ...list(record.aliases)]),
    officialDomain: company?.primaryOfficialDomain || record.officialDomain || record.official_domains?.[0] || '',
    officialDomains: unique([...(company?.officialDomains || []), ...list(record.officialDomains || record.official_domains)]),
    industry: unique([...(company?.industryTags || []), ...list(record.industry)]),
    market: company?.market || record.market || 'CN',
    countryRegion: company?.countryRegion || record.countryRegion || record.country_region || null,
    watchSource: record.source || record.registrySource || 'new_company_watchlist',
    watchAddedAt: record.addedAt || record.createdAt || null,
  };
  if (!company) return { ...normalizedRecord, watchState: 'NEW_COMPANY', priority: 0, fixedPool: false };
  if (!confirmed.length) {
    return { ...normalizedRecord, watchState: fresh ? 'UNVERIFIED_FRESH' : 'UNVERIFIED_ENTRY', priority: 1, fixedPool: false, lastObservedAt };
  }
  return {
    ...normalizedRecord,
    watchState: fresh ? 'CONFIRMED_FRESH' : 'STALE_CONFIRMED_ENTRY',
    priority: 2,
    fixedPool: true,
    lastObservedAt,
    confirmedCareerPortals: confirmed.map((portal) => ({
      id: portal.id,
      url: portal.canonicalUrl,
      sourceTier: portal.sourceTier,
      confidenceScore: portal.confidenceScore,
      lastCheckedAt: portal.lastCheckedAt,
    })),
  };
}

export function buildNewCompanyWatchPlan({
  watchlist = [],
  companies = [],
  portals = [],
  staleDays = 3,
  targetCount = 50,
  includeFresh = false,
  now = new Date().toISOString(),
} = {}) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('now must be an ISO timestamp');
  const boundedStaleDays = Math.max(0, Number(staleDays) || 0);
  const seen = new Set();
  const skipped = { duplicateWatchlist: 0, fresh: 0 };
  const selected = [];
  for (const record of watchlist) {
    const key = names(record).sort().at(0);
    if (!key || seen.has(key)) {
      skipped.duplicateWatchlist += 1;
      continue;
    }
    seen.add(key);
    const candidate = watchCandidate(record, findCompany(record, companies), portals, nowMs, boundedStaleDays);
    if (!includeFresh && ['UNVERIFIED_FRESH', 'CONFIRMED_FRESH'].includes(candidate.watchState)) {
      skipped.fresh += 1;
      continue;
    }
    selected.push(candidate);
  }
  const queue = selected
    .sort((left, right) => left.priority - right.priority
      || String(left.lastObservedAt || '').localeCompare(String(right.lastObservedAt || ''))
      || left.company.localeCompare(right.company, 'zh-CN'))
    .slice(0, Math.max(1, Number(targetCount) || 50));
  return Object.freeze({
    mode: 'NEW_COMPANY_DISCOVERY_AND_MONITOR',
    generatedAt: now,
    staleDays: boundedStaleDays,
    searchFallbackAllowed: true,
    watchlistCount: watchlist.length,
    selectedCount: queue.length,
    stateCounts: Object.freeze(selected.reduce((counts, item) => {
      counts[item.watchState] = (counts[item.watchState] || 0) + 1;
      return counts;
    }, {})),
    skipped: Object.freeze(skipped),
    companies: Object.freeze(queue.map((item) => Object.freeze(item))),
  });
}
