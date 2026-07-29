function normalizedFamily(portal = {}) {
  const ats = String(portal.atsType || '').trim().toLowerCase();
  const host = String(portal.registrableDomain || '').trim().toLowerCase();
  if (/moka|mokahr/.test(`${ats} ${host}`)) return 'MOKA';
  if (/beisen|zhiye|italent/.test(`${ats} ${host}`)) return 'BEISEN_ZHIYE_ITALENT';
  if (/feishu|bytedance/.test(`${ats} ${host}`)) return 'FEISHU_RECRUITMENT';
  if (/hotjob/.test(`${ats} ${host}`)) return 'HOTJOB';
  if (/moseeker/.test(`${ats} ${host}`)) return 'MOSEEKER';
  if (/workday/.test(`${ats} ${host}`)) return 'WORKDAY';
  if (/greenhouse/.test(`${ats} ${host}`)) return 'GREENHOUSE';
  if (/lever/.test(`${ats} ${host}`)) return 'LEVER';
  if (/smartrecruiters/.test(`${ats} ${host}`)) return 'SMARTRECRUITERS';
  if (ats) return ats.toUpperCase();
  if (portal.sourceTier === 'OFFICIAL_ATS') return 'UNCLASSIFIED_OFFICIAL_ATS';
  return null;
}

export function buildCnAtsCoverageReport({
  companies = [],
  portals = [],
  sourceEndpoints = [],
} = {}) {
  const cnCompanyIds = new Set(
    companies.filter((company) => company.market === 'CN').map((company) => company.id),
  );
  const endpointByPortal = new Map(
    sourceEndpoints
      .filter((endpoint) => endpoint.careerPortalId)
      .map((endpoint) => [endpoint.careerPortalId, endpoint]),
  );
  const groups = new Map();
  for (const portal of portals) {
    if (
      !cnCompanyIds.has(portal.companyId)
      || portal.supersededByPortalId
      || portal.sourceTier === 'PLATFORM_ONLY'
    ) continue;
    const family = normalizedFamily(portal);
    if (!family) continue;
    const group = groups.get(family) || {
      family,
      portalCount: 0,
      companyIds: new Set(),
      verifiedCompanyIds: new Set(),
      openCompanyIds: new Set(),
      monitoredCompanyIds: new Set(),
      blockedCount: 0,
    };
    group.portalCount += 1;
    group.companyIds.add(portal.companyId);
    if (portal.verificationStatus === 'VERIFIED') {
      group.verifiedCompanyIds.add(portal.companyId);
    }
    if (portal.hiringAvailability === 'OPENINGS_FOUND') {
      group.openCompanyIds.add(portal.companyId);
    }
    if (endpointByPortal.has(portal.id)) group.monitoredCompanyIds.add(portal.companyId);
    if (portal.verificationStatus === 'BLOCKED') group.blockedCount += 1;
    groups.set(family, group);
  }
  const rows = [...groups.values()].map((group) => {
    const companyCount = group.companyIds.size;
    const verifiedCompanies = group.verifiedCompanyIds.size;
    const openCompanies = group.openCompanyIds.size;
    const monitoredCompanies = group.monitoredCompanyIds.size;
    return Object.freeze({
      family: group.family,
      companyCount,
      portalCount: group.portalCount,
      verifiedCompanies,
      openCompanies,
      monitoredCompanies,
      blockedPortals: group.blockedCount,
      adapterPriorityScore: (
        companyCount * 5
        + verifiedCompanies * 8
        + openCompanies * 15
        + monitoredCompanies * 3
      ),
    });
  }).sort((left, right) => (
    right.adapterPriorityScore - left.adapterPriorityScore
    || right.companyCount - left.companyCount
    || left.family.localeCompare(right.family)
  ));
  return Object.freeze({
    market: 'CN',
    generatedAt: new Date().toISOString(),
    totalFamilies: rows.length,
    rows: Object.freeze(rows),
  });
}
