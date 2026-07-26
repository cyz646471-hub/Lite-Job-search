import { getDomain } from 'tldts';

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

export function recruitmentTypeForEntry(text, url) {
  const value = `${String(text || '')} ${String(url || '')}`.toLowerCase();
  if (/实习|internship|(?:^|[^a-z])intern(?:[^a-z]|$)/i.test(value)) return 'internship';
  if (/校(?:园)?招|校园|应届|毕业生|graduate|campus/i.test(value)) return 'campus';
  if (/社会招聘|社招|有经验|experienced|professional hires?/i.test(value)) {
    return 'experienced';
  }
  if (/职位|岗位|招聘岗位|全部工作|positions?|job openings?|open jobs?|careers?/i.test(value)) {
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
      .map((value) => httpUrl(value)?.href)
      .filter(Boolean),
  );
  const discovered = [];

  for (const link of links) {
    if (discovered.length >= numericMaxEntries) break;
    const resolved = httpUrl(link?.href, base);
    const recruitmentType = recruitmentTypeForEntry(link?.text, resolved?.href);
    if (!resolved || !recruitmentType) continue;
    const domain = registrableDomain(resolved.href);
    const firstPartyEntry = trustedDomains.has(domain);
    const attributedAtsEntry = !firstPartyEntry
      && parentOfficialVerified === true
      && knownAtsDomains.has(domain);
    if ((!firstPartyEntry && !attributedAtsEntry) || visited.has(resolved.href)) continue;
    visited.add(resolved.href);
    const entry = {
      url: resolved.href,
      text: String(link?.text || '').replace(/\s+/g, ' ').trim(),
      recruitmentType,
      parentUrl: parentUrl || base.href,
      depth: numericDepth,
      discoveryReason: attributedAtsEntry
        ? 'verified_official_outbound_ats_link'
        : 'career_navigation_link',
    };
    if (attributedAtsEntry) {
      entry.parentOfficialVerified = true;
      entry.officialAttributionUrl = parentUrl || base.href;
    }
    discovered.push(Object.freeze(entry));
  }

  return Object.freeze(discovered);
}
