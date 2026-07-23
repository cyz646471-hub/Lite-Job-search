import { parseCnAtsPage } from './_cn-ats.mjs';

export default {
  id: 'hotjob',
  priority: 50,
  match: (url) => /(^|\.)(wecruit\.)?hotjob\.cn$/i.test(url.hostname),
  parse: (html, context) => parseCnAtsPage(html, { ...context, vendor: 'HOTJOB' }),
};
