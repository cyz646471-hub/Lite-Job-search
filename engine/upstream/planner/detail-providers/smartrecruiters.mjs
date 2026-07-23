import { humanizeSlug, locationText, safeSegment } from './_helpers.mjs';

export default {
  id: 'smartrecruiters',
  source: 'SmartRecruiters',
  match(url) {
    if (!url.hostname.endsWith('smartrecruiters.com')) return null;
    const match = url.pathname.match(/^\/([^/]+)\/(\d+)-/);
    if (!match || !safeSegment(match[1]) || !safeSegment(match[2])) return null;
    return { company: match[1], id: match[2] };
  },
  apiUrl: ({ company, id }) => `https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`,
  parse(json, context) {
    return {
      jobId: json.id, title: json.name, company: json.company?.name || humanizeSlug(context.match.company), location: locationText(json.location),
      description: [json.jobAd?.sections?.jobDescription?.text, json.jobAd?.sections?.qualifications?.text, json.jobAd?.sections?.additionalInformation?.text].filter(Boolean).join('\n'),
      postedAt: json.releasedDate || null, applyUrl: json.applyUrl || context.originalUrl,
    };
  },
};
