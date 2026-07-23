import { detectAtsFingerprint } from '../../../engine/upstream/planner/cn-ats-fingerprint.mjs';
import { evaluateCandidateIdentity } from '../../../engine/upstream/planner/cn-identity-verifier.mjs';
import { classifySurfacePage } from '../../../engine/upstream/planner/cn-surface-drill.mjs';
import { registrableDomainOf } from '../../../engine/upstream/planner/cn-url-evidence.mjs';
import { classifyRecruitmentUrl } from '../../../engine/upstream/planner/official-links.mjs';

const UNIVERSITY_HOSTS = ['ncss.cn', '91wllm.cn', '91wllm.com'];

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function hardNegativeCode(url, page = {}) {
  const host = hostOf(url);
  const blob = `${url} ${page.title || ''} ${page.html || page.body || ''}`.slice(0, 20_000);
  if (UNIVERSITY_HOSTS.some((domain) => hostMatches(host, domain)) || /\.edu\.cn$/i.test(host)) {
    return 'university_employment_site';
  }
  if (/培训|课程|训练营|付费内推|求职辅导|career coaching|bootcamp/i.test(blob)) {
    return 'training_provider';
  }
  if (/\/(?:news|article|media|press)(?:\/|$)|新闻|转载|媒体报道/i.test(blob)) {
    return 'news_reprint';
  }
  if (classifyRecruitmentUrl(url).channel === 'discovery_index') return 'aggregator_domain';
  return '';
}

function pageText(page) {
  return String(page.html || page.body || page.text || '');
}

function titleOf(html) {
  return String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';
}

export function createOfficialVerificationAdapter({
  detectAts = detectAtsFingerprint,
  classifyPage = classifySurfacePage,
  evaluateIdentity = evaluateCandidateIdentity,
  now = () => new Date().toISOString(),
} = {}) {
  return Object.freeze({
    async inspect({
      company = {},
      candidate = {},
      page = {},
    } = {}) {
      const finalUrl = page.finalUrl || page.url || candidate.url || '';
      const html = pageText(page);
      const classified = classifyPage({
        url: finalUrl,
        html,
        status: page.status,
        parsed: page.parsed,
      }) || { pageRole: 'UNKNOWN', vacancyStatus: 'UNKNOWN', links: [] };
      const ats = detectAts({
        url: finalUrl,
        html,
        cookies: page.cookies || [],
        requests: page.requests || [],
      }) || { ats: '', confidence: 0 };
      const identity = evaluateIdentity({
        companyEntity: {
          canonicalName: company.canonicalName,
          brandNames: [company.canonicalName, ...(company.aliases || [])].filter(Boolean),
          officialCorporateDomains: company.officialDomains || [],
        },
        candidate: {
          ...candidate,
          finalUrl,
          autoOfficialDomain: false,
        },
        page: {
          reachable: Number(page.status || 200) < 400,
          httpStatus: page.status || 200,
          title: page.title || titleOf(html),
          h1: page.h1 || '',
          recruitmentSemantics: classified.pageRole !== 'UNKNOWN',
          jobContentMatched: ['JOB_LIST', 'JOB_DETAIL', 'APPLY'].includes(classified.pageRole),
          officialSiteLinked: page.officialSiteLinked === true,
          riskSignals: page.riskSignals || [],
        },
        pageRole: classified.pageRole,
        vacancyStatus: classified.vacancyStatus,
      }) || {};

      const evidence = [];
      const seen = new Set();
      const push = (code, observedValue = null) => {
        if (!code || seen.has(code)) return;
        seen.add(code);
        evidence.push({
          code,
          observedValue,
          sourceUrl: finalUrl || null,
          observedAt: now(),
        });
      };

      push(hardNegativeCode(finalUrl, { ...page, html }));
      if ((identity.riskSignals || []).includes('identity_conflict')) {
        push('company_identity_conflict');
      }
      if ((identity.riskSignals || []).some((item) => [
        'personal_form_or_cloud_drive',
        'payment_or_private_contact_risk',
      ].includes(item))) {
        push('private_or_payment_risk');
      }

      const finalDomain = registrableDomainOf(finalUrl);
      const officialDomainMatch = (company.officialDomains || [])
        .map(registrableDomainOf)
        .filter(Boolean)
        .includes(finalDomain);
      if (officialDomainMatch) push('official_domain_match', finalDomain);
      else push('candidate_self_domain', finalDomain);

      if (ats.ats) {
        const tenantVerified = candidate.verifiedTenant === true
          || (identity.strongEvidence || []).includes('verified_surface_registry');
        push(tenantVerified ? 'verified_ats_tenant' : 'ats_fingerprint_only', ats.ats);
      }
      if (classified.pageRole !== 'UNKNOWN') push('recruitment_structure', classified.pageRole);
      if (
        classified.pageRole === 'APPLY'
        || page.parsed?.applyUrl
        || candidate.applyUrl
        || /立即(?:申请|投递)|apply now|submit application/i.test(html)
      ) {
        push('apply_action');
      }
      if (
        candidate.officialSiteLinked === true
        || page.officialSiteLinked === true
        || (identity.strongEvidence || []).includes('official_site_links_surface')
      ) {
        push('official_site_backlink');
      }
      if ((identity.strongEvidence || []).includes('legal_entity_match')) push('legal_entity_match');
      if ((identity.strongEvidence || []).includes('official_announcement_lists_url')) {
        push('official_announcement_lists_url');
      }
      if (
        classified.vacancyStatus === 'BLOCKED'
        || [401, 403, 429].includes(Number(page.status))
      ) {
        push('blocked_page');
      }

      return Object.freeze({
        pageType: classified.pageRole || 'UNKNOWN',
        vacancyStatus: classified.vacancyStatus || 'UNKNOWN',
        atsType: ats.ats || '',
        registrableDomain: finalDomain,
        evidence: Object.freeze(evidence),
      });
    },
  });
}
