import { fetchJobDetail } from '../../../engine/upstream/planner/detail-fetchers.mjs';
import { resolvePageProvider as defaultResolvePageProvider } from '../../../engine/upstream/planner/page-providers/_registry.mjs';
import { explicitIsoDate } from '../../application/recruitment-event-classifier.mjs';
import { createJobOpening } from '../../domain/job-opening.mjs';

function isoDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const timestamp = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const explicitDate = explicitIsoDate(value);
  if (!explicitDate) return null;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : `${explicitDate}T00:00:00.000Z`;
}

function locationsOf(raw = {}) {
  if (Array.isArray(raw.locations)) return raw.locations;
  if (Array.isArray(raw.location)) return raw.location;
  const value = raw.location || raw.city || raw.cityName || '';
  return String(value)
    .split(/[、,，/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sourceJobIdOf(raw = {}) {
  return raw.sourceJobId || raw.jobId || raw.positionId || raw.id || raw.code || null;
}

function detailUrlOf(raw = {}, portal) {
  return raw.jobDetailUrl || raw.detailUrl || raw.jobUrl || raw.sourceUrl || raw.url
    || (portal.pageType === 'JOB_DETAIL' ? portal.canonicalUrl : null);
}

function openingStatus(raw = {}) {
  if (raw.status === 'CLOSED' || raw.livenessStatus === 'expired') return 'CLOSED';
  if (raw.status === 'ACTIVE' || raw.livenessStatus === 'active') return 'ACTIVE';
  return 'UNKNOWN';
}

export function createUpstreamJobExtractionAdapter({
  fetchPage,
  fetchDetail = fetchJobDetail,
  resolvePageProvider = defaultResolvePageProvider,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof fetchPage !== 'function') throw new Error('fetchPage is required');

  return Object.freeze({
    async extract({
      company,
      portal,
      intent = {},
    } = {}) {
      if (portal?.verificationStatus !== 'VERIFIED') {
        throw new Error('job extraction requires a verified CareerPortal');
      }
      let rawJobs = [];
      if (portal.pageType === 'JOB_DETAIL') {
        const detail = await fetchDetail(portal.canonicalUrl);
        if (detail) rawJobs = [detail];
      } else {
        const page = await fetchPage(portal.canonicalUrl);
        const finalUrl = page.finalUrl || page.url || portal.canonicalUrl;
        if (Array.isArray(page.jobs)) {
          rawJobs = page.jobs;
        } else {
          const provider = await resolvePageProvider(finalUrl);
          const parsed = provider?.parse(page.html || page.body || '', {
            requestedUrl: portal.canonicalUrl,
            finalUrl,
          });
          if (Array.isArray(parsed?.activeJobs)) {
            rawJobs = parsed.activeJobs.map((job) => ({ status: 'ACTIVE', ...job }));
          }
          else if (Array.isArray(parsed?.jobs)) rawJobs = parsed.jobs;
          else if (Array.isArray(parsed?.positions)) rawJobs = parsed.positions;
          else if (parsed?.title) rawJobs = [parsed];
        }
      }

      return Object.freeze(rawJobs
        .filter((raw) => String(raw?.title || raw?.jobName || raw?.positionName || '').trim())
        .map((raw) => {
          const title = raw.title || raw.jobName || raw.positionName;
          const jobDetailUrl = detailUrlOf(raw, portal);
          const sourceUrl = jobDetailUrl || raw.sourceUrl || portal.canonicalUrl;
          return createJobOpening({
            companyId: company.id,
            careerPortalId: portal.id,
            sourceTier: portal.sourceTier || (portal.atsType ? 'OFFICIAL_ATS' : 'OFFICIAL_SITE'),
            sourceJobId: sourceJobIdOf(raw),
            title,
            normalizedTitle: raw.normalizedTitle || title,
            roleFamily: raw.roleFamily || intent.roleFamily || 'OTHER',
            locations: locationsOf(raw),
            employmentType: raw.employmentType || raw.jobType || null,
            publishedAt: isoDate(raw.publishedAt ?? raw.postedAt ?? raw.datePosted ?? raw.updateTime),
            closesAt: isoDate(raw.closesAt ?? raw.expiresAt ?? raw.validThrough),
            jobDetailUrl,
            applyUrl: raw.applyUrl || raw.applicationUrl || null,
            status: openingStatus(raw),
            sourceUrl,
          }, { now: now() });
        }));
    },
  });
}
