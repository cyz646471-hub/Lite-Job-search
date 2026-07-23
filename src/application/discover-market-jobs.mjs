import { createCareerPortal } from '../domain/career-portal.mjs';
import { createCompany } from '../domain/company.mjs';
import { createDiscoveryLog } from '../domain/discovery-log.mjs';
import { isRecentOpening } from '../domain/job-opening.mjs';
import { createSearchIntent } from '../domain/search-intent.mjs';
import { discoverCompanies } from '../discovery/company-discovery.mjs';
import { expandKeywords } from '../discovery/keyword-expander.mjs';
import { planQueries } from '../discovery/query-planner.mjs';
import { assertMarketDiscoveryRepository } from '../ports/job-repository.mjs';
import { buildQualityReport } from '../quality/quality-report.mjs';
import { verifyCareerPortal } from '../verification/verification-engine.mjs';

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

function hasUsableJobEntry(opening, portal) {
  return Boolean(
    opening?.applyUrl
    || opening?.jobDetailUrl
    || (['JOB_DETAIL', 'APPLY'].includes(portal?.pageType) && opening?.sourceUrl),
  );
}

export async function discoverMarketJobs(input, dependencies = {}) {
  assertDependencies(dependencies);
  const {
    planningModel,
    searchSource,
    verificationAdapter,
    pageAdvisoryClassifier = null,
    jobExtractor,
    repository,
    fetchPage,
    ids,
    now = () => new Date().toISOString(),
    maxQueries = 12,
  } = dependencies;

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
  repository.beginRun({ id: runId, intent, startedAt: now() });
  let liveSearchExecuted = false;

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
      metadata,
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

  try {
    const keywords = await expandKeywords(intent, { planningModel, runId });
    const queryPlan = await planQueries(intent, keywords, {
      planningModel,
      maxQueries,
      runId,
    });
    const discovery = await discoverCompanies({
      intent,
      queryPlan,
      runId,
      searchSource,
      now: now(),
    });
    liveSearchExecuted = discovery.liveSearchExecuted;
    failures.push(...discovery.failures);
    for (const log of discovery.logs) repository.appendDiscoveryLog(log);

    for (const candidate of discovery.candidates) {
      if (counters.jobsStored >= intent.targetCount) break;

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
      counters.companiesDiscovered += 1;

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
      qualityObservations.portalsEvaluated += 1;
      qualityObservations.confidenceScores.push(decision.confidenceScore);
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
          });
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
      company = repository.upsertCompany(company);
      const portal = createCareerPortal({
        id: ids.portal({ ...candidate, url: page.finalUrl || candidate.url }),
        companyId: company.id,
        url: candidate.url,
        canonicalUrl: page.finalUrl || candidate.url,
        registrableDomain: inspected.registrableDomain,
        atsType: inspected.atsType,
        pageType: decision.pageType,
        verificationStatus: decision.verificationStatus,
        confidenceScore: decision.confidenceScore,
        recruitmentTypes: candidate.recruitmentTypes || [],
        evidence: portalEvidence,
        lastVerifiedAt: observedAt,
      }, { now: observedAt });

      repository.withTransaction(() => {
        repository.upsertCareerPortal(portal);
        repository.replaceVerificationEvidence(portal.id, portalEvidence);
      });

      const outcome = decision.verificationStatus === 'VERIFIED'
        ? 'VERIFIED_PORTAL'
        : decision.verificationStatus === 'REJECTED'
          ? 'REJECTED'
          : 'REVIEW_REQUIRED';
      appendLog(candidate, keywords, outcome, {
        verificationStatus: decision.verificationStatus,
        confidenceScore: decision.confidenceScore,
        hardRejectReasons: decision.hardRejectReasons,
        llmAdvisory: advisory?.observedValue || null,
      }, portal.canonicalUrl);

      if (['REVIEW', 'BLOCKED'].includes(decision.verificationStatus)) {
        counters.reviewRequired += 1;
      }
      if (decision.verificationStatus === 'BLOCKED') counters.blocked += 1;
      if (decision.verificationStatus === 'REJECTED') counters.rejected += 1;
      if (decision.verificationStatus !== 'VERIFIED') continue;

      counters.portalsVerified += 1;
      qualityObservations.extractionAttempts += 1;
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

      let storedForPortal = 0;
      for (const opening of openings || []) {
        if (counters.jobsStored >= intent.targetCount) break;
        const rejectionReason = opening.status !== 'ACTIVE'
          ? 'opening_not_active'
          : !matchesRequestedRole(opening, intent)
            ? 'role_mismatch'
            : !hasUsableJobEntry(opening, portal)
              ? 'usable_job_entry_missing'
              : null;
        if (rejectionReason || !isRecentOpening(opening, {
          freshnessDays: intent.freshnessDays,
          now: Date.parse(now()),
        })) {
          appendLog(candidate, keywords, 'NO_RECENT_JOBS', {
            publishedAt: opening.publishedAt,
            reason: rejectionReason || 'outside_freshness_window',
          }, opening.sourceUrl);
          continue;
        }
        repository.upsertJobOpening(opening);
        counters.jobsStored += 1;
        if (opening.applyUrl) counters.usableApplyEntries += 1;
        storedForPortal += 1;
      }
      if (storedForPortal > 0) {
        qualityObservations.extractionSuccesses += 1;
        appendLog(candidate, keywords, 'JOBS_EXTRACTED', {
          count: storedForPortal,
        }, portal.canonicalUrl);
      } else if (!(openings || []).length) {
        appendLog(candidate, keywords, 'NO_RECENT_JOBS', {
          reason: 'no_openings_extracted',
        }, portal.canonicalUrl);
      }
    }

    const quantityStatus = counters.jobsStored >= intent.targetCount ? 'COMPLETE' : 'PARTIAL';
    const terminalStatus = ['DEFERRED_BY_BUDGET', 'NOT_CONFIGURED', 'BLOCKED', 'FAILED'].includes(discovery.status)
      ? discovery.status
      : counters.blocked > 0 && counters.jobsStored < intent.targetCount
        ? 'BLOCKED'
        : quantityStatus;
    repository.completeRun({ id: runId, status: terminalStatus, completedAt: now() });
    return Object.freeze({
      runId,
      intent,
      status: terminalStatus,
      ...counters,
      providerAttempts: discovery.providerAttempts,
      liveSearchExecuted: discovery.liveSearchExecuted,
      report: Object.freeze({
        searchQueries: discovery.searchQueries,
        candidateUrlCount: discovery.candidateUrlCount,
        candidateCompanyCount: discovery.candidateCompanyCount,
        officialVerifiedCount: counters.portalsVerified,
        reviewCount: counters.reviewRequired,
        rejectedCount: counters.rejected,
        extractedJobCount: counters.jobsStored,
        failures: Object.freeze(failures),
        llmUsage: typeof repository.listLlmUsage === 'function'
          ? Object.freeze(repository.listLlmUsage().filter((item) => item.runId === runId))
          : Object.freeze([]),
        quality: buildQualityReport({
          ...qualityObservations,
          portalsVerified: counters.portalsVerified,
          rejectedPortals: counters.rejected,
          validCandidateResults: discovery.validCandidateResults,
          duplicateCandidateResults: discovery.duplicateCandidateResults,
        }),
      }),
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    repository.completeRun({
      id: runId,
      status: 'FAILED',
      completedAt: now(),
      error: failure,
    });
    failure.liveSearchExecuted = liveSearchExecuted;
    throw failure;
  }
}
