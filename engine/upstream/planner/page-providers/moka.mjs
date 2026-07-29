import { parseCnAtsPage } from './_cn-ats.mjs';

export default {
  id: 'moka',
  priority: 50,
  match: (url) => /(^|\.)mokahr\.(?:com|cn)$/i.test(url.hostname),
  parse: (html, context) => parseCnAtsPage(html, { ...context, vendor: 'MOKA' }),
};
