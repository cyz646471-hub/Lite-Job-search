import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createUpstreamJobExtractionAdapter } from '../adapters/upstream/job-extraction-adapter.mjs';
import { createJobOpening } from '../domain/job-opening.mjs';
import { createRecruitmentEvent } from '../domain/recruitment-event.mjs';
import { assertMonitoringNetworkRepository } from '../ports/job-repository.mjs';
import { buildMonitoringNetworkPlan } from './build-monitoring-network-plan.mjs';
import { classifyRecruitmentEvent } from './recruitment-event-classifier.mjs';

const OBSERVED_PAGE_ROLES = new Set([
  'CAREER_HOME',
  'CAMPAIGN',
  'JOB_LIST',
  'JOB_DETAIL',
  'APPLY',
  'SITEMAP',
]);

const EXPLICIT_NO_OPENINGS = [
  /暂无(?:可投递)?(?:职位|岗位|招聘)/i,
  /当前(?:暂无|没有)(?:开放)?(?:职位|岗位|招聘)/i,
  /没有找到相关(?:职位|岗位)/i,
  /\bno (?:openings|open positions|jobs available)\b/i,
  /\bthere are currently no (?:openings|vacancies)\b/i,
];

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function cleanText(html = '') {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageTitle(html = '') {
  return String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';
}

function explicitNoOpenings(text) {
  return /暂无(?:可投递)?(?:职位|岗位|招聘)|当前(?:暂无|没有)(?:开放)?(?:职位|岗位|招聘)|没有找到相关(?:职位|岗位)/i.test(text)
    || EXPLICIT_NO_OPENINGS.some((pattern) => pattern.test(text));
}

function pageRoleOf(portal) {
  return OBSERVED_PAGE_ROLES.has(portal?.pageType) ? portal.pageType : 'UNKNOWN';
}

function structureHashOf(page, jobs) {
  const titles = jobs.map((job) => job.title).filter(Boolean).sort();
  const links = [...String(page.html || '')
    .matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .slice(0, 500)
    .sort();
  return sha256(JSON.stringify({ titles, links }));
}

async function atomicText(file, value) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, target);
  return target;
}

function failedOutcome(error) {
  const message = String(error?.message || error);
  return /401|403|429|captcha|challenge|安全验证|访问受限/i.test(message)
    ? 'BLOCKED'
    : 'FAILED';
}

function portalAfterCheck(portal, {
  checkedAt,
  hiringAvailability,
} = {}) {
  return {
    ...portal,
    hiringAvailability,
    lastCheckedAt: checkedAt,
    lastVerifiedAt: portal.lastVerifiedAt || checkedAt,
  };
}

function eventForJob({ company, portal, job, page, observedAt }) {
  const pageRole = pageRoleOf(portal);
  const directoryPageType = ['CAREER_HOME', 'CAMPAIGN', 'JOB_LIST'].includes(pageRole)
    ? pageRole
    : 'CAREER_HOME';
  const classified = classifyRecruitmentEvent({
    pageTitle: pageTitle(page.html),
    pageText: cleanText(page.html),
    jobTitle: job.title,
    employmentType: job.employmentType,
    directoryUrl: portal.canonicalUrl,
    directoryPageType,
    sourceTier: portal.sourceTier,
    structuredStartAt: job.publishedAt,
    structuredClosesAt: job.closesAt,
    locations: job.locations,
  });
  return createRecruitmentEvent({
    ...classified,
    companyId: company.id,
    careerPortalId: portal.id,
    sourceTier: portal.sourceTier,
    lastSeenAt: observedAt,
    lastVerifiedAt: observedAt,
  }, { now: observedAt });
}

function eventAndOpening({ company, portal, job, page, observedAt }) {
  const event = eventForJob({ company, portal, job, page, observedAt });
  const opening = createJobOpening({
    ...job,
    companyId: company.id,
    careerPortalId: portal.id,
    recruitmentEventId: event.id,
    sourceTier: portal.sourceTier,
    lastSeenAt: observedAt,
  }, { now: observedAt });
  return { event, opening };
}

export async function runKnownEndpointMonitor({
  repository,
  fetchPage,
  jobExtractor = null,
  outputDir = 'output/monitoring-network',
  targetCount = 100,
  market = 'CN',
  includeNotDue = false,
  sourceEndpointIds = null,
  onProgress = null,
  now = () => new Date().toISOString(),
} = {}) {
  assertMonitoringNetworkRepository(repository);
  if (typeof fetchPage !== 'function') throw new Error('fetchPage is required');
  const startedAt = now();
  const companies = repository.listCompanies();
  const portals = repository.listCareerPortals();
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const portalById = new Map(portals.map((portal) => [portal.id, portal]));
  const allSourceEndpoints = repository.listSourceEndpoints();
  const plan = buildMonitoringNetworkPlan({
    companies,
    portals,
    sourceEndpoints: allSourceEndpoints,
    monitorPolicies: repository.listMonitorPolicies(),
    reviewTasks: repository.listReviewTasks(),
    userActions: repository.listUserActions(),
    jobs: repository.listJobOpenings(),
    providerCircuits: repository.listProviderCircuitStates(),
    market,
    targetCount: sourceEndpointIds ? allSourceEndpoints.length : targetCount,
    laneShares: sourceEndpointIds
      ? {
        PORTAL_MONITOR: 1,
        PORTAL_RECOVERY: 0,
        MARKET_DISCOVERY: 0,
        REVIEW_FEEDBACK: 0,
      }
      : undefined,
    includeNotDue,
    now: startedAt,
  });
  const endpointFilter = sourceEndpointIds
    ? new Set(sourceEndpointIds.map(String))
    : null;
  const items = plan.queues.PORTAL_MONITOR.filter((item) => (
    item.runnable && (!endpointFilter || endpointFilter.has(item.sourceEndpointId))
  ));
  const results = [];
  async function recordResult(result) {
    results.push(result);
    if (typeof onProgress === 'function') {
      await onProgress(Object.freeze({
        result,
        processedCount: results.length,
        selectedCount: items.length,
      }));
    }
  }

  for (const item of items) {
    const endpoint = repository.listSourceEndpoints({
      companyId: item.companyId,
      careerPortalId: item.careerPortalId,
    }).find((candidate) => candidate.id === item.sourceEndpointId);
    const company = companyById.get(item.companyId);
    const portal = portalById.get(item.careerPortalId);
    if (!endpoint || !company || !portal || portal.verificationStatus !== 'VERIFIED') {
      await recordResult({
        ...item,
        status: 'SKIPPED',
        reasonCode: 'VERIFIED_ENDPOINT_CONTEXT_MISSING',
      });
      continue;
    }

    const fetchedAt = now();
    const started = Date.now();
    try {
      const conditionalHeaders = {};
      if (endpoint.etag) conditionalHeaders['if-none-match'] = endpoint.etag;
      if (endpoint.lastModified) {
        conditionalHeaders['if-modified-since'] = endpoint.lastModified;
      }
      const page = await fetchPage(endpoint.canonicalUrl, {
        headers: conditionalHeaders,
      });
      const status = Number(page.status ?? 200);
      if ([401, 403, 429].includes(status)) {
        throw new Error(`HTTP_${status}_ACCESS_BLOCKED`);
      }
      if (status >= 400) throw new Error(`HTTP_${status}`);
      const notModified = status === 304;
      const html = String(page.html || page.body || '');
      const contentHash = notModified ? endpoint.contentHash : sha256(html);
      const unchanged = notModified
        || Boolean(endpoint.contentHash && endpoint.contentHash === contentHash);
      const text = cleanText(html);
      let jobs = [];
      let outcome = unchanged ? 'NOT_MODIFIED' : 'SUCCESS';
      let hiringAvailability = portal.hiringAvailability || 'UNKNOWN';

      if (!unchanged) {
        const extractor = jobExtractor || createUpstreamJobExtractionAdapter({
          fetchPage: async () => page,
          now,
        });
        jobs = await extractor.extract({
          company,
          portal,
          intent: {},
        });
        if (jobs.length) {
          hiringAvailability = 'OPENINGS_FOUND';
        } else if (explicitNoOpenings(text)) {
          outcome = 'NO_OPENINGS';
          hiringAvailability = 'NO_OPENINGS';
        } else {
          hiringAvailability = 'UNKNOWN';
        }
      }

      const snapshotPath = unchanged
        ? null
        : await atomicText(
          path.join(outputDir, 'snapshots', `${endpoint.id}-${Date.parse(fetchedAt)}.html`),
          html,
        );
      const checkedPortal = portalAfterCheck(portal, {
        checkedAt: fetchedAt,
        hiringAvailability,
      });
      const records = jobs.map((job) => eventAndOpening({
        company,
        portal: checkedPortal,
        job,
        page,
        observedAt: fetchedAt,
      }));
      const events = [...new Map(records.map((record) => [
        record.event.id,
        record.event,
      ])).values()];
      const storedJobs = records.map((record) => record.opening);
      repository.persistCompanySnapshot({
        company,
        portal: checkedPortal,
        evidence: checkedPortal.evidence || [],
        events,
        openings: storedJobs,
      });
      const storedPortal = repository.listCareerPortals()
        .find((candidate) => candidate.id === checkedPortal.id) || checkedPortal;
      const observation = repository.appendFetchObservation({
        sourceEndpointId: endpoint.id,
        fetchedAt,
        outcome,
        httpStatus: status,
        finalUrl: page.finalUrl || endpoint.canonicalUrl,
        contentHash,
        structureHash: structureHashOf(page, storedJobs),
        pageRole: pageRoleOf(storedPortal),
        hiringAvailability,
        jobCount: storedJobs.length,
        evidence: [{
          code: unchanged ? 'CONTENT_HASH_UNCHANGED' : 'DIRECT_ENDPOINT_FETCH',
          sourceUrl: page.finalUrl || endpoint.canonicalUrl,
          observedAt: fetchedAt,
        }],
        snapshotPath,
        durationMs: Date.now() - started,
        metadata: {
          etag: page.headers?.etag || null,
          lastModified: page.headers?.lastModified || null,
          transport: endpoint.transport,
        },
      });
      if (snapshotPath) {
        repository.appendPageSnapshot({
          sourceEndpointId: endpoint.id,
          observationId: observation.id,
          capturedAt: fetchedAt,
          finalUrl: page.finalUrl || endpoint.canonicalUrl,
          contentType: page.headers?.contentType || 'text/html',
          bodyPath: snapshotPath,
          bodyBytes: Buffer.byteLength(html),
          contentHash,
          structureHash: structureHashOf(page, storedJobs),
          metadata: {
            adapterType: endpoint.adapterType,
            pageRole: pageRoleOf(storedPortal),
          },
        });
      }
      const reconciliation = repository.reconcileEndpointOpenings({
        sourceEndpointId: endpoint.id,
        observationId: observation.id,
        seenJobIds: storedJobs.map((job) => job.id),
        successful: outcome === 'SUCCESS' || outcome === 'NO_OPENINGS',
        missingThreshold: item.consecutiveMissingThreshold || 3,
        observedAt: fetchedAt,
      });
      await recordResult({
        ...item,
        status: outcome,
        observationId: observation.id,
        hiringAvailability,
        jobCount: storedJobs.length,
        reconciliation,
      });
    } catch (error) {
      const outcome = failedOutcome(error);
      let observationId = null;
      let observationPersistenceError = null;
      try {
        const observation = repository.appendFetchObservation({
          sourceEndpointId: endpoint.id,
          fetchedAt,
          outcome,
          finalUrl: endpoint.canonicalUrl,
          pageRole: pageRoleOf(portal),
          hiringAvailability: portal.hiringAvailability || 'UNKNOWN',
          jobCount: 0,
          reasonCode: String(error?.message || error),
          evidence: [{
            code: outcome === 'BLOCKED' ? 'ENDPOINT_ACCESS_BLOCKED' : 'ENDPOINT_FETCH_FAILED',
            sourceUrl: endpoint.canonicalUrl,
            observedAt: fetchedAt,
          }],
          durationMs: Date.now() - started,
          metadata: { transport: endpoint.transport },
        });
        observationId = observation.id;
      } catch (persistenceError) {
        observationPersistenceError = String(
          persistenceError?.message || persistenceError,
        );
      }
      await recordResult({
        ...item,
        status: outcome,
        observationId,
        reasonCode: String(error?.message || error),
        observationPersistenceError,
        jobCount: 0,
      });
    }
  }

  const completedAt = now();
  const counts = results.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {});
  return Object.freeze({
    mode: 'KNOWN_ENDPOINT_MONITOR',
    startedAt,
    completedAt,
    selectedCount: items.length,
    processedCount: results.length,
    counts: Object.freeze(counts),
    jobCount: results.reduce((sum, item) => sum + Number(item.jobCount || 0), 0),
    results: Object.freeze(results),
  });
}
