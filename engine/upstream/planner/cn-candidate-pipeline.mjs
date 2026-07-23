import { evaluateCandidateIdentity } from './cn-identity-verifier.mjs';
import { assessCandidatePageIdentity } from './cn-official-link-governance.mjs';
import { upsertRecruitmentSurface } from './cn-recruitment-knowledge.mjs';
import { classifySurfacePage } from './cn-surface-drill.mjs';
import { registrableDomainOf, resolveCandidateUrl } from './cn-url-evidence.mjs';
import { resolvePageProvider } from './page-providers/_registry.mjs';

const cleanText = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const first = (html, pattern) => cleanText(String(html || '').match(pattern)?.[1] || '');
const NON_CORPORATE_DISCOVERY_DOMAINS = new Set(['nowcoder.com', 'gankinterview.cn', 'gankinterview.com', 'langlangwangshen.com', 'niuqizp.com', 'yingjiesheng.com', 'shixiseng.com', 'bosszhipin.com', 'zhipin.com', 'liepin.com', 'zhaopin.com', '51job.com', 'lagou.com', 'ncss.cn', '91wllm.cn', '91wllm.com', 'linkedin.com']);

function canAutoRegisterCorporateDomain(finalUrl, vendor, resolved = {}) {
  const root = registrableDomainOf(finalUrl);
  if (!root || vendor !== 'SELF_HOSTED' || NON_CORPORATE_DISCOVERY_DOMAINS.has(root)) return false;
  if (root.endsWith('.edu.cn') || root.endsWith('.edu.hk') || root.endsWith('.gov.cn')) return false;
  return resolved.status === 'RESOLVED' && Number(resolved.httpStatus || 200) < 400 && !(resolved.riskSignals || []).length;
}

function vendorFor(url, parsed = {}, provider = null) {
  const value = `${provider?.id || ''} ${parsed?.vendor || ''} ${url}`.toLowerCase();
  if (/moka|mokahr/.test(value)) return 'MOKA';
  if (/feishu|飞书/.test(value)) return 'FEISHU';
  if (/zhiye|beisen|北森/.test(value)) return 'BEISEN';
  if (/hotjob/.test(value)) return 'HOTJOB';
  if (/workday/.test(value)) return 'WORKDAY';
  if (/greenhouse/.test(value)) return 'GREENHOUSE';
  if (/smartrecruiters/.test(value)) return 'SMARTRECRUITERS';
  return 'SELF_HOSTED';
}

function pageEvidence(html, resolved, parsed, classified) {
  const text = cleanText(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
  const legalEntity = parsed?.legalOrPrivacyEntity || parsed?.legalEntity || first(html, /(?:©|版权所有|copyright)[^<]{0,80}([^<]{2,80}(?:有限公司|集团|公司))/i);
  return {
    title: first(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i),
    h1: first(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i),
    displayedCompany: parsed?.displayedCompany || '', legalEntity,
    footerEntity: legalEntity, tenantKey: parsed?.tenantKey || '',
    tenantKeyMatched: parsed?.tenantKeyMatched === true,
    legalEntityMatched: parsed?.legalEntityMatched === true,
    logoMatched: parsed?.logoMatched === true,
    jobContentMatched: parsed?.jobCount > 0 || (parsed?.activeJobs || []).length > 0 || /岗位职责|任职要求|招聘职位|职位列表|open positions|responsibilit|qualification/i.test(text),
    recruitmentSemantics: (parsed?.pageRole && parsed.pageRole !== 'UNKNOWN') || /招聘|职位|岗位|人才|校招|社招|实习|career|jobs?|apply/i.test(text),
    reachable: resolved.status === 'RESOLVED' && Number(resolved.httpStatus || 200) < 400,
    httpStatus: resolved.httpStatus || null,
    blockedReason: resolved.status === 'BLOCKED' ? resolved.reasonCode : null,
    riskSignals: resolved.riskSignals || [],
  };
}

function scopesFor(parsed = {}) {
  const values = parsed.recruitmentScope || parsed.recruitmentChannels || [];
  return [...new Set((Array.isArray(values) ? values : [values]).map((item) => String(item || '').toUpperCase()).filter(Boolean))];
}

export function selectPendingSearchCandidates(candidates = [], {
  companyEntityIds = [],
  recheck = false,
} = {}) {
  const selectedCompanies = new Set((companyEntityIds || []).filter(Boolean));
  return candidates.filter((candidate) => {
    if (selectedCompanies.size && !selectedCompanies.has(candidate.companyEntityId)) return false;
    if (['AUTO_ACCEPT', 'AUTO_ACCEPT_WITH_LIMITED_ROLE', 'REJECT', 'REJECTED'].includes(candidate.verdict)) return false;
    if (!recheck && candidate.lastCheckedAt) return false;
    return true;
  });
}

export async function processSearchCandidates(knowledgeBase, {
  candidates = knowledgeBase.searchCandidates || [], resolveUrl = resolveCandidateUrl,
  resolveProvider = resolvePageProvider, renderPage = null, allowBrowserRender = () => false, now = Date.now(), maxCandidates = candidates.length,
} = {}) {
  const metrics = { processed: 0, autoAccepted: 0, limitedAccepted: 0, manualReview: 0, unverified: 0, blocked: 0, rejected: 0, skipped: 0 };
  const results = [];
  for (const candidate of candidates.slice(0, Math.max(0, maxCandidates))) {
    if (['AUTO_ACCEPT', 'AUTO_ACCEPT_WITH_LIMITED_ROLE', 'REJECT', 'REJECTED'].includes(candidate.verdict)) { metrics.skipped++; continue; }
    const companyEntity = (knowledgeBase.companyEntities || []).find((item) => item.id === candidate.companyEntityId);
    if (!companyEntity) { candidate.verdict = 'REJECTED'; candidate.rejectionReason = 'company_entity_not_found'; metrics.rejected++; continue; }
    let resolved;
    try { resolved = await resolveUrl(candidate.resultUrl || candidate.finalUrl); }
    catch { resolved = { status: 'BLOCKED', reasonCode: 'url_resolution_error', finalUrl: candidate.resultUrl, redirectChain: [], riskSignals: [] }; }
    let finalUrl = resolved.finalUrl || candidate.resultUrl || candidate.finalUrl;
    let html = resolved.body || '';
    let provider = null, parsed = null;
    try {
      provider = await resolveProvider(finalUrl);
      parsed = provider?.parse ? await provider.parse(html, { requestedUrl: candidate.resultUrl, finalUrl, vendor: provider.id }) : null;
    } catch { parsed = null; }
    let classified = classifySurfacePage({ url: finalUrl, html, status: resolved.httpStatus || (resolved.status === 'BLOCKED' ? 403 : 200), parsed });
    if (renderPage && allowBrowserRender({ url: finalUrl, companyEntity, candidate, knowledgeBase }) && resolved.status === 'RESOLVED' && (cleanText(html).length < 200 || classified.pageRole === 'UNKNOWN')) {
      try {
        const rendered = await renderPage(finalUrl);
        const renderedHtml = rendered?.html ?? (typeof rendered?.text === 'function' ? await rendered.text() : '');
        if (renderedHtml) {
          html = renderedHtml; finalUrl = rendered.url || rendered.finalUrl || finalUrl;
          resolved = { ...resolved, finalUrl, canonicalUrl: finalUrl, httpStatus: rendered.status || resolved.httpStatus, body: html };
          provider = await resolveProvider(finalUrl); parsed = provider?.parse ? await provider.parse(html, { requestedUrl: candidate.resultUrl, finalUrl, vendor: provider.id }) : null;
          classified = classifySurfacePage({ url: finalUrl, html, status: resolved.httpStatus || 200, parsed });
        }
      } catch { /* preserve the HTTP evidence and route unresolved SPA shells to review */ }
    }
    const vendor = vendorFor(finalUrl, parsed, provider);
    const page = pageEvidence(html, resolved, parsed, classified);
    const automaticDomainAssessment = canAutoRegisterCorporateDomain(finalUrl, vendor, resolved)
      ? assessCandidatePageIdentity(companyEntity.canonicalName, html, finalUrl)
      : { passed: false, identitySignals: [], recruitmentSignal: false };
    let evaluation = evaluateCandidateIdentity({ companyEntity, candidate: { ...candidate, finalUrl, autoOfficialDomain: automaticDomainAssessment.passed, domainRiskSignals: resolved.riskSignals || [] }, page, pageRole: classified.pageRole, vacancyStatus: classified.vacancyStatus });
    const registeredTenant = vendor !== 'SELF_HOSTED' && parsed?.tenantKey && (knowledgeBase.recruitmentSurfaces || []).some((surface) => surface.identityStatus === 'VERIFIED' && !surface.validTo && surface.vendor === vendor && surface.tenantKey === parsed.tenantKey && surface.companyEntityIds.includes(companyEntity.id));
    const atsRelationshipConfirmed = registeredTenant || candidate.manualTenantRegistryHit === true || candidate.officialSiteLinked === true;
    if (vendor !== 'SELF_HOSTED' && (!parsed?.tenantKey || !atsRelationshipConfirmed) && ['AUTO_ACCEPT', 'AUTO_ACCEPT_WITH_LIMITED_ROLE'].includes(evaluation.verdict)) {
      evaluation = { ...evaluation, verdict: 'MANUAL_REVIEW', identityStatus: 'PROBABLE', reviewStatus: 'QUEUED', reasonCodes: [...evaluation.reasonCodes, !parsed?.tenantKey ? 'ats_tenant_key_not_confirmed' : 'ats_tenant_company_relationship_not_confirmed'] };
    }
    Object.assign(candidate, {
      finalUrl, canonicalUrl: resolved.canonicalUrl || finalUrl, registrableDomain: resolved.registrableDomain || registrableDomainOf(finalUrl),
      redirectChain: resolved.redirectChain || [], domainRiskSignals: [...new Set(resolved.riskSignals || [])],
      identityEvidence: [...new Set([...evaluation.strongEvidence, ...evaluation.mediumEvidence])], roleEvidence: [classified.pageState],
      verdict: evaluation.verdict, rejectionReason: ['REJECT', 'REJECTED'].includes(evaluation.verdict) ? evaluation.reasonCodes.join(',') : null,
      autoOfficialDomain: automaticDomainAssessment.passed,
      autoOfficialDomainEvidence: automaticDomainAssessment.identitySignals,
      lastCheckedAt: now, pageTitle: page.title, pageH1: page.h1, displayedCompany: page.displayedCompany,
      legalOrPrivacyEntity: page.legalEntity, tenantKey: parsed?.tenantKey || '', pageRole: classified.pageRole, vacancyStatus: classified.vacancyStatus,
    });
    let surface = null;
    if (['AUTO_ACCEPT', 'AUTO_ACCEPT_WITH_LIMITED_ROLE'].includes(evaluation.verdict)) {
      if (automaticDomainAssessment.passed) companyEntity.officialCorporateDomains = [...new Set([...(companyEntity.officialCorporateDomains || []), candidate.registrableDomain])];
      surface = upsertRecruitmentSurface(knowledgeBase, {
        vendor, tenantKey: parsed?.tenantKey || '', canonicalUrl: finalUrl,
        registrableDomain: candidate.registrableDomain, companyEntityIds: [companyEntity.id], scope: scopesFor(parsed).length ? scopesFor(parsed) : ['GENERAL'],
        identityStatus: 'VERIFIED', identityEvidence: evaluation.strongEvidence.map((code) => ({ code, candidateId: candidate.id, url: finalUrl })),
        lastVerifiedAt: now, lastSuccessfulFetchAt: resolved.status === 'RESOLVED' ? now : null,
      }, { now });
      if (evaluation.verdict === 'AUTO_ACCEPT') metrics.autoAccepted++; else metrics.limitedAccepted++;
    } else if (evaluation.verdict === 'BLOCKED') metrics.blocked++;
    else if (evaluation.verdict === 'MANUAL_REVIEW') metrics.manualReview++;
    else if (['REJECT', 'REJECTED'].includes(evaluation.verdict)) metrics.rejected++;
    else metrics.unverified++;
    metrics.processed++;
    results.push({ candidateId: candidate.id, companyEntityId: companyEntity.id, verdict: evaluation.verdict, pageRole: classified.pageRole, vacancyStatus: classified.vacancyStatus, finalUrl, surfaceId: surface?.id || null, reasonCodes: evaluation.reasonCodes });
  }
  knowledgeBase.updatedAt = now;
  return { ...metrics, results };
}
