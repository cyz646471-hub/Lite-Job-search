import { parseCnAtsPage } from './_cn-ats.mjs';

export default {
  id: 'zhiye',
  priority: 50,
  match: (url) => /(^|\.)zhiye\.com$/i.test(url.hostname),
  parse: (html, context) => parseCnAtsPage(html, { ...context, vendor: 'BEISEN' }),
};
