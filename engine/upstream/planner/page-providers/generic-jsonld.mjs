import { parseBasicJobPage, parseJobPostingJsonLd } from './_jsonld.mjs';

export default {
  id: 'generic-jsonld',
  priority: -100,
  match: (url) => url.protocol === 'https:',
  parse: (html, context) => parseJobPostingJsonLd(html, context.finalUrl) || parseBasicJobPage(html, context.finalUrl),
};
