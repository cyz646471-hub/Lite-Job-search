import { getDomain } from 'tldts';

const THIRD_PARTY_PLATFORMS = [
  ['Liepin', (host) => host === 'liepin.com' || host.endsWith('.liepin.com')],
  ['BOSS', (host) => host === 'zhipin.com' || host.endsWith('.zhipin.com')],
  ['Zhaopin', (host) => host === 'zhaopin.com' || host.endsWith('.zhaopin.com')],
  ['51job', (host) => host === '51job.com' || host.endsWith('.51job.com')],
];

const REJECTED_KINDS = new Set(['ad', 'advertisement', 'sponsored', 'promotion', 'news']);
const RECRUITMENT_PATH = /\/(?:career|careers|job|jobs|recruit|recruitment|social|campus|position|positions|internship|graduate)(?:[/?#]|$)/i;
const RECRUITMENT_HOST = /^(?:job|jobs|career|careers|hr|recruit|recruitment)\./i;

function parsedUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function normalizedDomain(value) {
  const url = parsedUrl(value.includes('://') ? value : `https://${value}`);
  return url ? (getDomain(url.hostname) || url.hostname).toLowerCase() : '';
}

function platformForHost(host) {
  return THIRD_PARTY_PLATFORMS.find(([, matches]) => matches(host))?.[0] || '';
}

function hasCompanyIdentity(title, company) {
  const normalizedTitle = String(title || '').toLowerCase().replace(/\s+/g, '');
  const normalizedCompany = String(company || '').toLowerCase().replace(/\s+/g, '');
  return Boolean(normalizedCompany && normalizedTitle.includes(normalizedCompany));
}

export function classifySearchResult({ company = '', officialDomain = '', title = '', url = '', kind = 'organic' } = {}) {
  const parsed = parsedUrl(url);
  const normalizedKind = String(kind || '').toLowerCase();
  if (!parsed) return { classification: 'REJECTED', reasonCode: 'invalid_url' };
  if (REJECTED_KINDS.has(normalizedKind)) return { classification: 'REJECTED', reasonCode: `search_result_${normalizedKind}` };

  const host = parsed.hostname.toLowerCase();
  const platform = platformForHost(host);
  if (platform) {
    return hasCompanyIdentity(title, company)
      ? { classification: 'LEAD_ONLY', reasonCode: 'third_party_company_lead', platform }
      : { classification: 'REJECTED', reasonCode: 'third_party_identity_unconfirmed', platform };
  }

  const expectedDomain = normalizedDomain(officialDomain);
  const resultDomain = getDomain(host) || host;
  const firstParty = Boolean(expectedDomain && resultDomain === expectedDomain);
  const recruitmentShaped = RECRUITMENT_HOST.test(host) || RECRUITMENT_PATH.test(parsed.pathname);
  if (firstParty && recruitmentShaped) return { classification: 'OFFICIAL_CANDIDATE', reasonCode: 'first_party_recruitment_url' };
  if (firstParty) return { classification: 'REJECTED', reasonCode: 'first_party_non_recruitment_page' };
  return { classification: 'REJECTED', reasonCode: 'unverified_non_recruitment_url' };
}

function recruitmentTypeForLink(text, url) {
  const value = `${text} ${url}`.toLowerCase();
  if (/实习|internship|intern\b/.test(value)) return 'INTERNSHIP';
  if (/应届|校招|graduate|campus/.test(value)) return 'GRADUATE';
  if (/社会|社招|social|experienced/.test(value)) return 'SOCIAL';
  if (/岗位|职位|position|jobs?/.test(value)) return 'JOB_LIST';
  return '';
}

export function discoverCareerLinks(baseUrl, links = []) {
  const base = parsedUrl(baseUrl);
  if (!base || !Array.isArray(links)) return [];
  const candidates = [];
  const seen = new Set();
  for (const link of links) {
    const recruitmentType = recruitmentTypeForLink(link?.text, link?.href);
    if (!recruitmentType) continue;
    let resolved;
    try {
      resolved = new URL(String(link.href || ''), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(resolved.protocol) || resolved.hostname !== base.hostname || seen.has(resolved.href)) continue;
    seen.add(resolved.href);
    candidates.push({
      url: resolved.href,
      text: String(link.text || '').trim(),
      recruitmentType,
      discoveryReason: 'career_navigation_link',
    });
  }
  return candidates;
}
