const FINGERPRINTS = Object.freeze([
  { name: 'Lever', domains: ['jobs.lever.co'], html: ['lever.co'], api: ['/v0/postings/'] },
  { name: 'Greenhouse', domains: ['greenhouse.io'], html: ['greenhouse'], api: ['/v1/boards/'] },
  { name: 'Workday', domains: ['myworkdayjobs.com'], html: ['workday'], api: ['/wday/cxs/'] },
  { name: 'Ashby', domains: ['ashbyhq.com'], html: ['ashby'], api: ['/api/non-user-graphql'] },
  { name: 'SAP SuccessFactors', domains: ['successfactors.com'], html: ['successfactors'], api: ['/careers?company='] },
  { name: 'MOKA', domains: ['mokahr.com', 'mokahr.cn'], html: ['mokahr'], api: ['/api/'] },
  { name: 'Beisen', domains: ['beisen.com', 'beisencloud.com'], html: ['beisen'], api: ['/api/'] },
  { name: 'HOTJOB', domains: ['hotjob.cn'], html: ['hotjob'], api: ['/api/'] },
  { name: 'Zhiye', domains: ['zhiye.com'], html: ['zhiye'], api: ['/api/'] },
]);
export function detectAtsFingerprint({ url = '', html = '', cookies = [], requests = [] } = {}) {
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  const evidence = `${html}\n${cookies.join('\n')}\n${requests.join('\n')}`.toLowerCase();
  for (const fingerprint of FINGERPRINTS) {
    const domain = fingerprint.domains.some((value) => host === value || host.endsWith(`.${value}`));
    const htmlMatch = fingerprint.html.some((value) => evidence.includes(value));
    const apiMatch = fingerprint.api.some((value) => evidence.includes(value));
    if (domain || (htmlMatch && apiMatch)) return { ats: fingerprint.name, confidence: domain ? 1 : 0.8, evidence: domain ? `domain:${host}` : 'html/api fingerprint' };
  }
  return { ats: '', confidence: 0, evidence: '' };
}
export { FINGERPRINTS };
