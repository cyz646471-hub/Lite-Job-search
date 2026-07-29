import { parseCnAtsPage } from './_cn-ats.mjs';

export default {
  id: 'beisen-italent',
  priority: 55,
  match: (url) => /(^|\.)(?:beisen\.com|beisencloud\.com|italent\.cn)$/i.test(url.hostname),
  parse: (html, context) => parseCnAtsPage(html, { ...context, vendor: 'BEISEN' }),
};
