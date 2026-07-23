import { createJobResult } from '../core/contracts.mjs';
import {
  classifySurfacePage,
} from '../../engine/upstream/planner/cn-surface-drill.mjs';
import {
  evaluateCandidateIdentity,
} from '../../engine/upstream/planner/cn-identity-verifier.mjs';
import { registrableDomainOf } from '../../engine/upstream/planner/cn-url-evidence.mjs';

function textOf(html, tag) {
  return String(html || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';
}

function roleUrls(role, url) {
  return {
    companyCareerHomeUrl: role === 'CAREER_HOME' ? url : null,
    campaignLandingUrl: role === 'CAMPAIGN' ? url : null,
    jobListUrl: role === 'JOB_LIST' ? url : null,
    jobDetailUrl: role === 'JOB_DETAIL' ? url : null,
    applyUrl: role === 'APPLY' ? url : null,
  };
}

export async function verifyCandidates(candidates = [], { fetchPage } = {}) {
  if (typeof fetchPage !== 'function') throw new Error('fetchPage is required');
  const output = [];
  for (const candidate of candidates) {
    const page = await fetchPage(candidate.url, candidate);
    const finalUrl = page.finalUrl || page.url || candidate.url;
    const classified = classifySurfacePage({
      url: finalUrl,
      html: page.html || page.body || '',
      status: page.status,
      parsed: page.parsed,
    });
    const officialDomain = candidate.officialDomain || registrableDomainOf(finalUrl);
    const identity = evaluateCandidateIdentity({
      companyEntity: {
        canonicalName: candidate.company,
        brandNames: [candidate.company],
        officialCorporateDomains: officialDomain ? [officialDomain] : [],
      },
      candidate: {
        ...candidate,
        finalUrl,
        autoOfficialDomain: Boolean(officialDomain),
      },
      page: {
        reachable: Number(page.status || 200) < 400,
        httpStatus: page.status || 200,
        title: textOf(page.html, 'title'),
        h1: textOf(page.html, 'h1'),
        recruitmentSemantics: classified.pageRole !== 'UNKNOWN',
        jobContentMatched: ['JOB_LIST', 'JOB_DETAIL', 'APPLY'].includes(classified.pageRole),
      },
      pageRole: classified.pageRole,
      vacancyStatus: classified.vacancyStatus,
    });
    output.push(createJobResult({
      market: candidate.market,
      company: candidate.company,
      title: candidate.jobTitle || '',
      location: candidate.location || '',
      source: candidate.source,
      sourceUrl: candidate.sourceUrl || candidate.url,
      ...roleUrls(classified.pageRole, finalUrl),
      officialIdentityConfirmed: identity.identityStatus === 'VERIFIED',
      campaignConfirmed: classified.pageRole === 'CAMPAIGN',
      hasJobList: classified.pageRole === 'JOB_LIST',
      hasApplicationAction: classified.pageRole === 'APPLY',
      applicationActive: classified.vacancyStatus === 'ACTIVE',
      evidence: [{
        pageRole: classified.pageRole,
        vacancyStatus: classified.vacancyStatus,
        identity,
      }],
    }));
  }
  return output;
}

