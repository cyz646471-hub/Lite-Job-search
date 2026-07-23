import { humanizeSlug, locationText, safeSegment } from './_helpers.mjs';

export default {
  id: 'lever',
  match(url) {
    if (!/^jobs\.(?:eu\.)?lever\.co$/.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)/);
    if (!match || !safeSegment(match[1]) || !safeSegment(match[2])) return null;
    return { company: match[1], id: match[2], apiHost: url.hostname.includes('.eu.') ? 'api.eu.lever.co' : 'api.lever.co' };
  },
  apiUrl: ({ apiHost, company, id }) => `https://${apiHost}/v0/postings/${company}/${id}`,
  parse(json, context) {
    const sections = Array.isArray(json.lists) ? json.lists.map((item) => `${item.text || ''}\n${item.content || ''}`) : [];
    return {
      jobId: json.id, title: json.text, company: humanizeSlug(context.match.company),
      location: locationText(json.categories?.location || json.workplaceType),
      description: [json.descriptionPlain || json.description, ...sections, json.additionalPlain || json.additional]
        .filter(Boolean).join('\n'),
      postedAt: json.createdAt || null,
      applyUrl: json.applyUrl || json.hostedUrl || context.originalUrl,
    };
  },
};
