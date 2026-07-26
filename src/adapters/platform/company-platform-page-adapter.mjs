import {
  classifyRecruitmentSource,
} from '../../verification/recruitment-source-policy.mjs';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function normalizeLocations(job = {}) {
  return [...new Set([
    ...(Array.isArray(job.locations) ? job.locations : []),
    job.location,
  ].map(clean).filter(Boolean))];
}

function explicitJobs(page = {}) {
  if (Array.isArray(page.jobs)) return page.jobs;
  if (Array.isArray(page.parsed?.jobs)) return page.parsed.jobs;
  return (page.links || [])
    .filter((link) => (
      clean(link?.text)
      && /\/(?:job|job_detail|position|positions)\//i.test(String(link?.href || ''))
      && !/查看(?:全部)?职位|更多职位|jobs?|positions?/i.test(clean(link.text))
    ))
    .map((link) => ({
      title: link.text,
      detailUrl: link.href,
    }));
}

function extractPublicCompanyJobs(page = {}) {
  const sourcePageUrl = cleanUrl(page.finalUrl || page.url);
  const seen = new Set();
  const jobs = [];
  for (const job of explicitJobs(page)) {
    const title = clean(job?.title);
    const detailUrl = cleanUrl(job?.detailUrl || job?.jobDetailUrl || job?.url);
    const sourceUrl = detailUrl || cleanUrl(job?.sourceUrl) || sourcePageUrl;
    if (!title || !sourceUrl) continue;
    const key = `${title.toLowerCase()}|${sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(Object.freeze({
      title,
      locations: Object.freeze(normalizeLocations(job)),
      publishedAt: job.publishedAt || null,
      closesAt: job.closesAt || null,
      jobDetailUrl: detailUrl,
      sourceUrl,
    }));
  }
  return Object.freeze(jobs);
}

export function inspectPlatformCompanyPage({
  company,
  page = {},
  platform,
} = {}) {
  const status = Number(page.status || 0);
  const reachable = status >= 200 && status < 400
    && !['BLOCKED', 'FAILED'].includes(page.fetchStatus);
  const finalUrl = page.finalUrl || page.url || '';
  const identityTitles = [page.h1, page.title].map(clean).filter(Boolean);
  const platformDecision = identityTitles
    .map((title) => classifyRecruitmentSource({
      url: finalUrl,
      company,
      title,
      kind: 'organic',
    }))
    .find((decision) => (
      decision.decision === 'PLATFORM_CANDIDATE'
      && decision.platform === String(platform || '').toUpperCase()
    ));
  const platformIdentityConfirmed = Boolean(reachable && platformDecision);
  const jobs = platformIdentityConfirmed
    ? extractPublicCompanyJobs(page)
    : Object.freeze([]);

  return Object.freeze({
    sourceTier: 'PLATFORM_ONLY',
    platform: String(platform || platformDecision?.platform || '').toUpperCase(),
    verificationStatus: 'REVIEW',
    officialIdentityConfirmed: false,
    platformIdentityConfirmed,
    confidenceScore: platformIdentityConfirmed && jobs.length ? 49 : 0,
    hiringAvailability: jobs.length ? 'OPENINGS_FOUND' : 'UNKNOWN',
    jobs,
  });
}
