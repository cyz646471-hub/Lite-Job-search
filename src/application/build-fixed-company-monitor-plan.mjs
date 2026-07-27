function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s()（）·・._-]+/g, '')
    .toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function registryNames(record = {}) {
  return unique([
    record.name_cn,
    record.name_en,
    record.canonicalName,
    record.company,
    ...(record.aliases || []),
  ].map((value) => normalize(value)));
}

function companyNames(company = {}) {
  return unique([
    company.canonicalName,
    company.chineseName,
    company.englishName,
    ...(company.aliases || []),
  ].map((value) => normalize(value)));
}

function newestCheck(portals = []) {
  return portals
    .map((portal) => portal.lastCheckedAt || portal.lastVerifiedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

export function buildFixedCompanyMonitorPlan({
  registry = [],
  priorityNames = [],
  companies = [],
  portals = [],
  staleDays = 7,
  targetCount = Number.POSITIVE_INFINITY,
  includeFresh = false,
  now = new Date().toISOString(),
} = {}) {
  const nowMs = Date.parse(now);
  const staleBeforeMs = nowMs - Math.max(0, Number(staleDays) || 0) * 86_400_000;
  const priorityRank = new Map(priorityNames
    .map((name, index) => [normalize(name), index])
    .filter(([name]) => name));
  const registryByName = new Map();
  for (const record of registry) {
    for (const name of registryNames(record)) {
      if (!registryByName.has(name)) registryByName.set(name, record);
    }
  }
  const portalGroups = new Map();
  for (const portal of portals) {
    if (portal.verificationStatus !== 'VERIFIED'
      || portal.officialIdentityConfirmed !== true
      || !['OFFICIAL_SITE', 'OFFICIAL_ATS'].includes(portal.sourceTier)) continue;
    if (!portalGroups.has(portal.companyId)) portalGroups.set(portal.companyId, []);
    portalGroups.get(portal.companyId).push(portal);
  }

  const selected = [];
  const skipped = {
    notInRegistry: 0,
    noVerifiedOfficialEntry: 0,
    fresh: 0,
  };
  for (const company of companies) {
    const matchedRecord = companyNames(company)
      .map((name) => registryByName.get(name))
      .find(Boolean);
    if (!matchedRecord) {
      skipped.notInRegistry += 1;
      continue;
    }
    const confirmedPortals = portalGroups.get(company.id) || [];
    if (!confirmedPortals.length) {
      skipped.noVerifiedOfficialEntry += 1;
      continue;
    }
    const lastCheckedAt = newestCheck(confirmedPortals);
    const isFresh = lastCheckedAt && Date.parse(lastCheckedAt) > staleBeforeMs;
    if (!includeFresh && isFresh) {
      skipped.fresh += 1;
      continue;
    }
    const names = companyNames(company);
    const ranks = names.map((name) => priorityRank.get(name)).filter(Number.isInteger);
    selected.push({
      id: company.id,
      company: company.canonicalName,
      chineseName: company.chineseName,
      englishName: company.englishName,
      aliases: company.aliases || [],
      officialDomain: company.primaryOfficialDomain || company.officialDomains?.[0] || '',
      officialDomains: company.officialDomains || [],
      market: company.market || 'CN',
      industry: company.industryTags || matchedRecord.industry || [],
      fixedPool: true,
      priorityTier: ranks.length ? 0 : 1,
      priorityRank: ranks.length ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER,
      lastCheckedAt,
      confirmedCareerPortals: confirmedPortals
        .sort((left, right) => (
          (left.sourceTier === 'OFFICIAL_SITE' ? 0 : 1)
          - (right.sourceTier === 'OFFICIAL_SITE' ? 0 : 1)
          || right.confidenceScore - left.confidenceScore
        ))
        .map((portal) => ({
          id: portal.id,
          url: portal.canonicalUrl,
          sourceTier: portal.sourceTier,
          confidenceScore: portal.confidenceScore,
          lastCheckedAt: portal.lastCheckedAt,
        })),
    });
  }

  const queue = selected
    .sort((left, right) => (
      left.priorityTier - right.priorityTier
      || left.priorityRank - right.priorityRank
      || String(left.lastCheckedAt || '').localeCompare(String(right.lastCheckedAt || ''))
      || left.company.localeCompare(right.company, 'zh-CN')
    ))
    .slice(0, Math.max(0, Number(targetCount) || 0));

  return Object.freeze({
    mode: 'FIXED_COMPANY_POOL_INCREMENTAL_MONITOR',
    generatedAt: now,
    staleDays: Number(staleDays) || 0,
    searchFallbackAllowed: false,
    registryCount: registry.length,
    databaseCompanyCount: companies.length,
    eligibleCount: selected.length,
    selectedCount: queue.length,
    skipped: Object.freeze(skipped),
    companies: Object.freeze(queue.map((company) => Object.freeze(company))),
  });
}
