const HARD_EXCLUDED = Object.freeze([
  'jobui.com',
  '51job.com',
  'nowcoder.com',
]);

const SEARCH_ENGINES = Object.freeze([
  'baidu.com',
  'google.com',
  'bing.com',
  'sogou.com',
  'so.com',
]);

const PLATFORM_ALLOWLIST = Object.freeze({
  'liepin.com': 'LIEPIN',
  'zhipin.com': 'BOSS',
});

const NON_ORGANIC_KINDS = new Set([
  'ad',
  'advertisement',
  'sponsored',
  'promotion',
  'news',
]);

function parsedUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function matchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function matchesDomainList(host, domains) {
  return domains.some((domain) => matchesDomain(host, domain));
}

function isUniversityHost(host) {
  return /\.edu\.cn$/i.test(host)
    || matchesDomainList(host, ['ncss.cn', '91wllm.cn', '91wllm.com']);
}

function platformForHost(host) {
  for (const [domain, platform] of Object.entries(PLATFORM_ALLOWLIST)) {
    if (matchesDomain(host, domain)) return platform;
  }
  return '';
}

function isExactPlatformCompanyPath(platform, pathname) {
  if (platform === 'LIEPIN') {
    return /^\/company-jobs\/\d+\/?$/i.test(pathname);
  }
  if (platform === 'BOSS') {
    return /^\/(?:gongsir|gongsi)\/[a-z0-9_-]+(?:\.html)?\/?$/i.test(pathname);
  }
  return false;
}

function normalizedIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/(?:招聘职位|招聘岗位|招聘信息|正在招聘|最新招聘|社会招聘|校园招聘|公司招聘|招聘|职位|岗位|careers?|jobs?|hiring|liepin|猎聘|boss直聘|boss)/giu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function companyIdentityMatches({ company = '', title = '' } = {}) {
  const expected = normalizedIdentity(company);
  const observed = normalizedIdentity(title);
  return Boolean(expected && observed && expected === observed);
}

export function classifyRecruitmentSource({
  url,
  company = '',
  title = '',
  kind = 'organic',
} = {}) {
  const target = parsedUrl(url);
  const normalizedKind = String(kind || 'organic').toLowerCase();
  if (!target || NON_ORGANIC_KINDS.has(normalizedKind) || normalizedKind !== 'organic') {
    return Object.freeze({
      decision: 'DISCOVERY_LOG_ONLY',
      reasonCode: 'invalid_or_nonorganic',
    });
  }

  const host = target.hostname.toLowerCase().replace(/^www\./, '');
  if (matchesDomainList(host, SEARCH_ENGINES)) {
    return Object.freeze({
      decision: 'DISCOVERY_LOG_ONLY',
      reasonCode: 'search_engine_page',
    });
  }
  if (matchesDomainList(host, HARD_EXCLUDED) || isUniversityHost(host)) {
    return Object.freeze({
      decision: 'DISCOVERY_LOG_ONLY',
      reasonCode: 'hard_excluded_source',
    });
  }
  if (/\/(?:news|article|media|press)(?:\/|$)/i.test(target.pathname)
    || /新闻|转载|媒体报道|news|press release/i.test(title)) {
    return Object.freeze({
      decision: 'DISCOVERY_LOG_ONLY',
      reasonCode: 'news_or_reprint',
    });
  }

  const platform = platformForHost(host);
  if (platform) {
    if (!isExactPlatformCompanyPath(platform, target.pathname)
      || !companyIdentityMatches({ company, title })) {
      return Object.freeze({
        decision: 'DISCOVERY_LOG_ONLY',
        reasonCode: 'platform_identity_unconfirmed',
        platform,
      });
    }
    return Object.freeze({
      decision: 'PLATFORM_CANDIDATE',
      sourceTier: 'PLATFORM_ONLY',
      platform,
    });
  }

  return Object.freeze({
    decision: 'VERIFY_OFFICIAL_CANDIDATE',
    sourceTier: 'OFFICIAL_SITE',
  });
}

export function decidePlatformFallback({
  officialPortals = [],
  platformCandidate,
  searchCoverage = 'PARTIAL',
} = {}) {
  const activeOfficial = officialPortals.some((portal) => (
    portal.verificationStatus === 'VERIFIED'
    && portal.hiringAvailability === 'OPENINGS_FOUND'
  ));
  if (activeOfficial) {
    return Object.freeze({
      publish: false,
      reasonCode: 'OFFICIAL_SOURCE_AVAILABLE',
    });
  }
  if (!platformCandidate?.platformIdentityConfirmed
    || !platformCandidate.jobs?.length) {
    return Object.freeze({
      publish: false,
      reasonCode: 'PLATFORM_IDENTITY_OR_JOBS_MISSING',
    });
  }

  const explicitNoOpenings = officialPortals.some((portal) => (
    portal.verificationStatus === 'VERIFIED'
    && portal.hiringAvailability === 'NO_OPENINGS'
  ));
  const inaccessibleOfficial = officialPortals.some((portal) => (
    portal.verificationStatus === 'BLOCKED'
    || portal.hiringAvailability === 'UNKNOWN'
  ));

  return Object.freeze({
    publish: true,
    fallbackReason: explicitNoOpenings
      ? 'OFFICIAL_NO_OPENINGS'
      : inaccessibleOfficial
        ? 'OFFICIAL_INACCESSIBLE'
        : 'NO_OFFICIAL_FOUND',
    searchCoverage,
  });
}
