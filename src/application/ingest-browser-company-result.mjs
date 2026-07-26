import { createHash, randomUUID } from 'node:crypto';

import {
  adaptBrowserCompanyResult,
  createBrowserObservationFetcher,
} from '../adapters/browser/browser-page-observation-adapter.mjs';
import { createOfficialVerificationAdapter } from '../adapters/upstream/official-verification-adapter.mjs';
import { createUpstreamJobExtractionAdapter } from '../adapters/upstream/job-extraction-adapter.mjs';
import { createCareerPortal } from '../domain/career-portal.mjs';
import { createCompany } from '../domain/company.mjs';
import { createJobOpening } from '../domain/job-opening.mjs';
import { createRecruitmentEvent } from '../domain/recruitment-event.mjs';
import { decidePlatformFallback } from '../verification/recruitment-source-policy.mjs';
import { discoverMarketJobs } from './discover-market-jobs.mjs';
import {
  classifyRecruitmentEvent,
  explicitIsoDate,
} from './recruitment-event-classifier.mjs';

const BROWSER_PROVIDER = 'chrome_baidu_visible_search';

function stableId(prefix, value) {
  const digest = createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function createBrowserPlanningModel(query, role) {
  return Object.freeze({
    configured: true,
    async generate({ task }) {
      if (task === 'expand_keywords') {
        return {
          primaryRole: role,
          terms: [role],
          englishTerms: [],
          synonyms: [],
          exclusions: [],
          promptVersion: 'browser-company-keywords-v1',
        };
      }
      if (task === 'plan_queries') {
        return {
          queries: [{
            text: query,
            purpose: 'company_career_discovery',
            preferredSources: ['manual'],
            topK: 20,
          }],
          promptVersion: 'browser-company-query-v1',
        };
      }
      throw new Error(`unsupported browser planning task: ${task}`);
    },
  });
}

function createBrowserSearchSource(adapted) {
  return Object.freeze({
    async search(query) {
      return Object.freeze({
        status: 'ok',
        provider: BROWSER_PROVIDER,
        attempts: Object.freeze([{
          provider: BROWSER_PROVIDER,
          status: 'ok',
          networkRequest: true,
          query: query.text,
        }]),
        liveSearchExecuted: true,
        items: adapted.items,
      });
    },
  });
}

function createBrowserIds(companyResult) {
  const companyKey = companyResult.companyIdentityKey || companyResult.company;
  return Object.freeze({
    intent: () => randomUUID(),
    run: () => randomUUID(),
    company: (candidate) => stableId(
      'company',
      `CN|${candidate.companyIdentityKey || candidate.company || companyKey}`,
    ),
    portal: (candidate) => stableId('portal', candidate.url),
    log: () => randomUUID(),
  });
}

function canonicalHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function registrableDomain(value) {
  try {
    return new URL(String(value || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function explicitTimestamp(value) {
  const date = explicitIsoDate(value);
  return date ? `${date}T00:00:00.000Z` : null;
}

function platformEvidence(candidate, fallbackReason, observedAt) {
  const sourceUrl = canonicalHttpUrl(candidate.url);
  return Object.freeze([{
    code: 'platform_company_identity_match',
    direction: 'NEUTRAL',
    weight: 0,
    observedValue: candidate.platform || registrableDomain(sourceUrl),
    sourceUrl,
    observedAt,
  }, {
    code: 'platform_current_jobs_observed',
    direction: 'NEUTRAL',
    weight: 0,
    observedValue: String(candidate.jobs?.length || 0),
    sourceUrl,
    observedAt,
  }, {
    code: 'platform_fallback_reason',
    direction: 'NEUTRAL',
    weight: 0,
    observedValue: fallbackReason,
    sourceUrl,
    observedAt,
  }]);
}

function createPlatformSnapshot({
  companyResult,
  candidate,
  fallback,
  industry,
  observedAt,
}) {
  const companyKey = companyResult.companyIdentityKey || companyResult.company;
  const company = createCompany({
    id: stableId('company', `CN|${companyKey}`),
    canonicalName: companyResult.company,
    chineseName: companyResult.chineseName || null,
    englishName: companyResult.englishName || null,
    aliases: companyResult.aliases || [],
    officialDomains: companyResult.officialDomain
      ? [companyResult.officialDomain]
      : [],
    industryTags: stringList(industry || companyResult.industry || []),
    countryRegion: companyResult.countryRegion || '中国大陆',
    market: 'CN',
  }, { now: observedAt });
  const canonicalUrl = canonicalHttpUrl(candidate.url);
  const evidence = platformEvidence(candidate, fallback.fallbackReason, observedAt);
  const portal = createCareerPortal({
    id: stableId('portal', canonicalUrl),
    companyId: company.id,
    url: canonicalUrl,
    canonicalUrl,
    registrableDomain: registrableDomain(canonicalUrl),
    atsType: String(candidate.platform || ''),
    pageType: 'JOB_LIST',
    verificationStatus: 'REVIEW',
    confidenceScore: Math.min(49, Number(candidate.confidenceScore) || 49),
    sourceTier: 'PLATFORM_ONLY',
    officialIdentityConfirmed: false,
    platformIdentityConfirmed: candidate.platformIdentityConfirmed === true,
    hiringAvailability: 'OPENINGS_FOUND',
    fallbackReason: fallback.fallbackReason,
    searchCoverage: fallback.searchCoverage || 'PARTIAL',
    evidence,
    lastCheckedAt: observedAt,
  }, { now: observedAt });
  const eventsById = new Map();
  const openings = [];
  for (const rawJob of candidate.jobs || []) {
    const title = String(rawJob?.title || '').replace(/\s+/g, ' ').trim();
    const sourceUrl = canonicalHttpUrl(
      rawJob?.sourceUrl || rawJob?.jobDetailUrl || rawJob?.detailUrl || canonicalUrl,
    );
    if (!title || !sourceUrl) continue;
    const locations = stringList(rawJob.locations || rawJob.location || []);
    const classified = classifyRecruitmentEvent({
      pageTitle: candidate.title || `${companyResult.company}招聘`,
      pageText: candidate.evidence || '',
      jobTitle: title,
      employmentType: rawJob.employmentType || '',
      directoryUrl: canonicalUrl,
      directoryPageType: 'PLATFORM_ONLY',
      sourceTier: 'PLATFORM_ONLY',
      structuredStartAt: rawJob.publishedAt,
      structuredClosesAt: rawJob.closesAt,
      locations,
    });
    const initialEvent = createRecruitmentEvent({
      ...classified,
      companyId: company.id,
      careerPortalId: portal.id,
      sourceTier: 'PLATFORM_ONLY',
      publicationClass: 'PLATFORM_ONLY',
      lastVerifiedAt: observedAt,
    }, { now: observedAt });
    const previous = eventsById.get(initialEvent.id);
    const event = previous
      ? createRecruitmentEvent({
        ...initialEvent,
        firstSeenAt: previous.firstSeenAt,
        locations: [...new Set([...previous.locations, ...initialEvent.locations])],
      }, { now: observedAt })
      : initialEvent;
    eventsById.set(event.id, event);
    openings.push(createJobOpening({
      companyId: company.id,
      careerPortalId: portal.id,
      recruitmentEventId: event.id,
      sourceTier: 'PLATFORM_ONLY',
      sourceJobId: rawJob.sourceJobId || rawJob.jobId || null,
      title,
      locations,
      employmentType: rawJob.employmentType || null,
      publishedAt: explicitTimestamp(rawJob.publishedAt),
      closesAt: explicitTimestamp(rawJob.closesAt),
      jobDetailUrl: canonicalHttpUrl(rawJob.jobDetailUrl || rawJob.detailUrl),
      applyUrl: null,
      status: 'ACTIVE',
      sourceUrl,
    }, { now: observedAt }));
  }
  return Object.freeze({
    company,
    portal,
    evidence,
    events: Object.freeze([...eventsById.values()]),
    openings: Object.freeze(openings),
  });
}

function appendPlatformFallbacks(result, snapshots) {
  if (!snapshots.length) return result;
  const portals = snapshots.map((snapshot) => snapshot.portal);
  const events = snapshots.flatMap((snapshot) => snapshot.events);
  const jobs = snapshots.flatMap((snapshot) => snapshot.openings);
  const report = result.report;
  return Object.freeze({
    ...result,
    companiesDiscovered: Math.max(1, result.companiesDiscovered),
    reviewRequired: result.reviewRequired + portals.length,
    jobsStored: result.jobsStored + jobs.length,
    report: Object.freeze({
      ...report,
      portalDecisions: Object.freeze([
        ...report.portalDecisions,
        ...portals.map((portal) => Object.freeze({
          portalId: portal.id,
          companyId: portal.companyId,
          companyName: snapshots.find((snapshot) => snapshot.portal.id === portal.id)
            ?.company.canonicalName,
          url: portal.canonicalUrl,
          atsType: portal.atsType,
          pageType: portal.pageType,
          sourceTier: portal.sourceTier,
          verificationStatus: portal.verificationStatus,
          confidenceScore: portal.confidenceScore,
          hiringAvailability: portal.hiringAvailability,
          vacancyStatus: 'ACTIVE',
          fallbackReason: portal.fallbackReason,
          evidence: portal.evidence,
        })),
      ]),
      recruitmentEvents: Object.freeze([...report.recruitmentEvents, ...events]),
      extractedJobs: Object.freeze([...report.extractedJobs, ...jobs]),
      reviewCount: report.reviewCount + portals.length,
      extractedJobCount: report.extractedJobCount + jobs.length,
      activeRecruitmentEntryCount: report.activeRecruitmentEntryCount + portals.length,
      quality: Object.freeze({
        ...report.quality,
        platformOnlyAcceptanceCount: (
          Number(report.quality.platformOnlyAcceptanceCount) || 0
        ) + portals.length,
      }),
    }),
  });
}

function createCompanyAtomicStagingRepository(baseRepository) {
  const snapshotsByPortalId = new Map();
  return Object.freeze({
    repository: Object.freeze({
      ...baseRepository,
      persistCompanySnapshot(snapshot) {
        snapshotsByPortalId.set(snapshot.portal.id, snapshot);
        return snapshot.company;
      },
    }),
    add(snapshot) {
      snapshotsByPortalId.set(snapshot.portal.id, snapshot);
    },
    flush() {
      return baseRepository.withTransaction(() => {
        for (const snapshot of snapshotsByPortalId.values()) {
          baseRepository.persistCompanySnapshot(snapshot);
        }
      });
    },
  });
}

function zeroRatio() {
  return Object.freeze({ numerator: 0, denominator: 0, value: null });
}

function failedAtomicPersistenceResult(result, error) {
  const report = result.report;
  const extractionDenominator = Number(
    report.quality.officialJobExtractionSuccessRate?.denominator,
  ) || 0;
  const extractionRate = Object.freeze({
    numerator: 0,
    denominator: extractionDenominator,
    value: extractionDenominator ? 0 : null,
  });
  return Object.freeze({
    ...result,
    status: 'FAILED',
    companiesDiscovered: 0,
    portalsVerified: 0,
    jobsStored: 0,
    usableApplyEntries: 0,
    report: Object.freeze({
      ...report,
      recruitmentEvents: Object.freeze([]),
      extractedJobs: Object.freeze([]),
      officialVerifiedCount: 0,
      extractedJobCount: 0,
      activeRecruitmentEntryCount: 0,
      failures: Object.freeze([
        ...report.failures,
        Object.freeze({
          stage: 'company_snapshot_persistence',
          code: 'FAILED',
          provider: null,
          query: null,
          message: String(error?.message || error || 'snapshot persistence failed').slice(0, 240),
          url: null,
        }),
      ]),
      quality: Object.freeze({
        ...report.quality,
        officialJobExtractionSuccessRate: extractionRate,
        jobExtractionSuccessRate: extractionRate,
        platformOnlyAcceptanceCount: 0,
        missingStartDateRate: zeroRatio(),
        missingCloseDateRate: zeroRatio(),
        missingLocationRate: zeroRatio(),
      }),
    }),
  });
}

export async function ingestBrowserCompanyResult({
  companyResult,
  role = '公开招聘岗位',
  industry = [],
  location = '',
  freshnessDays = 90,
  targetCount = 1000,
} = {}, {
  repository,
  now = () => new Date().toISOString(),
  verificationAdapter = createOfficialVerificationAdapter({ now }),
  resolvePageProvider,
} = {}) {
  if (!companyResult || companyResult.status === 'FAILED' || companyResult.status === 'BLOCKED') {
    throw new Error('a completed browser company result is required');
  }
  if (!repository) throw new Error('repository is required');

  const adapted = adaptBrowserCompanyResult(companyResult);
  const fetchPage = createBrowserObservationFetcher(companyResult.observations || []);
  const jobExtractor = createUpstreamJobExtractionAdapter({
    fetchPage,
    resolvePageProvider,
    now,
  });
  const staged = createCompanyAtomicStagingRepository(repository);

  const result = await discoverMarketJobs({
    market: 'CN',
    roleType: String(role || '公开招聘岗位'),
    industryTags: stringList(industry),
    location: String(location || ''),
    freshnessDays: Math.max(1, Number(freshnessDays) || 90),
    targetCount: Math.max(1, Number(targetCount) || 1000),
  }, {
    repository: staged.repository,
    planningModel: createBrowserPlanningModel(adapted.query, String(role || '公开招聘岗位')),
    searchSource: createBrowserSearchSource(adapted),
    verificationAdapter,
    pageAdvisoryClassifier: null,
    jobExtractor,
    fetchPage,
    ids: createBrowserIds(companyResult),
    now,
    maxQueries: 1,
    openingRetention: 'all_observed_active',
  });

  if (result.status === 'FAILED') return result;
  const officialPortals = result.report.portalDecisions.filter((portal) => (
    portal.sourceTier !== 'PLATFORM_ONLY'
  ));
  const snapshots = [];
  for (const candidate of companyResult.platformCandidates || []) {
    const fallback = decidePlatformFallback({
      officialPortals,
      platformCandidate: candidate,
      searchCoverage: companyResult.failures?.length ? 'PARTIAL' : 'COMPLETE',
    });
    if (!fallback.publish) continue;
    const observedAt = now();
    const snapshot = createPlatformSnapshot({
      companyResult,
      candidate,
      fallback,
      industry,
      observedAt,
    });
    if (!snapshot.openings.length) continue;
    staged.add(snapshot);
    snapshots.push(snapshot);
  }
  const augmented = appendPlatformFallbacks(result, snapshots);
  try {
    staged.flush();
  } catch (error) {
    try {
      repository.completeRun({
        id: result.runId,
        status: 'FAILED',
        completedAt: now(),
        error,
      });
    } catch {
      // The returned report remains FAILED even if run-status persistence also fails.
    }
    return failedAtomicPersistenceResult(augmented, error);
  }
  return augmented;
}
