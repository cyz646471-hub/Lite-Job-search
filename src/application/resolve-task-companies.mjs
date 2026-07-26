import { getDomain } from 'tldts';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedIdentity(value) {
  return clean(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s·•・._,，、/\\()[\]（）【】"'“”‘’\-]+/g, '');
}

function normalizedDomain(value) {
  const raw = clean(value).toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return getDomain(url.hostname) || url.hostname;
  } catch {
    return '';
  }
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function rawRegistryRows(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.companies)) return input.companies;
  if (Array.isArray(input?.rawCompanies)) return input.rawCompanies;
  return [];
}

function normalizeRegistryRow(item, { market, source }) {
  const row = typeof item === 'string' ? { company: item } : (item || {});
  const chineseName = clean(row.chineseName || row.name_cn) || null;
  const englishName = clean(row.englishName || row.name_en) || null;
  const company = clean(
    row.company
    || row.canonicalName
    || row.name
    || chineseName
    || englishName,
  );
  if (!company) return null;
  const domains = uniqueStrings(
    row.officialDomains
    || row.official_domains
    || [row.officialDomain],
  );
  const industry = Array.isArray(row.industry)
    ? uniqueStrings(row.industry)
    : Array.isArray(row.industryTags)
      ? uniqueStrings(row.industryTags)
      : clean(row.industry)
        ? [clean(row.industry)]
        : [];
  return Object.freeze({
    company,
    chineseName,
    englishName,
    aliases: uniqueStrings(row.aliases),
    officialDomain: domains[0] || '',
    industry,
    countryRegion: clean(row.countryRegion || row.country_region) || null,
    market,
    registrySource: source || null,
  });
}

export function normalizeCompanyRegistry(input, {
  market = 'CN',
  source = null,
} = {}) {
  return Object.freeze(rawRegistryRows(input)
    .map((item) => normalizeRegistryRow(item, {
      market: String(market).toUpperCase(),
      source,
    }))
    .filter(Boolean));
}

function companyIdentityKeys(company) {
  const names = [
    company.company,
    company.canonicalName,
    company.chineseName,
    company.englishName,
    ...(company.aliases || []),
  ];
  const domains = [
    company.officialDomain,
    ...(company.officialDomains || []),
  ];
  return new Set([
    ...names.map(normalizedIdentity).filter(Boolean).map((value) => `name:${value}`),
    ...domains.map(normalizedDomain).filter(Boolean).map((value) => `domain:${value}`),
  ]);
}

function intersects(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

export function selectUnseenCompanies({
  registryCompanies = [],
  knownCompanies = [],
  supplementCompanies = [],
  supplementConfigured = false,
  targetCount,
  market = 'CN',
} = {}) {
  const normalizedMarket = String(market).toUpperCase();
  const target = Number(targetCount);
  if (!Number.isInteger(target) || target < 1 || target > 1000) {
    throw new Error('targetCount must be an integer between 1 and 1000');
  }
  const knownKeys = new Set();
  for (const company of knownCompanies) {
    if (String(company?.market || '').toUpperCase() !== normalizedMarket) continue;
    for (const key of companyIdentityKeys(company)) knownKeys.add(key);
  }

  const selected = [];
  const candidateKeys = new Set();
  let excludedKnown = 0;
  let duplicateCandidates = 0;
  let supplementSelected = 0;

  const consider = (company, sourceKind) => {
    if (String(company?.market || normalizedMarket).toUpperCase() !== normalizedMarket) return;
    const keys = companyIdentityKeys(company);
    if (!keys.size) return;
    if (intersects(keys, knownKeys)) {
      excludedKnown += 1;
      return;
    }
    if (intersects(keys, candidateKeys)) {
      duplicateCandidates += 1;
      return;
    }
    for (const key of keys) candidateKeys.add(key);
    if (selected.length >= target) return;
    selected.push(company);
    if (sourceKind === 'supplement') supplementSelected += 1;
  };

  for (const company of registryCompanies) consider(company, 'registry');
  for (const company of supplementCompanies) consider(company, 'supplement');

  const shortage = Math.max(0, target - selected.length);
  const supplementStatus = supplementSelected > 0
    ? 'USED'
    : shortage > 0
      ? supplementConfigured
        ? 'INSUFFICIENT'
        : 'NOT_CONFIGURED'
      : 'NOT_NEEDED';

  return Object.freeze({
    companies: Object.freeze(selected),
    supplementStatus,
    stats: Object.freeze({
      localCandidates: registryCompanies.length,
      supplementCandidates: supplementCompanies.length,
      excludedKnown,
      duplicateCandidates,
      selected: selected.length,
      shortage,
    }),
  });
}
