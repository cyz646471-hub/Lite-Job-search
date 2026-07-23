import { parseJobPostingJsonLd } from './_jsonld.mjs';

export default {
  id: 'teamtailor',
  priority: 100,
  match: (url) => /(^|\.)teamtailor\.com$/i.test(url.hostname),
  parse: (html, context) => parseJobPostingJsonLd(html, context.finalUrl),
};
