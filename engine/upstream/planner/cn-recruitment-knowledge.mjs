import { createHash } from 'node:crypto';
import { registrableDomainOf } from './cn-url-evidence.mjs';

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const uniqueEvidence = (values) => {
  const seen = new Set();
  return (values || []).filter((value) => {
    const key = typeof value === 'string'
      ? `string:${value}`
      : `object:${JSON.stringify(value, Object.keys(value || {}).sort())}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const idFor = (prefix, value) => `${prefix}_${createHash('sha1').update(clean(value)).digest('hex').slice(0, 20)}`;
const aliasKey = (value) => clean(value).toLowerCase().replace(/(?:股份有限公司|有限责任公司|有限公司|集团公司|集团)$/g, '').replace(/[\s·•（）()\-_—–|｜/\\.,，。:：]+/g, '');
const hostOf = (value) => { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const NON_CORPORATE_REGISTRY_DOMAINS = new Set([
  'gankinterview.cn', 'gankinterview.com', 'gaoxiaojob.com', 'iguopin.com',
  'langlangwangshen.com', 'liepin.com', 'ncss.cn', 'niuqizp.com',
  'niuqizhipin.com', 'nowcoder.com', 'shixiseng.com', 'wondercv.com',
  'yingjiesheng.com', 'zhaopin.com', 'zhipin.com',
]);
const isNonCorporateRegistryUrl = (value = '') => {
  const domain = registrableDomainOf(value) || registrableDomainOf(`https://${value}`);
  return NON_CORPORATE_REGISTRY_DOMAINS.has(domain);
};

export function createEmptyRecruitmentKnowledgeBase(now = Date.now()) {
  return {
    version: 1,
    companyEntities: [],
    recruitmentSurfaces: [],
    projectSurfaceBindings: [],
    searchCandidates: [],
    reviews: [],
    migrationAudit: {
      legacyDomainEntries: 0,
      promotedVerifiedDomains: 0,
      unverifiedDomainCandidates: 0,
      rejectedNonCorporateDomains: 0,
      governanceDomainsPromoted: 0,
      atsTenantsPromoted: 0,
      governanceCandidatesImported: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}
export function normalizeCompanyEntity(input = {}, { now = Date.now() } = {}) {
  const canonicalName = clean(input.canonicalName || input.legalName || input.name || input.id);
  const id = clean(input.id || input.companyId) || idFor('company', canonicalName);
  return {
    id, canonicalName, legalName: clean(input.legalName || canonicalName),
    brandNames: unique(input.brandNames || input.aliases), englishNames: unique(input.englishNames), formerNames: unique(input.formerNames),
    parentCompanyId: clean(input.parentCompanyId) || null, subsidiaryIds: unique(input.subsidiaryIds),
    officialCorporateDomains: unique(input.officialCorporateDomains), countryOrMarket: clean(input.countryOrMarket || 'CN'),
    projectIds: unique(input.projectIds), createdAt: input.createdAt ?? now, updatedAt: now,
  };
}

export function resolveCompanyEntity(knowledgeBase, value = '') {
  const key = aliasKey(value);
  if (!key) return null;
  return (knowledgeBase.companyEntities || []).find((entity) => [entity.id, entity.canonicalName, entity.legalName, ...(entity.brandNames || []), ...(entity.englishNames || []), ...(entity.formerNames || [])].some((name) => aliasKey(name) === key)) || null;
}

export function upsertCompanyEntity(knowledgeBase, input = {}, { now = Date.now() } = {}) {
  const normalized = normalizeCompanyEntity(input, { now });
  const found = (knowledgeBase.companyEntities || []).find((entity) => entity.id === normalized.id) || resolveCompanyEntity(knowledgeBase, normalized.canonicalName);
  if (!found) { knowledgeBase.companyEntities.push(normalized); knowledgeBase.updatedAt = now; return normalized; }
  Object.assign(found, normalized, {
    id: found.id,
    brandNames: unique([...(found.brandNames || []), ...normalized.brandNames]), englishNames: unique([...(found.englishNames || []), ...normalized.englishNames]),
    formerNames: unique([...(found.formerNames || []), ...normalized.formerNames]), subsidiaryIds: unique([...(found.subsidiaryIds || []), ...normalized.subsidiaryIds]),
    officialCorporateDomains: unique([...(found.officialCorporateDomains || []), ...normalized.officialCorporateDomains]), projectIds: unique([...(found.projectIds || []), ...normalized.projectIds]),
    createdAt: found.createdAt ?? now, updatedAt: now,
  });
  knowledgeBase.updatedAt = now;
  return found;
}

export function normalizeRecruitmentSurface(input = {}, { now = Date.now() } = {}) {
  const canonicalUrl = clean(input.canonicalUrl || input.url);
  const vendor = clean(input.vendor || 'OTHER').toUpperCase();
  const tenantKey = clean(input.tenantKey);
  return {
    id: clean(input.id) || idFor('surface', `${vendor}|${tenantKey}|${canonicalUrl}`), vendor, tenantKey, canonicalUrl,
    registrableDomain: clean(input.registrableDomain || registrableDomainOf(canonicalUrl) || hostOf(canonicalUrl)), companyEntityIds: unique(input.companyEntityIds),
    scope: unique(Array.isArray(input.scope) ? input.scope : [input.scope || 'GENERAL']).map((value) => value.toUpperCase()),
    identityStatus: clean(input.identityStatus || 'UNVERIFIED').toUpperCase(), identityEvidence: uniqueEvidence(input.identityEvidence),
    validFrom: input.validFrom ?? now, validTo: input.validTo ?? null, lastVerifiedAt: input.lastVerifiedAt ?? null,
    lastSuccessfulFetchAt: input.lastSuccessfulFetchAt ?? null, lastFailureReason: clean(input.lastFailureReason) || null,
    createdAt: input.createdAt ?? now, updatedAt: now,
  };
}

export function upsertRecruitmentSurface(knowledgeBase, input = {}, { now = Date.now() } = {}) {
  const normalized = normalizeRecruitmentSurface(input, { now });
  const found = (knowledgeBase.recruitmentSurfaces || []).find((surface) => surface.id === normalized.id || (surface.vendor === normalized.vendor && surface.tenantKey && surface.tenantKey === normalized.tenantKey && surface.canonicalUrl === normalized.canonicalUrl));
  if (!found) { knowledgeBase.recruitmentSurfaces.push(normalized); knowledgeBase.updatedAt = now; return normalized; }
  Object.assign(found, normalized, { id: found.id, companyEntityIds: unique([...(found.companyEntityIds || []), ...normalized.companyEntityIds]), scope: unique([...(found.scope || []), ...normalized.scope]), identityEvidence: uniqueEvidence([...(found.identityEvidence || []), ...normalized.identityEvidence]), createdAt: found.createdAt ?? now, updatedAt: now });
  knowledgeBase.updatedAt = now;
  return found;
}

export function createSearchCandidate(input = {}, { now = Date.now() } = {}) {
  const resultUrl = clean(input.resultUrl || input.url);
  const finalUrl = clean(input.finalUrl || resultUrl);
  return {
    id: clean(input.id) || idFor('candidate', `${input.companyEntityId}|${input.provider}|${input.query}|${resultUrl}`),
    companyEntityId: clean(input.companyEntityId), projectId: clean(input.projectId) || null, provider: clean(input.provider), query: clean(input.query),
    queryIntent: clean(input.queryIntent || 'CAREER_HOME').toUpperCase(), rank: Number(input.rank) || null, title: clean(input.title), snippet: clean(input.snippet),
    resultUrl, finalUrl, redirectChain: unique(input.redirectChain || [resultUrl, finalUrl]), canonicalUrl: clean(input.canonicalUrl || finalUrl),
    registrableDomain: clean(input.registrableDomain || hostOf(finalUrl)), discoveredAt: input.discoveredAt ?? now, lastCheckedAt: input.lastCheckedAt ?? null,
    adLikeSignals: [...(input.adLikeSignals || [])], domainRiskSignals: [...(input.domainRiskSignals || [])], identityEvidence: [...(input.identityEvidence || [])],
    roleEvidence: [...(input.roleEvidence || [])], candidateScore: Number(input.candidateScore) || 0, verdict: clean(input.verdict || 'UNVERIFIED').toUpperCase(),
    rejectionReason: clean(input.rejectionReason) || null, rawResponseHash: clean(input.rawResponseHash),
    pageTitle: clean(input.pageTitle), pageH1: clean(input.pageH1), displayedCompany: clean(input.displayedCompany),
    tenantKey: clean(input.tenantKey), legalOrPrivacyEntity: clean(input.legalOrPrivacyEntity),
    officialSiteLinked: input.officialSiteLinked === true, manualTenantRegistryHit: input.manualTenantRegistryHit === true, jobCount: Number.isFinite(Number(input.jobCount)) ? Number(input.jobCount) : null,
    pageRole: clean(input.pageRole || 'UNKNOWN').toUpperCase(), vacancyStatus: clean(input.vacancyStatus || 'UNKNOWN').toUpperCase(),
  };
}

function ensureEntity(knowledgeBase, name, id, now) {
  return (id && knowledgeBase.companyEntities.find((entity) => entity.id === id)) || resolveCompanyEntity(knowledgeBase, name) || upsertCompanyEntity(knowledgeBase, { id: id || undefined, canonicalName: name }, { now });
}

export function buildRecruitmentKnowledgeBase(records = [], { companyDefinitions = [], domainRegistry = {}, governanceRegistries = {}, now = Date.now() } = {}) {
  const kb = createEmptyRecruitmentKnowledgeBase(now);
  for (const definition of companyDefinitions) upsertCompanyEntity(kb, definition, { now });
  for (const record of records) {
    const entity = ensureEntity(kb, record.company, record.companyStandardId, now);
    entity.projectIds = unique([...(entity.projectIds || []), record.projectId || record.id]);
  }
  for (const entry of domainRegistry.entries || []) {
    kb.migrationAudit.legacyDomainEntries += 1;
    const entity = ensureEntity(kb, entry.companyId, null, now);
    const verified = /^(?:verified|manual_accepted)$/i.test(entry.verificationStatus || entry.identityStatus || '');
    const candidateUrl = entry.careersUrl || (entry.officialDomain ? `https://${entry.officialDomain}/` : '');
    const nonCorporate = isNonCorporateRegistryUrl(candidateUrl || entry.officialDomain);
    if (verified && entry.careersUrl && !nonCorporate) {
      entity.officialCorporateDomains = unique([...(entity.officialCorporateDomains || []), entry.officialDomain]);
      upsertRecruitmentSurface(kb, { vendor: 'SELF_HOSTED', canonicalUrl: entry.careersUrl, companyEntityIds: [entity.id], scope: ['GENERAL'], identityStatus: 'VERIFIED', identityEvidence: [{ code: 'legacy_verified_domain_registry', url: entry.careersUrl }] }, { now });
      kb.migrationAudit.promotedVerifiedDomains += 1;
    } else if (candidateUrl) {
      kb.searchCandidates.push(createSearchCandidate({
        companyEntityId: entity.id,
        provider: 'legacy_registry',
        query: '',
        queryIntent: 'CAREER_HOME',
        resultUrl: candidateUrl,
        verdict: nonCorporate ? 'REJECTED' : 'UNVERIFIED',
        identityEvidence: ['legacy_registry_candidate'],
        rejectionReason: nonCorporate ? 'non_corporate_registry_domain' : null,
      }, { now }));
      if (nonCorporate) kb.migrationAudit.rejectedNonCorporateDomains += 1;
      else kb.migrationAudit.unverifiedDomainCandidates += 1;
    }
  }
  for (const entry of governanceRegistries.companyDomainRegistry || []) {
    if (entry.active === false) continue;
    const entity = ensureEntity(kb, entry.companyId, null, now);
    const url = entry.evidenceUrl || `https://${entry.domain}/`;
    entity.officialCorporateDomains = unique([...(entity.officialCorporateDomains || []), entry.domain]);
    upsertRecruitmentSurface(kb, { vendor: 'SELF_HOSTED', canonicalUrl: url, companyEntityIds: [entity.id], scope: ['GENERAL'], identityStatus: 'VERIFIED', identityEvidence: [{ code: entry.verificationMethod || 'strict_governance_registry', url }] }, { now });
    kb.migrationAudit.governanceDomainsPromoted += 1;
  }
  for (const entry of governanceRegistries.atsTenantRegistry || []) {
    if (entry.active === false) continue;
    const entity = ensureEntity(kb, entry.companyId, null, now);
    const vendor = String(entry.atsPlatform || 'OTHER').toUpperCase().replace('BEISEN_ZHIYE', 'BEISEN');
    upsertRecruitmentSurface(kb, { vendor, tenantKey: entry.tenantKey, canonicalUrl: entry.evidenceUrl || `https://${entry.hostPattern}/`, companyEntityIds: [entity.id], scope: ['GENERAL'], identityStatus: 'VERIFIED', identityEvidence: [{ code: entry.verificationMethod || 'strict_ats_tenant_registry', url: entry.evidenceUrl }] }, { now });
    kb.migrationAudit.atsTenantsPromoted += 1;
  }
  for (const entry of [...(governanceRegistries.companyDomainCandidates || []), ...(governanceRegistries.atsTenantCandidates || [])]) {
    const entity = ensureEntity(kb, entry.companyId, null, now);
    kb.searchCandidates.push(createSearchCandidate({ companyEntityId: entity.id, provider: 'governance_candidate', queryIntent: entry.kind === 'ats' ? 'ATS' : 'CAREER_HOME', resultUrl: entry.sampleUrl, verdict: entry.status === 'rejected' ? 'REJECTED' : 'UNVERIFIED', identityEvidence: entry.evidence || [], rejectionReason: entry.status === 'rejected' ? 'legacy_candidate_rejected' : null }, { now }));
    kb.migrationAudit.governanceCandidatesImported += 1;
  }
  kb.updatedAt = now;
  return kb;
}

export function createKnowledgeBaseline(knowledgeBase, projects = []) {
  const projectByCompany = new Map();
  for (const project of projects) {
    const id = project.companyStandardId || resolveCompanyEntity(knowledgeBase, project.company)?.id || 'unknown';
    projectByCompany.set(id, (projectByCompany.get(id) || 0) + 1);
  }
  const counts = (values) => Object.fromEntries([...values].sort().reduce((map, value) => map.set(value || 'UNKNOWN', (map.get(value || 'UNKNOWN') || 0) + 1), new Map()));
  return {
    companyEntities: knowledgeBase.companyEntities.length, recruitmentSurfaces: knowledgeBase.recruitmentSurfaces.length,
    verifiedSurfaces: knowledgeBase.recruitmentSurfaces.filter((surface) => surface.identityStatus === 'VERIFIED').length,
    searchCandidates: knowledgeBase.searchCandidates.length, blockedCandidates: knowledgeBase.searchCandidates.filter((candidate) => candidate.verdict === 'BLOCKED').length,
    projects: projects.length, projectsPerCompany: Object.fromEntries(projectByCompany),
    surfaceVendors: counts(knowledgeBase.recruitmentSurfaces.map((surface) => surface.vendor)), recruitmentTypes: counts(projects.map((project) => project.recruitmentType || project.scope)),
  };
}

export function mergeRecruitmentKnowledgeBase(existing = {}, incoming = {}, { now = Date.now() } = {}) {
  const knowledgeBase = existing;
  for (const key of ['companyEntities', 'recruitmentSurfaces', 'projectSurfaceBindings', 'searchCandidates', 'reviews']) if (!Array.isArray(knowledgeBase[key])) knowledgeBase[key] = [];
  knowledgeBase.version = Math.max(Number(existing.version) || 1, Number(incoming.version) || 1);
  knowledgeBase.createdAt ??= incoming.createdAt ?? now;
  knowledgeBase.migrationAudit = incoming.migrationAudit || knowledgeBase.migrationAudit || {};
  for (const entity of incoming.companyEntities || []) upsertCompanyEntity(knowledgeBase, entity, { now });
  for (const surface of incoming.recruitmentSurfaces || []) upsertRecruitmentSurface(knowledgeBase, surface, { now });
  const candidateIds = new Set(knowledgeBase.searchCandidates.map((item) => item.id));
  for (const candidate of incoming.searchCandidates || []) if (!candidateIds.has(candidate.id)) { knowledgeBase.searchCandidates.push(candidate); candidateIds.add(candidate.id); }
  const bindingKeys = new Set(knowledgeBase.projectSurfaceBindings.map((item) => `${item.projectId}|${item.recruitmentSurfaceId}`));
  for (const binding of incoming.projectSurfaceBindings || []) { const key = `${binding.projectId}|${binding.recruitmentSurfaceId}`; if (!bindingKeys.has(key)) { knowledgeBase.projectSurfaceBindings.push(binding); bindingKeys.add(key); } }
  const reviewIds = new Set(knowledgeBase.reviews.map((item) => item.reviewId));
  for (const review of incoming.reviews || []) if (!reviewIds.has(review.reviewId)) { knowledgeBase.reviews.push(review); reviewIds.add(review.reviewId); }
  knowledgeBase.updatedAt = now;
  return knowledgeBase;
}
