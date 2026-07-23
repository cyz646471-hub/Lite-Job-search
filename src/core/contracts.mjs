export const MARKETS = Object.freeze(['CN', 'NA']);

const MARKET_ALIASES = new Map([
  ['CN', 'CN'],
  ['CHINA', 'CN'],
  ['中国', 'CN'],
  ['NA', 'NA'],
  ['NORTH AMERICA', 'NA'],
  ['US', 'NA'],
  ['USA', 'NA'],
  ['CANADA', 'NA'],
]);

const URL_FIELDS = [
  'sourceUrl',
  'companyCareerHomeUrl',
  'campaignLandingUrl',
  'jobListUrl',
  'jobDetailUrl',
  'applyUrl',
];

function cleanUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeMarket(value) {
  const market = MARKET_ALIASES.get(String(value || '').trim().toUpperCase());
  if (!market) throw new Error(`unsupported market: ${value}`);
  return market;
}

export function selectBestEntryUrl(result = {}) {
  const roles = [
    ['DIRECT_APPLICATION', result.applyUrl],
    ['JOB_DETAIL', result.jobDetailUrl],
    ['JOB_LIST', result.jobListUrl],
    ['CAMPAIGN_LANDING', result.campaignLandingUrl],
    ['CAREER_HOME', result.companyCareerHomeUrl],
  ];
  const match = roles.find(([, url]) => cleanUrl(url));
  return match ? { role: match[0], url: cleanUrl(match[1]) } : null;
}

export function createJobResult(input = {}) {
  const result = {
    market: normalizeMarket(input.market),
    company: String(input.company || '').trim(),
    title: String(input.title || '').trim(),
    location: String(input.location || '').trim(),
    employmentType: input.employmentType ? String(input.employmentType) : null,
    publishedAt: input.publishedAt || null,
    source: input.source ? String(input.source) : null,
    officialIdentityConfirmed: input.officialIdentityConfirmed === true,
    campaignConfirmed: input.campaignConfirmed === true,
    hasJobList: input.hasJobList === true || Boolean(input.jobListUrl),
    hasApplicationAction: input.hasApplicationAction === true || Boolean(input.applyUrl),
    applicationActive: input.applicationActive ?? null,
    evidence: Array.isArray(input.evidence) ? [...input.evidence] : [],
    discoveredAt: input.discoveredAt || new Date().toISOString(),
  };
  for (const field of URL_FIELDS) result[field] = cleanUrl(input[field]);
  result.sourceUrls = [...new Set([
    ...(Array.isArray(input.sourceUrls) ? input.sourceUrls : []),
    result.sourceUrl,
  ].map(cleanUrl).filter(Boolean))];
  return result;
}

