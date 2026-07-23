import { registrableDomainOf } from './cn-url-evidence.mjs';

const clean = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();
const hostOf = (value) => { try { return new URL(value).hostname.toLowerCase(); } catch { return ''; } };
const matchesDomain = (value, domain) => { const host = hostOf(value); const expected = String(domain || '').toLowerCase().replace(/^www\./, ''); return Boolean(host && expected && (host === expected || host.endsWith(`.${expected}`))); };

export const HIGH_RISK_CODES = new Set(['ip_literal_host', 'punycode_domain', 'lookalike_official_domain', 'personal_form_or_cloud_drive', 'payment_or_private_contact_risk', 'excessive_cross_domain_redirects', 'tls_certificate_error', 'identity_conflict']);

export function evaluateCandidateIdentity({ companyEntity = {}, candidate = {}, page = {}, pageRole = 'UNKNOWN', vacancyStatus = 'UNKNOWN', registeredSurface = null } = {}) {
  const strongEvidence = [], mediumEvidence = [], riskSignals = [...new Set([...(candidate.domainRiskSignals || candidate.riskSignals || []), ...(page.riskSignals || [])])];
  const finalUrl = candidate.finalUrl || candidate.canonicalUrl || candidate.resultUrl || '';
  const names = [companyEntity.canonicalName, companyEntity.legalName, ...(companyEntity.brandNames || []), ...(companyEntity.englishNames || [])].map(clean).filter((name) => name.length >= 2);
  const pageBlob = clean(`${page.title || ''} ${page.h1 || ''} ${page.displayedCompany || ''} ${page.legalEntity || ''} ${page.footerEntity || ''}`);
  if ((companyEntity.officialCorporateDomains || []).some((domain) => matchesDomain(finalUrl, domain))) strongEvidence.push('official_registry_domain');
  if (candidate.autoOfficialDomain === true) strongEvidence.push('auto_verified_corporate_domain');
  if (candidate.officialSiteLinked === true || page.officialSiteLinked === true) strongEvidence.push('official_site_links_surface');
  if (candidate.manualTenantRegistryHit === true || registeredSurface?.identityStatus === 'VERIFIED') strongEvidence.push('verified_surface_registry');
  if (candidate.officialAnnouncementListed === true) strongEvidence.push('official_announcement_lists_url');
  const legalEntity = clean(page.legalEntity);
  if (page.legalEntityMatched === true || (legalEntity && names.some((name) => legalEntity === name))) strongEvidence.push('legal_entity_match');
  if (names.some((name) => pageBlob.includes(name))) mediumEvidence.push('page_company_name_match');
  if (page.logoMatched) mediumEvidence.push('logo_match');
  if (page.jobContentMatched) mediumEvidence.push('job_content_match');
  if (page.tenantKeyMatched) mediumEvidence.push('tenant_key_match');
  if (page.icpRelationshipMatched) mediumEvidence.push('icp_relationship_match');
  if ((candidate.providerConsensus || []).length >= 2) mediumEvidence.push('multi_provider_recall');
  if (page.identityConflict) riskSignals.push('identity_conflict');
  const blocked = vacancyStatus === 'BLOCKED' || [401, 403, 429].includes(Number(page.httpStatus)) || Boolean(page.blockedReason);
  const highRisk = [...new Set(riskSignals)].filter((signal) => HIGH_RISK_CODES.has(signal));
  const recruitmentSemantics = page.recruitmentSemantics === true || ['CAREER_HOME', 'CAMPAIGN', 'JOB_LIST', 'JOB_DETAIL', 'APPLY'].includes(pageRole);
  let verdict = 'UNVERIFIED', identityStatus = 'UNVERIFIED', reviewStatus = 'QUEUED';
  const reasonCodes = [];
  if (blocked) { verdict = 'BLOCKED'; identityStatus = strongEvidence.length ? 'PROBABLE' : 'UNVERIFIED'; reasonCodes.push('blocked_requires_manual_review'); }
  else if (highRisk.includes('identity_conflict')) { verdict = 'REJECT'; identityStatus = 'REJECTED'; reviewStatus = 'AUTO_ACCEPTED'; reasonCodes.push('company_identity_conflict'); }
  else if (highRisk.length) { verdict = 'REJECT'; identityStatus = 'REJECTED'; reviewStatus = 'AUTO_ACCEPTED'; reasonCodes.push('high_risk_signal'); }
  else if (strongEvidence.length && page.reachable !== false && recruitmentSemantics) {
    identityStatus = 'VERIFIED'; reviewStatus = 'AUTO_ACCEPTED';
    verdict = ['JOB_LIST', 'JOB_DETAIL', 'APPLY'].includes(pageRole) && vacancyStatus === 'ACTIVE' ? 'AUTO_ACCEPT' : 'AUTO_ACCEPT_WITH_LIMITED_ROLE';
    reasonCodes.push(verdict === 'AUTO_ACCEPT' ? 'strong_identity_and_active_entry' : 'strong_identity_limited_page_role');
  } else if (mediumEvidence.length >= 2 || blocked) { verdict = 'MANUAL_REVIEW'; identityStatus = 'PROBABLE'; reasonCodes.push('multiple_medium_identity_signals'); }
  else reasonCodes.push('insufficient_strong_identity_evidence');
  return { verdict, identityStatus, pageRole, vacancyStatus, reviewStatus, strongEvidence, mediumEvidence, riskSignals: [...new Set(riskSignals)], reasonCodes, registrableDomain: registrableDomainOf(finalUrl) };
}
