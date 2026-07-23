import { parseCnAtsPage } from './_cn-ats.mjs';

export default {
  id: 'feishu-jobs',
  priority: 50,
  match: (url) => /(^|\.)jobs\.feishu\.cn$/i.test(url.hostname),
  parse: (html, context) => parseCnAtsPage(html, { ...context, vendor: 'FEISHU' }),
};
