import { humanizeSlug, locationText, safeSegment } from './_helpers.mjs';

function match(url) {
  const host = url.hostname.match(/^([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com$/i);
  if (!host) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (/^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || '')) parts.shift();
  const site = parts.shift();
  if (!site || parts[0] !== 'job' || !safeSegment(host[1]) || !safeSegment(site)) return null;
  return { origin: url.origin, tenant: host[1], site, externalPath: `/${parts.join('/')}` };
}

export default {
  id: 'workday',
  match,
  apiUrl: ({ origin, tenant, site, externalPath }) => `${origin}/wday/cxs/${tenant}/${site}${externalPath}`,
  parse(json, context) {
    const job = json?.jobPostingInfo || json;
    if (!job || !job.title) return null;
    return {
      jobId: job.jobReqId || job.id || '',
      title: job.title,
      company: job.company || humanizeSlug(context.match.tenant),
      location: locationText(job.location || job.additionalLocations),
      description: job.jobDescription || job.description || '',
      postedAt: job.startDate || null,
      expiresAt: job.endDate || null,
      applyUrl: job.externalUrl || context.originalUrl,
      sourceUrl: context.originalUrl,
    };
  },
};
