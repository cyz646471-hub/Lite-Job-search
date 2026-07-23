import { humanizeSlug, locationText, safeSegment } from './_helpers.mjs';

export default {
  id: 'greenhouse',
  match(url) {
    if (!url.hostname.endsWith('greenhouse.io')) return null;
    const match = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (!match || !safeSegment(match[1]) || !safeSegment(match[2])) return null;
    return { board: match[1], id: match[2] };
  },
  apiUrl: ({ board, id }) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`,
  parse(json, context) {
    return {
      jobId: json.id, title: json.title, company: json.company_name || humanizeSlug(context.match.board), location: locationText(json.location?.name),
      description: json.content || '', postedAt: json.updated_at || null, applyUrl: json.absolute_url || context.originalUrl,
    };
  },
};
