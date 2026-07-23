import { canonicalCompany, canonicalTitle, dedupeJobs, normalizeJob, normalizeText, sourceFromUrl } from './core.mjs';

const PLATFORM_HOSTS = {
  LinkedIn: (host) => host === 'linkedin.com' || host.endsWith('.linkedin.com'),
  Indeed: (host) => host === 'indeed.com' || host.endsWith('.indeed.com') || host.includes('.indeed.'),
};

function platformFromUrl(rawUrl = '') {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    for (const [name, matches] of Object.entries(PLATFORM_HOSTS)) if (matches(host)) return name;
  } catch {}
  return '';
}

function toDateMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function tokens(value) {
  return new Set(normalizeText(value).split(' ').filter((token) => token.length > 1));
}

function overlap(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.min(a.size, b.size);
}

export function normalizeSearchWindow(value, fallback = 90) {
  const parsed = Number(value);
  return Math.max(1, Math.min(180, Number.isFinite(parsed) ? parsed : fallback));
}

export function isFreshPlatformVerification(value, now = Date.now()) {
  if (value?.sourceType !== 'verified_platform_apply' && value?.browserVerified !== true) return false;
  const verifiedAt = toDateMs(value?.lastVerifiedAt);
  return value?.livenessStatus === 'active' && verifiedAt !== null && now - verifiedAt <= 48 * 60 * 60 * 1000;
}

export function buildPlatformSearches({ roles = [], locations = [], sinceDays = 90, maxPerSource = 20 } = {}) {
  const windowDays = normalizeSearchWindow(sinceDays);
  const roleList = roles.slice(0, 12);
  const locationList = locations.length ? locations.slice(0, 8) : ['United States'];
  const searches = [];
  const sourceCounts = { LinkedIn: 0, Indeed: 0 };
  for (const role of roleList) {
    for (const location of locationList) {
      const linkedIn = new URL('https://www.linkedin.com/jobs/search/');
      linkedIn.searchParams.set('keywords', role);
      linkedIn.searchParams.set('location', location);
      linkedIn.searchParams.set('f_E', '2,3');
      linkedIn.searchParams.set('f_JT', 'F,I');
      linkedIn.searchParams.set('sortBy', 'DD');
      // LinkedIn's documented UI only offers up to past month. Wider windows
      // use Any time and are filtered from imported posting dates locally.
      if (windowDays <= 30) linkedIn.searchParams.set('f_TPR', `r${windowDays * 86400}`);

      const indeed = new URL('https://www.indeed.com/jobs');
      indeed.searchParams.set('q', role);
      indeed.searchParams.set('l', location);
      indeed.searchParams.set('sort', 'date');
      if (windowDays <= 14) indeed.searchParams.set('fromage', String(windowDays));

      if (sourceCounts.LinkedIn < maxPerSource) {
        searches.push({
          source: 'LinkedIn', role, location, url: linkedIn.href, sinceDays: windowDays,
          dateMode: windowDays <= 30 ? 'platform-filter' : 'local-post-filter',
        });
        sourceCounts.LinkedIn++;
      }
      if (sourceCounts.Indeed < maxPerSource) {
        searches.push({
          source: 'Indeed', role, location, url: indeed.href, sinceDays: windowDays,
          dateMode: windowDays <= 14 ? 'platform-filter' : 'local-post-filter',
        });
        sourceCounts.Indeed++;
      }
      if (sourceCounts.LinkedIn >= maxPerSource && sourceCounts.Indeed >= maxPerSource) return searches;
    }
  }
  return searches;
}

export function normalizePlatformLead(input = {}, { sinceDays = 90, now = Date.now() } = {}) {
  const url = String(input.url || input.platformUrl || '').trim();
  const detectedPlatform = platformFromUrl(url);
  const claimedPlatform = Object.keys(PLATFORM_HOSTS).find((name) => name.toLowerCase() === String(input.platform || '').toLowerCase());
  const platform = claimedPlatform || detectedPlatform;
  if (!platform || !detectedPlatform || detectedPlatform !== platform) return { accepted: false, reason: 'unsupported_platform', input };
  if (!input.title || !input.company || !url) return { accepted: false, reason: 'missing_identity', input };

  const postedMs = toDateMs(input.postedAt);
  const windowDays = normalizeSearchWindow(sinceDays);
  if (postedMs !== null && postedMs < now - windowDays * 86400000) {
    return { accepted: false, reason: 'outside_search_window', input };
  }

  const directApplyUrl = String(input.directApplyUrl || input.applyUrl || '').trim();
  const directSource = sourceFromUrl(directApplyUrl);
  const browserVerified = isFreshPlatformVerification({ ...input, browserVerified: input.browserVerified === true }, now);
  const platformApply = !directApplyUrl || platformFromUrl(directApplyUrl) === platform;
  const description = String(input.description || input.snippet || '').trim();
  const jdVerified = input.jdVerified === true && description.length >= 120;
  const timeVerified = postedMs !== null;
  const canUsePlatformApply = browserVerified && platformApply && jdVerified && timeVerified;

  return {
    accepted: true,
    lead: {
      title: String(input.title).trim(),
      company: String(input.company).trim(),
      location: String(input.location || '').trim(),
      postedAt: input.postedAt || null,
      description,
      platform,
      platformUrl: url,
      directApplyUrl,
      applicationMethod: String(input.applicationMethod || ''),
      browserVerified,
      jdVerified,
      timeVerified,
      canUsePlatformApply,
      lastVerifiedAt: input.lastVerifiedAt || null,
      livenessStatus: browserVerified ? 'active' : 'unverified',
      sourceType: directApplyUrl && !platformApply && directSource.sourceType !== 'discovery'
        ? directSource.sourceType
        : canUsePlatformApply ? 'verified_platform_apply' : 'discovery',
      dateStatus: postedMs === null ? 'unknown' : 'dated',
    },
  };
}

export function parsePlatformLeads(payload, options = {}) {
  const items = Array.isArray(payload) ? payload : Array.isArray(payload?.leads) ? payload.leads : [];
  const leads = [];
  const rejected = [];
  for (const item of items) {
    const result = normalizePlatformLead(item, options);
    if (result.accepted) leads.push(result.lead);
    else rejected.push({ ...item, rejectionReason: result.reason });
  }
  return { leads, rejected };
}

function sameIdentity(lead, job) {
  const company = canonicalCompany(lead.company);
  const jobCompany = canonicalCompany(job.company);
  if (!company || !jobCompany || company !== jobCompany) return false;
  const title = canonicalTitle(lead.title);
  const jobTitle = canonicalTitle(job.title);
  return title === jobTitle || overlap(title, jobTitle) >= 0.6;
}

export function promotePlatformLeads(leads = [], officialCandidates = []) {
  const normalizedOfficial = officialCandidates.map((job) => normalizeJob(job));
  const promoted = [];
  const unresolved = [];

  for (const lead of leads) {
    const official = normalizedOfficial.find((job) => sameIdentity(lead, job));
    if (official) {
      promoted.push({
        ...official,
        alternateUrls: [...new Set([...(official.alternateUrls || []), lead.platformUrl])],
        discoveryEvidence: [...(official.discoveryEvidence || []), {
          source: lead.platform, url: lead.platformUrl, postedAt: lead.postedAt, dateStatus: lead.dateStatus,
        }],
      });
      continue;
    }

    if (lead.directApplyUrl && sourceFromUrl(lead.directApplyUrl).sourceType !== 'discovery') {
      const directSource = sourceFromUrl(lead.directApplyUrl);
      promoted.push(normalizeJob({
        ...lead, url: lead.directApplyUrl, applyUrl: lead.directApplyUrl,
        sourceUrl: lead.platformUrl, source: directSource.source, sourceType: directSource.sourceType,
      }));
      continue;
    }

    if (lead.canUsePlatformApply) {
      promoted.push(normalizeJob({
        ...lead, url: lead.platformUrl, applyUrl: lead.platformUrl,
        source: lead.platform, sourceType: 'verified_platform_apply',
        livenessStatus: 'active', lastVerifiedAt: lead.lastVerifiedAt,
      }));
      continue;
    }
    unresolved.push(lead);
  }

  return { promoted: dedupeJobs(promoted), unresolved };
}
