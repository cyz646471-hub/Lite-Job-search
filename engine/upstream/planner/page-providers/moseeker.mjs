import { parseCnAtsPage } from './_cn-ats.mjs';

export default {
  id: 'moseeker',
  priority: 55,
  match: (url) => /(^|\.)moseeker\.(?:com|cn)$/i.test(url.hostname),
  parse: (html, context) => parseCnAtsPage(html, { ...context, vendor: 'MOSEEKER' }),
};
