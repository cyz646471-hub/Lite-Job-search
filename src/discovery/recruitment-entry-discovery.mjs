import { getDomain } from 'tldts';
import { canonicalRecruitmentUrl } from '../core/canonical-recruitment-url.mjs';

export const KNOWN_ATS_REGISTRABLE_DOMAINS = Object.freeze([
  'mokahr.com',
  'mokahr.cn',
  'beisen.com',
  'beisencloud.com',
  'hotjob.cn',
  'zhiye.com',
  'lever.co',
  'greenhouse.io',
  'myworkdayjobs.com',
  'smartrecruiters.com',
]);

function httpUrl(value, baseUrl = undefined) {
  try {
    const url = new URL(String(value || ''), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function registrableDomain(value) {
  const parsed = httpUrl(
    String(value || '').includes('://') ? value : `https://${String(value || '')}`,
  );
  return parsed ? (getDomain(parsed.hostname) || parsed.hostname).toLowerCase() : '';
}

function normalizedDomainSet(values) {
  return new Set((values || []).map(registrableDomain).filter(Boolean));
}

function isNonCandidateNavigation(url, text = '') {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return /^(?:passport|fabu|account|auth|sso)\./i.test(host)
    || /\/(?:login|logout|register|signin|signup)(?:\/|$)/i.test(path)
    || /\/(?:article|news|blog|media|press)(?:\/|$)/i.test(path)
    || /\/(?:jobs?|positions?)\/[^/]+\/detail(?:\/|$)/i.test(path)
    || /\/resume(?:[./]|$)/i.test(path)
    || /发布(?:招聘)?职位|企业(?:登录|注册)|employer\s+(?:login|sign in|post)/i
      .test(String(text || ''));
}

function navigationPriority(text = '', url = '') {
  const value = `${String(text)} ${String(url)}`.toLowerCase();
  if (/职位列表|岗位列表|查看.*职位|搜索.*职位|open positions?|job openings?|find jobs?|search jobs?|apply/i.test(value)) return 100;
  if (/校园招聘|社会招聘|实习|校招|社招|campus|graduate|internship|experienced/i.test(value)) return 80;
  if (/加入我们|招聘首页|人才招聘|careers?|jobs?/i.test(value)) return 60;
  if (/文化|福利|生活|故事|团队|culture|benefits?|life at|meet the team/i.test(value)) return 10;
  return 40;
}

export function recruitmentTypeForEntry(text, url) {
  const value = `${String(text || '')} ${String(url || '')}`.toLowerCase();
  if (/回到招聘首页|返回招聘首页|招聘首页|back to (?:the )?(?:career|recruitment) home/i.test(value)) {
    return 'general';
  }
  if (/实习|internship|(?:^|[^a-z])intern(?:[^a-z]|$)/i.test(value)) return 'internship';
  if (/校(?:园)?招|校园|应届|毕业生|graduate|campus/i.test(value)) return 'campus';
  if (/社会招聘|社招|有经验|experienced|professional hires?/i.test(value)) {
    return 'experienced';
  }
  if (
    /申请岗位|查看岗位|搜索岗位|职位|岗位|招聘岗位|全部工作|positions?|job openings?|open jobs?|find jobs?|search jobs?|careers?|apply(?: for)? jobs?/i
      .test(value)
  ) {
    return 'general';
  }
  return null;
}

export function discoverRecruitmentEntries({
  baseUrl,
  links = [],
  trustedRegistrableDomains = [],
  verifiedAtsDomains = [],
  knownAtsRegistrableDomains = [],
  parentOfficialVerified = false,
  visitedUrls = [],
  parentUrl = null,
  depth = 1,
  maxDepth = 2,
  maxEntries = 20,
} = {}) {
  const base = httpUrl(baseUrl);
  const numericDepth = Number(depth);
  const numericMaxDepth = Number(maxDepth);
  const numericMaxEntries = Math.max(0, Number(maxEntries) || 0);
  if (
    !base
    || !Array.isArray(links)
    || numericDepth > numericMaxDepth
    || numericMaxEntries === 0
  ) {
    return Object.freeze([]);
  }

  const trustedDomains = normalizedDomainSet(trustedRegistrableDomains);
  const knownAtsDomains = normalizedDomainSet([
    ...verifiedAtsDomains,
    ...knownAtsRegistrableDomains,
  ]);
  const visited = new Set(
    [base.href, ...(visitedUrls || [])]
      .map((value) => canonicalRecruitmentUrl(value))
      .filter(Boolean),
  );
  const discovered = [];

  for (const link of links) {
    const resolved = httpUrl(link?.href, base);
    const recruitmentType = recruitmentTypeForEntry(link?.text, resolved?.href);
    if (!resolved || !recruitmentType || isNonCandidateNavigation(resolved, link?.text)) continue;
    const domain = registrableDomain(resolved.href);
    const firstPartyEntry = trustedDomains.has(domain);
    const attributedAtsEntry = !firstPartyEntry
      && parentOfficialVerified === true
      && knownAtsDomains.has(domain);
    const canonicalUrl = canonicalRecruitmentUrl(resolved.href);
    if ((!firstPartyEntry && !attributedAtsEntry) || !canonicalUrl || visited.has(canonicalUrl)) continue;
    visited.add(canonicalUrl);
    const entry = {
      url: canonicalUrl,
      text: String(link?.text || '').replace(/\s+/g, ' ').trim(),
      recruitmentType,
      parentUrl: parentUrl || base.href,
      depth: numericDepth,
      discoveryReason: attributedAtsEntry
        ? 'verified_official_outbound_ats_link'
        : 'career_navigation_link',
      priority: navigationPriority(link?.text, canonicalUrl) + (attributedAtsEntry ? 10 : 0),
    };
    if (attributedAtsEntry) {
      entry.parentOfficialVerified = true;
      entry.officialAttributionUrl = parentUrl || base.href;
    }
    discovered.push(Object.freeze(entry));
  }

  return Object.freeze(discovered
    .sort((left, right) => right.priority - left.priority || left.url.localeCompare(right.url))
    .slice(0, numericMaxEntries)
    .map(({ priority, ...entry }) => Object.freeze(entry)));
}
