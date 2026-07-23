import { humanizeSlug, locationText, safeSegment } from './_helpers.mjs';

export default {
  id: 'ashby',
  match(url) {
    if (url.hostname !== 'jobs.ashbyhq.com') return null;
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)/);
    if (!match || !safeSegment(match[1]) || !safeSegment(match[2])) return null;
    return { company: match[1], id: match[2] };
  },
  apiUrl: ({ company }) => `https://api.ashbyhq.com/posting-api/job-board/${company}`,
  isMissing(json, context) {
    return Array.isArray(json.jobs)
      && !json.jobs.some((item) => String(item.id).toLowerCase() === context.match.id.toLowerCase());
  },
  parse(json, context) {
    const job = Array.isArray(json.jobs) ? json.jobs.find((item) => String(item.id).toLowerCase() === context.match.id.toLowerCase()) : null;
    if (!job) return null;
    return {
      jobId: job.id, title: job.title, company: json.organizationName || humanizeSlug(context.match.company),
      location: locationText(job.location || job.secondaryLocations), description: job.descriptionHtml || job.descriptionPlain || '',
      postedAt: job.publishedAt || null, applyUrl: job.applyUrl || context.originalUrl,
    };
  },
};
