import { createCareerPortal } from '../domain/career-portal.mjs';
import { createCompany } from '../domain/company.mjs';
import { createDiscoveryLog } from '../domain/discovery-log.mjs';
import { createJobOpening, isRecentOpening } from '../domain/job-opening.mjs';
import { createRecruitmentEvent } from '../domain/recruitment-event.mjs';
import { createSearchIntent } from '../domain/search-intent.mjs';
import { discoverCompanies } from '../discovery/company-discovery.mjs';
import { expandKeywords } from '../discovery/keyword-expander.mjs';
import { planQueries } from '../discovery/query-planner.mjs';
import {
  discoverRecruitmentEntries,
  KNOWN_ATS_REGISTRABLE_DOMAINS,
} from '../discovery/recruitment-entry-discovery.mjs';
import { assertMarketDiscoveryRepository } from '../ports/job-repository.mjs';
import { buildQualityReport } from '../quality/quality-report.mjs';
import { verifyCareerPortal } from '../verification/verification-engine.mjs';
import { classifyRecruitmentEvent } from './recruitment-event-classifier.mjs';

function assertDependencies(dependencies) {
  const requiredFunctions = [
    ['searchSource.search', dependencies?.searchSource?.search],
    ['verificationAdapter.inspect', dependencies?.verificationAdapter?.inspect],
    ['jobExtractor.extract', dependencies?.jobExtractor?.extract],
    ['fetchPage', dependencies?.fetchPage],
  ];
  for (const [name, value] of requiredFunctions) {
    if (typeof value !== 'function') throw new Error(`${name} is required`);
  }
  for (const name of ['intent', 'run', 'company', 'portal', 'log']) {
    if (typeof dependencies?.ids?.[name] !== 'function') {
      throw new Error(`ids.${name} is required`);
    }
  }
  assertMarketDiscoveryRepository(dependencies.repository);
}

function boundedError(error) {
  return String(error?.message || error || 'unknown error').slice(0, 240);
}

function normalizedRole(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function matchesRequestedRole(opening, intent) {
  const title = normalizedRole(opening?.title);
  const requestedRole = normalizedRole(intent.roleType);
  return Boolean(title && requestedRole && title.includes(requestedRole));
}

function matchesRequestedLocation(opening, intent) {
  const requested = normalizedRole(intent.location);
  if (!requested) return true;
  return (opening?.locations || []).some((location) => {
    const observed = normalizedRole(location);
    return observed && (observed.includes(requested) || requested.includes(observed));
  });
}

function hasUsableJobEntry(opening, portal) {
  return Boolean(
    opening?.applyUrl
    || opening?.jobDetailUrl
    || (['JOB_DETAIL', 'APPLY'].includes(portal?.pageType) && opening?.sourceUrl),
  );
}

function canonicalHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function linksFromPage(page = {}) {
  if (Array.isArray(page.links)) return page.links;
  const html = String(page.html || page.body || '');
  const links = [];
  const anchor = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    links.push({
      href: match[1] || match[2] || match[3] || '',
      text: String(match[4] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }
  return links;
}

function entryLogMetadata(candidate = {}) {
  if (!candidate.parentUrl && !candidate.entryDepth && !candidate.recruitmentTypes?.length) {
    return {};
  }
  return {
    parentUrl: candidate.parentUrl || null,
    entryDepth: candidate.entryDepth || 0,
    recruitmentType: candidate.recruitmentTypes?.[0] || null,
    discoveryReason: candidate.discoveryReason || null,
  };
}

function createSnapshotBufferingRepository(baseRepository) {
  const companies = new Map();
  const portals = new Map();
  const evidenceByPortalId = new Map();
  const eventsByPortalId = new Map();
  const openingsByPortalId = new Map();

  function mapForPortal(collection, portalId) {
    if (!collection.has(portalId)) collection.set(portalId, new Map());
    return collection.get(portalId);
  }

  const buffered = {
    ...baseRepository,
    withTransaction(callback) {
      return baseRepository.withTransaction(callback);
    },
    upsertCompany(company) {
      companies.set(company.id, company);
      return company;
    },
    upsertCareerPortal(portal) {
      portals.set(portal.id, portal);
      if (portal.verificationStatus !== 'VERIFIED') {
        eventsByPortalId.delete(portal.id);
        openingsByPortalId.delete(portal.id);
      }
      return portal;
    },
    replaceVerificationEvidence(careerPortalId, evidence = []) {
      if (portals.has(careerPortalId)) {
        evidenceByPortalId.set(careerPortalId, [...evidence]);
      }
      return evidence;
    },
    upsertRecruitmentEvent(event) {
      mapForPortal(eventsByPortalId, event.careerPortalId).set(event.id, event);
      return event;
    },
    upsertJobOpening(opening) {
      mapForPortal(openingsByPortalId, opening.careerPortalId).set(opening.id, opening);
      return opening;
    },
    upsertPlatformJobOpening(opening) {
      mapForPortal(openingsByPortalId, opening.careerPortalId).set(opening.id, opening);
      return opening;
    },
    flushCompanySnapshots() {
      for (const portal of portals.values()) {
        const company = companies.get(portal.companyId);
        if (!company) {
          const error = new Error(`snapshot company missing for portal: ${portal.id}`);
          error.failureStage = 'company_snapshot_persistence';
          throw error;
        }
        try {
          baseRepository.persistCompanySnapshot({
            company,
            portal,
            evidence: evidenceByPortalId.get(portal.id) || [],
            events: [...(eventsByPortalId.get(portal.id)?.values() || [])],
            openings: [...(openingsByPortalId.get(portal.id)?.values() || [])],
          });
        } catch (error) {
          error.failureStage = 'company_snapshot_persistence';
          throw error;
        }
      }
    },
  };
  return buffered;
}

export async function discoverMarketJobs(input, dependencies = {}) {
  assertDependencies(dependencies);
  const {
    planningModel,
    searchSource,
    verificationAdapter,
    pageAdvisoryClassifier = null,
    jobExtractor,
    repository: baseRepository,
    fetchPage,
    ids,
    now = () => new Date().toISOString(),
    maxQueries = 12,
    openingRetention = 'requested_recent',
  } = dependencies;
  const repository = createSnapshotBufferingRepository(baseRepository);

  const intent = createSearchIntent(input, { id: ids.intent(), now: now() });
  const runId = ids.run();
  const counters = {
    companiesDiscovered: 0,
    portalsVerified: 0,
    jobsStored: 0,
    reviewRequired: 0,
    rejected: 0,
    blocked: 0,
    usableApplyEntries: 0,
  };
  const failures = [];
  const qualityObservations = {
    portalsEvaluated: 0,
    extractionAttempts: 0,
    extractionSuccesses: 0,
    confidenceScores: [],
  };
  const evaluatedPortalIds = new Set();
  const verifiedPortalIds = new Set();
  const reviewPortalIds = new Set();
  const rejectedPortalIds = new Set();
  const blockedPortalIds = new Set();
  const extractionAttemptPortalIds = new Set();
  const extractionSuccessPortalIds = new Set();
  const storedJobIds = new Set();
  const usableApplyJobIds = new Set();
  const confidenceByPortalId = new Map();
  const portalDecisionsById = new Map();
  const recruitmentEventsById = new Map();
  const storedJobsById = new Map();
  const jobIdsByPortalId = new Map();
  const discoveredCompanyKeys = new Set();
  const processedCandidateUrls = new Set();
  const queuedCandidateUrls = new Set();
  const childEntriesByCompany = new Map();
  const noOpeningPortalIds = new Set();
  const unknownVacancyPortalIds = new Set();
  const activeOpeningPortalIds = new Set();
  repository.beginRun({ id: runId, intent, startedAt: now() });
  let liveSearchExecuted = false;
  let discovery = null;

  const appendLog = (candidate, keywords, outcome, metadata = {}, resultUrl = null) => {
    repository.appendDiscoveryLog(createDiscoveryLog({
      id: ids.log(),
      runId,
      searchIntentId: intent.id,
      query: candidate?.query || '',
      expandedKeywords: keywords?.terms || [],
      searchSource: candidate?.searchSource || '',
      searchedAt: now(),
      resultUrl: resultUrl || candidate?.url || null,
      resultRank: candidate?.rank ?? null,
      outcome,
      metadata: {
        ...entryLogMetadata(candidate),
        ...metadata,
      },
    }));
  };
  const recordFailure = (failure) => {
    failures.push(Object.freeze({
      stage: failure.stage,
      code: failure.code || 'FAILED',
      provider: failure.provider || null,
      query: failure.query || null,
      message: boundedError(failure.message),
      url: failure.url || null,
    }));
  };
  const buildRunReport = () => {
    const candidates = discovery?.candidates || [];
    const portalDecisions = [...portalDecisionsById.values()];
    const officialPortalDecisions = portalDecisions.filter((portal) => (
      portal.sourceTier !== 'PLATFORM_ONLY'
    ));
    const platformPortalDecisions = portalDecisions.filter((portal) => (
      portal.sourceTier === 'PLATFORM_ONLY'
    ));
    const officialPortalIds = new Set(officialPortalDecisions.map((portal) => portal.portalId));
    const recruitmentEvents = [...recruitmentEventsById.values()];
    let llmUsage = [];
    if (typeof repository.listLlmUsage === 'function') {
      llmUsage = repository.listLlmUsage().filter((item) => item.runId === runId);
    }
    return Object.freeze({
      searchQueries: Object.freeze([...(discovery?.searchQueries || [])]),
      candidateUrlCount: discovery?.candidateUrlCount || 0,
      candidateCompanyCount: discovery?.candidateCompanyCount || 0,
      candidateUrls: Object.freeze(candidates.map((candidate) => candidate.url)),
      candidateCompanies: Object.freeze([
        ...new Map(candidates.map((candidate) => [
          candidate.companyIdentityKey || candidate.company,
          Object.freeze({
            identityKey: candidate.companyIdentityKey || candidate.company,
            name: candidate.company,
            aliases: Object.freeze([...(candidate.aliases || [])]),
            confirmedOfficialDomain: candidate.confirmedOfficialDomain || null,
          }),
        ])).values(),
      ]),
      portalDecisions: Object.freeze(portalDecisions),
      recruitmentEvents: Object.freeze(recruitmentEvents),
      extractedJobs: Object.freeze([...storedJobsById.values()]),
      officialVerifiedCount: counters.portalsVerified,
      reviewCount: counters.reviewRequired,
      rejectedCount: counters.rejected,
      extractedJobCount: counters.jobsStored,
      recruitmentEntryInspectionCount: evaluatedPortalIds.size,
      activeRecruitmentEntryCount: activeOpeningPortalIds.size,
      noOpeningRecruitmentEntryCount: [...noOpeningPortalIds].filter((portalId) => (
        verifiedPortalIds.has(portalId) && !activeOpeningPortalIds.has(portalId)
      )).length,
      unknownRecruitmentEntryCount: [...unknownVacancyPortalIds].filter((portalId) => (
        verifiedPortalIds.has(portalId)
        && !activeOpeningPortalIds.has(portalId)
        && !noOpeningPortalIds.has(portalId)
      )).length,
      failures: Object.freeze([...failures]),
      providerAttempts: Object.freeze([...(discovery?.providerAttempts || [])]),
      llmUsage: Object.freeze(llmUsage),
      quality: buildQualityReport({
        ...qualityObservations,
        portalsEvaluated: officialPortalDecisions.length,
        portalsVerified: officialPortalDecisions.filter((portal) => (
          portal.verificationStatus === 'VERIFIED'
        )).length,
        officialExtractionAttempts: [...extractionAttemptPortalIds].filter((portalId) => (
          officialPortalIds.has(portalId)
        )).length,
        officialExtractionSuccesses: [...extractionSuccessPortalIds].filter((portalId) => (
          officialPortalIds.has(portalId)
        )).length,
        platformOnlyAcceptanceCount: platformPortalDecisions.filter((portal) => (
          portal.hiringAvailability === 'OPENINGS_FOUND'
        )).length,
        platformOnlySupersededCount: platformPortalDecisions.filter((portal) => (
          Boolean(portal.supersededByPortalId)
        )).length,
        rejectedPortals: officialPortalDecisions.filter((portal) => (
          portal.verificationStatus === 'REJECTED'
        )).length,
        officialConfidenceScores: officialPortalDecisions.map((portal) => portal.confidenceScore),
        availabilityEvaluated: officialPortalDecisions.length,
        unknownAvailabilityCount: officialPortalDecisions.filter((portal) => (
          portal.hiringAvailability === 'UNKNOWN'
        )).length,
        blockedPortals: officialPortalDecisions.filter((portal) => (
          portal.verificationStatus === 'BLOCKED'
        )).length,
        recruitmentEventsEvaluated: recruitmentEvents.length,
        missingStartDates: recruitmentEvents.filter((event) => !event.startAt).length,
        missingCloseDates: recruitmentEvents.filter((event) => !event.closesAt).length,
        missingLocations: recruitmentEvents.filter((event) => !event.locations.length).length,
        validCandidateResults: discovery?.validCandidateResults || 0,
        duplicateCandidateResults: discovery?.duplicateCandidateResults || 0,
      }),
    });
  };

  if (planningModel?.configured === false) {
    recordFailure({
      stage: 'configuration',
      code: 'NOT_CONFIGURED',
      message: 'planning model is not configured',
    });
    repository.completeRun({
      id: runId,
      status: 'NOT_CONFIGURED',
      completedAt: now(),
    });
    return Object.freeze({
      runId,
      intent,
      status: 'NOT_CONFIGURED',
      ...counters,
      providerAttempts: Object.freeze([]),
      liveSearchExecuted: false,
      report: buildRunReport(),
    });
  }

  try {
    let keywords;
    try {
      keywords = await expandKeywords(intent, { planningModel, runId });
    } catch (error) {
      error.failureStage = 'keyword_expansion';
      throw error;
    }
    let queryPlan;
    try {
      queryPlan = await planQueries(intent, keywords, {
        planningModel,
        maxQueries,
        runId,
      });
    } catch (error) {
      error.failureStage = 'query_planning';
      throw error;
    }
    discovery = await discoverCompanies({
      intent,
      queryPlan,
      runId,
      searchSource,
      now: now(),
    });
    liveSearchExecuted = discovery.liveSearchExecuted;
    failures.push(...discovery.failures);
    for (const log of discovery.logs) repository.appendDiscoveryLog(log);

    const candidateQueue = discovery.candidates.map((candidate) => ({
      ...candidate,
      parentUrl: null,
      entryDepth: 0,
    }));
    for (const candidate of candidateQueue) {
      const queuedUrl = canonicalHttpUrl(candidate.url);
      if (queuedUrl) queuedCandidateUrls.add(queuedUrl);
    }

    while (candidateQueue.length) {
      const candidate = candidateQueue.shift();
      const candidateUrl = canonicalHttpUrl(candidate.url);
      if (candidateUrl) {
        queuedCandidateUrls.delete(candidateUrl);
        if (processedCandidateUrls.has(candidateUrl)) continue;
        processedCandidateUrls.add(candidateUrl);
      }

      let company = createCompany({
        id: ids.company(candidate),
        canonicalName: candidate.company,
        chineseName: candidate.chineseName || null,
        englishName: candidate.englishName || null,
        aliases: candidate.aliases || [],
        primaryOfficialDomain: candidate.confirmedOfficialDomain || null,
        officialDomains: candidate.confirmedOfficialDomain
          ? [candidate.confirmedOfficialDomain]
          : [],
        industryTags: intent.industryTags,
        countryRegion: candidate.countryRegion || (intent.market === 'CN' ? '中国大陆' : null),
        market: intent.market,
      }, { now: now() });
      const companyKey = candidate.companyIdentityKey || candidate.company;
      if (!discoveredCompanyKeys.has(companyKey)) {
        discoveredCompanyKeys.add(companyKey);
        counters.companiesDiscovered = discoveredCompanyKeys.size;
      }

      let page;
      try {
        page = await fetchPage(candidate.url);
      } catch (error) {
        recordFailure({
          stage: 'page_fetch',
          code: 'FETCH_FAILED',
          query: candidate.query,
          message: error,
          url: candidate.url,
        });
        appendLog(candidate, keywords, 'FETCH_FAILED', {
          stage: 'page_fetch',
          error: boundedError(error),
        });
        continue;
      }

      let inspected;
      try {
        inspected = await verificationAdapter.inspect({ company, candidate, page });
      } catch (error) {
        recordFailure({
          stage: 'verification_inspection',
          code: 'FAILED',
          query: candidate.query,
          message: error,
          url: page.finalUrl || candidate.url,
        });
        appendLog(candidate, keywords, 'FETCH_FAILED', {
          stage: 'verification_inspection',
          error: boundedError(error),
        }, page.finalUrl || candidate.url);
        continue;
      }

      const decision = verifyCareerPortal(inspected);
      let advisory = null;
      if (
        decision.verificationStatus === 'REVIEW'
        && typeof pageAdvisoryClassifier === 'function'
      ) {
        try {
          advisory = await pageAdvisoryClassifier({
            url: page.finalUrl || candidate.url,
            title: page.title || '',
            text: page.text || page.html || '',
          }, { runId });
        } catch (error) {
          recordFailure({
            stage: 'llm_advisory',
            code: 'FAILED',
            query: candidate.query,
            message: error,
            url: page.finalUrl || candidate.url,
          });
          appendLog(candidate, keywords, 'REVIEW_REQUIRED', {
            stage: 'llm_advisory',
            error: boundedError(error),
          }, page.finalUrl || candidate.url);
        }
      }
      const observedAt = now();
      const portalEvidence = [...decision.evidence, ...(advisory ? [advisory] : [])]
        .map((item) => ({
          ...item,
          sourceUrl: item.sourceUrl || page.finalUrl || candidate.url,
          observedAt: item.observedAt || observedAt,
        }));
      try {
        company = repository.upsertCompany(company);
      } catch (error) {
        if (error?.code !== 'COMPANY_MERGE_CONFLICT') throw error;
        const reviewKey = page.finalUrl || candidate.url;
        reviewPortalIds.add(reviewKey);
        counters.reviewRequired = reviewPortalIds.size;
        recordFailure({
          stage: 'company_merge',
          code: 'COMPANY_MERGE_CONFLICT',
          query: candidate.query,
          message: error,
          url: reviewKey,
        });
        appendLog(candidate, keywords, 'REVIEW_REQUIRED', {
          stage: 'company_merge',
          reason: 'company_merge_conflict',
          error: boundedError(error),
        }, reviewKey);
        continue;
      }
      let portal = createCareerPortal({
        id: ids.portal({ ...candidate, url: page.finalUrl || candidate.url }),
        companyId: company.id,
        url: candidate.url,
        canonicalUrl: page.finalUrl || candidate.url,
        registrableDomain: inspected.registrableDomain,
        atsType: inspected.atsType,
        pageType: decision.pageType,
        verificationStatus: decision.verificationStatus,
        confidenceScore: decision.confidenceScore,
        sourceTier: inspected.atsType ? 'OFFICIAL_ATS' : 'OFFICIAL_SITE',
        officialIdentityConfirmed: decision.verificationStatus === 'VERIFIED',
        hiringAvailability: inspected.vacancyStatus === 'NO_OPENINGS'
          ? 'NO_OPENINGS'
          : 'UNKNOWN',
        searchCoverage: 'PARTIAL',
        recruitmentTypes: candidate.recruitmentTypes || [],
        evidence: portalEvidence,
        lastVerifiedAt: observedAt,
        lastCheckedAt: observedAt,
      }, { now: observedAt });

      repository.withTransaction(() => {
        repository.upsertCareerPortal(portal);
        repository.replaceVerificationEvidence(portal.id, portalEvidence);
      });

      if (!evaluatedPortalIds.has(portal.id)) {
        evaluatedPortalIds.add(portal.id);
        qualityObservations.portalsEvaluated = evaluatedPortalIds.size;
      }
      confidenceByPortalId.set(portal.id, decision.confidenceScore);
      qualityObservations.confidenceScores = [...confidenceByPortalId.values()];
      noOpeningPortalIds.delete(portal.id);
      unknownVacancyPortalIds.delete(portal.id);
      if (inspected.vacancyStatus === 'NO_OPENINGS') noOpeningPortalIds.add(portal.id);
      else if (inspected.vacancyStatus === 'UNKNOWN') unknownVacancyPortalIds.add(portal.id);
      portalDecisionsById.set(portal.id, Object.freeze({
        portalId: portal.id,
        companyId: company.id,
        companyName: company.canonicalName,
        url: portal.canonicalUrl,
        atsType: portal.atsType,
        pageType: portal.pageType,
        sourceTier: portal.sourceTier,
        verificationStatus: portal.verificationStatus,
        confidenceScore: portal.confidenceScore,
        hiringAvailability: portal.hiringAvailability,
        vacancyStatus: inspected.vacancyStatus || 'UNKNOWN',
        evidence: portal.evidence,
      }));

      const outcome = decision.verificationStatus === 'VERIFIED'
        ? 'VERIFIED_PORTAL'
        : decision.verificationStatus === 'REJECTED'
          ? 'REJECTED'
          : 'REVIEW_REQUIRED';
      appendLog(candidate, keywords, outcome, {
        verificationStatus: decision.verificationStatus,
        confidenceScore: decision.confidenceScore,
        hardRejectReasons: decision.hardRejectReasons,
        vacancyStatus: inspected.vacancyStatus || 'UNKNOWN',
        llmAdvisory: advisory?.observedValue || null,
      }, portal.canonicalUrl);

      reviewPortalIds.delete(portal.id);
      rejectedPortalIds.delete(portal.id);
      blockedPortalIds.delete(portal.id);
      if (decision.verificationStatus === 'BLOCKED') {
        blockedPortalIds.add(portal.id);
        reviewPortalIds.add(portal.id);
      }
      if (decision.verificationStatus === 'REVIEW') reviewPortalIds.add(portal.id);
      if (decision.verificationStatus === 'REJECTED') rejectedPortalIds.add(portal.id);
      if (decision.verificationStatus !== 'VERIFIED') {
        verifiedPortalIds.delete(portal.id);
        activeOpeningPortalIds.delete(portal.id);
        extractionAttemptPortalIds.delete(portal.id);
        extractionSuccessPortalIds.delete(portal.id);
        for (const jobId of jobIdsByPortalId.get(portal.id) || []) {
          storedJobIds.delete(jobId);
          usableApplyJobIds.delete(jobId);
          storedJobsById.delete(jobId);
        }
        jobIdsByPortalId.delete(portal.id);
      }
      counters.reviewRequired = reviewPortalIds.size;
      counters.blocked = blockedPortalIds.size;
      counters.rejected = rejectedPortalIds.size;
      counters.portalsVerified = verifiedPortalIds.size;
      counters.jobsStored = storedJobIds.size;
      counters.usableApplyEntries = usableApplyJobIds.size;
      qualityObservations.extractionAttempts = extractionAttemptPortalIds.size;
      qualityObservations.extractionSuccesses = extractionSuccessPortalIds.size;
      if (decision.verificationStatus !== 'VERIFIED') continue;

      const firstVerifiedObservation = !verifiedPortalIds.has(portal.id);
      verifiedPortalIds.add(portal.id);
      counters.portalsVerified = verifiedPortalIds.size;
      const childCount = childEntriesByCompany.get(companyKey) || 0;
      const remainingChildBudget = Math.max(0, 20 - childCount);
      if (remainingChildBudget > 0) {
        const nextDepth = Number(candidate.entryDepth || 0) + 1;
        const parentOfficialVerified = !portal.atsType
          && (company.officialDomains || []).includes(portal.registrableDomain);
        const entries = discoverRecruitmentEntries({
          baseUrl: portal.canonicalUrl,
          links: linksFromPage(page),
          trustedRegistrableDomains: company.officialDomains,
          knownAtsRegistrableDomains: KNOWN_ATS_REGISTRABLE_DOMAINS,
          parentOfficialVerified,
          visitedUrls: [...processedCandidateUrls, ...queuedCandidateUrls],
          parentUrl: portal.canonicalUrl,
          depth: nextDepth,
          maxDepth: 2,
          maxEntries: remainingChildBudget,
        });
        for (const entry of entries) {
          const entryUrl = canonicalHttpUrl(entry.url);
          if (!entryUrl || processedCandidateUrls.has(entryUrl) || queuedCandidateUrls.has(entryUrl)) {
            continue;
          }
          candidateQueue.push({
            ...candidate,
            url: entry.url,
            title: entry.text || candidate.title,
            rank: null,
            parentUrl: entry.parentUrl,
            entryDepth: entry.depth,
            parentOfficialVerified: entry.parentOfficialVerified === true,
            officialAttributionUrl: entry.officialAttributionUrl || null,
            verifiedTenant: entry.discoveryReason === 'verified_official_outbound_ats_link',
            recruitmentTypes: entry.recruitmentType === 'general'
              ? []
              : [entry.recruitmentType],
            discoveryReason: entry.discoveryReason,
          });
          queuedCandidateUrls.add(entryUrl);
          childEntriesByCompany.set(
            companyKey,
            (childEntriesByCompany.get(companyKey) || 0) + 1,
          );
        }
      }
      if (!firstVerifiedObservation) continue;
      if (inspected.vacancyStatus === 'NO_OPENINGS') {
        appendLog(candidate, keywords, 'NO_RECENT_JOBS', {
          reason: 'explicit_no_openings',
          vacancyStatus: 'NO_OPENINGS',
        }, portal.canonicalUrl);
        continue;
      }
      extractionAttemptPortalIds.add(portal.id);
      qualityObservations.extractionAttempts = extractionAttemptPortalIds.size;
      let openings;
      try {
        openings = await jobExtractor.extract({ company, portal, intent, page });
      } catch (error) {
        recordFailure({
          stage: 'job_extraction',
          code: 'FAILED',
          query: candidate.query,
          message: error,
          url: portal.canonicalUrl,
        });
        appendLog(candidate, keywords, 'FETCH_FAILED', {
          stage: 'job_extraction',
          error: boundedError(error),
        }, portal.canonicalUrl);
        continue;
      }

      const observedActiveOpenings = (openings || []).filter((opening) => (
        opening.status === 'ACTIVE' && hasUsableJobEntry(opening, portal)
      ));
      if (observedActiveOpenings.length) activeOpeningPortalIds.add(portal.id);
      else activeOpeningPortalIds.delete(portal.id);
      let storedForPortal = 0;
      const missingFieldsForPortal = new Set();
      const fieldCoverage = {
        location: { present: 0, missing: 0 },
        publishedAt: { present: 0, missing: 0 },
        closesAt: { present: 0, missing: 0 },
        recruitmentType: { present: 0, missing: 0 },
        applyUrl: { present: 0, missing: 0 },
      };
      const retainAllObserved = openingRetention === 'all_observed_active';
      for (const opening of openings || []) {
        if (counters.jobsStored >= intent.targetCount) break;
        const openingFieldPresence = {
          location: Boolean(opening.locations?.length),
          publishedAt: Boolean(opening.publishedAt),
          closesAt: Boolean(opening.closesAt),
          recruitmentType: Boolean(opening.employmentType || portal.recruitmentTypes.length),
          applyUrl: Boolean(opening.applyUrl),
        };
        const rejectionReason = opening.status !== 'ACTIVE'
          ? 'opening_not_active'
          : !retainAllObserved && !matchesRequestedRole(opening, intent)
            ? 'role_mismatch'
            : !retainAllObserved && !matchesRequestedLocation(opening, intent)
              ? 'location_mismatch'
            : !hasUsableJobEntry(opening, portal)
                ? 'usable_job_entry_missing'
                : null;
        if (rejectionReason || (!retainAllObserved && !isRecentOpening(opening, {
          freshnessDays: intent.freshnessDays,
          now: Date.parse(now()),
        }))) {
          appendLog(candidate, keywords, 'NO_RECENT_JOBS', {
            publishedAt: opening.publishedAt,
            reason: rejectionReason || 'outside_freshness_window',
          }, opening.sourceUrl);
          continue;
        }
        let classifiedEvent;
        try {
          classifiedEvent = classifyRecruitmentEvent({
            pageTitle: page.title || '',
            pageText: page.text || page.html || page.body || '',
            linkText: candidate.title || '',
            jobTitle: opening.title,
            employmentType: opening.employmentType || '',
            directoryUrl: portal.canonicalUrl,
            directoryPageType: portal.pageType,
            sourceTier: portal.sourceTier,
            structuredStartAt: page.startAt ?? page.publishedAt ?? opening.publishedAt,
            structuredClosesAt: page.closesAt ?? opening.closesAt,
            locations: opening.locations,
          });
        } catch (error) {
          recordFailure({
            stage: 'recruitment_event_classification',
            code: 'FAILED',
            query: candidate.query,
            message: error,
            url: portal.canonicalUrl,
          });
          appendLog(candidate, keywords, 'REVIEW_REQUIRED', {
            stage: 'recruitment_event_classification',
            error: boundedError(error),
          }, portal.canonicalUrl);
          continue;
        }

        let recruitmentEvent = createRecruitmentEvent({
          ...classifiedEvent,
          companyId: company.id,
          careerPortalId: portal.id,
          sourceTier: portal.sourceTier,
          lastVerifiedAt: observedAt,
        }, { now: observedAt });
        const previousEvent = recruitmentEventsById.get(recruitmentEvent.id);
        if (previousEvent) {
          const explicitStarts = [previousEvent.startAt, recruitmentEvent.startAt]
            .filter(Boolean)
            .sort();
          const explicitCloses = [previousEvent.closesAt, recruitmentEvent.closesAt]
            .filter(Boolean)
            .sort();
          recruitmentEvent = createRecruitmentEvent({
            ...recruitmentEvent,
            locations: [
              ...new Set([
                ...previousEvent.locations,
                ...recruitmentEvent.locations,
              ]),
            ],
            startAt: explicitStarts[0] || null,
            closesAt: explicitCloses[0] || null,
            firstSeenAt: previousEvent.firstSeenAt,
          }, { now: observedAt });
        }
        recruitmentEventsById.set(recruitmentEvent.id, recruitmentEvent);
        repository.upsertRecruitmentEvent(recruitmentEvent);

        const { id: legacyOpeningId, ...openingData } = opening;
        const storedOpening = createJobOpening({
          ...openingData,
          recruitmentEventId: recruitmentEvent.id,
          sourceTier: portal.sourceTier,
        }, { now: opening.firstSeenAt || observedAt });
        if (storedJobIds.has(storedOpening.id)) continue;
        repository.upsertJobOpening(storedOpening);
        storedJobIds.add(storedOpening.id);
        storedJobsById.set(storedOpening.id, storedOpening);
        const portalJobIds = jobIdsByPortalId.get(portal.id) || new Set();
        portalJobIds.add(storedOpening.id);
        jobIdsByPortalId.set(portal.id, portalJobIds);
        for (const [field, present] of Object.entries(openingFieldPresence)) {
          fieldCoverage[field][present ? 'present' : 'missing'] += 1;
          if (!present) missingFieldsForPortal.add(field);
        }
        counters.jobsStored = storedJobIds.size;
        if (storedOpening.applyUrl) usableApplyJobIds.add(storedOpening.id);
        counters.usableApplyEntries = usableApplyJobIds.size;
        storedForPortal += 1;
      }
      if (storedForPortal > 0) {
        portal = createCareerPortal({
          ...portal,
          hiringAvailability: 'OPENINGS_FOUND',
          lastCheckedAt: observedAt,
        }, { now: observedAt });
        repository.upsertCareerPortal(portal);
        portalDecisionsById.set(portal.id, Object.freeze({
          ...portalDecisionsById.get(portal.id),
          hiringAvailability: portal.hiringAvailability,
        }));
        extractionSuccessPortalIds.add(portal.id);
        qualityObservations.extractionSuccesses = extractionSuccessPortalIds.size;
        appendLog(candidate, keywords, 'JOBS_EXTRACTED', {
          count: storedForPortal,
          vacancyStatus: 'ACTIVE',
          observedActiveCount: observedActiveOpenings.length,
          fieldCoverage,
          missingFields: [...missingFieldsForPortal],
        }, portal.canonicalUrl);
      } else if (!(openings || []).length) {
        appendLog(candidate, keywords, 'NO_RECENT_JOBS', {
          reason: 'no_openings_extracted',
        }, portal.canonicalUrl);
      } else if (observedActiveOpenings.length) {
        appendLog(candidate, keywords, 'NO_RECENT_JOBS', {
          reason: 'no_requested_role_jobs',
          vacancyStatus: 'ACTIVE',
          observedActiveCount: observedActiveOpenings.length,
        }, portal.canonicalUrl);
      }
    }

    const quantityStatus = counters.jobsStored >= intent.targetCount ? 'COMPLETE' : 'PARTIAL';
    const terminalStatus = ['DEFERRED_BY_BUDGET', 'NOT_CONFIGURED', 'BLOCKED', 'FAILED'].includes(discovery.status)
      ? discovery.status
      : counters.blocked > 0 && counters.jobsStored < intent.targetCount
        ? 'BLOCKED'
        : quantityStatus;
    repository.flushCompanySnapshots();
    repository.completeRun({ id: runId, status: terminalStatus, completedAt: now() });
    return Object.freeze({
      runId,
      intent,
      status: terminalStatus,
      ...counters,
      providerAttempts: discovery.providerAttempts,
      liveSearchExecuted: discovery.liveSearchExecuted,
      report: buildRunReport(),
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (failure.failureStage === 'company_snapshot_persistence') {
      counters.companiesDiscovered = 0;
      counters.portalsVerified = 0;
      counters.jobsStored = 0;
      counters.usableApplyEntries = 0;
      qualityObservations.extractionSuccesses = 0;
    }
    recordFailure({
      stage: failure.failureStage || (discovery ? 'discovery_processing' : 'discovery'),
      code: 'FAILED',
      message: failure,
    });
    try {
      repository.completeRun({
        id: runId,
        status: 'FAILED',
        completedAt: now(),
        error: failure,
      });
    } catch (completionError) {
      completionError.liveSearchExecuted = liveSearchExecuted;
      completionError.runId = runId;
      completionError.report = buildRunReport();
      completionError.partialResult = { ...counters };
      throw completionError;
    }
    return Object.freeze({
      runId,
      intent,
      status: 'FAILED',
      ...counters,
      providerAttempts: Object.freeze([...(discovery?.providerAttempts || [])]),
      liveSearchExecuted,
      report: buildRunReport(),
    });
  }
}
