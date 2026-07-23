import { createJobResult } from '../../core/contracts.mjs';

function roleUrls(portal = {}) {
  const url = portal.canonicalUrl || portal.url || null;
  return {
    companyCareerHomeUrl: portal.pageType === 'CAREER_HOME' ? url : null,
    campaignLandingUrl: portal.pageType === 'CAMPAIGN' ? url : null,
    jobListUrl: portal.pageType === 'JOB_LIST' ? url : null,
    jobDetailUrl: portal.pageType === 'JOB_DETAIL' ? url : null,
    applyUrl: portal.pageType === 'APPLY' ? url : null,
  };
}

export function toLegacyJobResult({
  company = {},
  portal = {},
  opening = {},
} = {}) {
  return createJobResult({
    market: company.market,
    company: company.canonicalName,
    title: opening.title,
    location: (opening.locations || []).join(', '),
    employmentType: opening.employmentType,
    publishedAt: opening.publishedAt,
    source: opening.source || portal.atsType || null,
    sourceUrl: opening.sourceUrl || portal.canonicalUrl,
    ...roleUrls(portal),
    officialIdentityConfirmed: portal.verificationStatus === 'VERIFIED',
    campaignConfirmed: portal.pageType === 'CAMPAIGN',
    hasJobList: portal.pageType === 'JOB_LIST',
    hasApplicationAction: portal.pageType === 'APPLY',
    applicationActive: opening.status === 'ACTIVE',
    evidence: portal.evidence || [],
  });
}
