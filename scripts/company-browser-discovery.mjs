import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDomain } from 'tldts';
import { ingestBrowserCompanyResult } from '../src/application/ingest-browser-company-result.mjs';
import {
  isBaiduBlockedSnapshot,
  readBaiduRows,
} from '../src/adapters/browser/baidu-search-page-adapter.mjs';
import { observeRenderedRecruitmentPage } from '../src/adapters/browser/recruitment-page-observer.mjs';
import { inspectPlatformCompanyPage } from '../src/adapters/platform/company-platform-page-adapter.mjs';
import {
  createAdaptiveSearchIntervalGate,
  resumeProviderCircuit,
} from '../src/application/browser-search-circuit-breaker.mjs';
import { buildStudentApplicationRows } from '../src/application/build-student-application-rows.mjs';
import { runBrowserCompanyBatch } from '../src/application/run-browser-company-batch.mjs';
import {
  discoverRecruitmentEntries,
  KNOWN_ATS_REGISTRABLE_DOMAINS,
} from '../src/discovery/recruitment-entry-discovery.mjs';
import { buildQualityReport } from '../src/quality/quality-report.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';
import { classifyRecruitmentSource } from '../src/verification/recruitment-source-policy.mjs';
import { createBrowserRuntime } from './chrome-extension-browser-adapter.mjs';

const REJECTED_KINDS = new Set(['ad', 'advertisement', 'sponsored', 'promotion', 'news']);
const RECRUITMENT_PATH = /\/(?:career|careers|job|jobs|recruit|recruitment|social|campus|position|positions|internship|graduate)(?:[/?#]|$)/i;
const RECRUITMENT_HOST = /^(?:job|jobs|career|careers|hr|recruit|recruitment)\./i;
const KNOWN_ATS_HOST = /(?:^|\.)(?:mokahr\.com|mokahr\.cn|beisen\.com|beisencloud\.com|hotjob\.cn|zhiye\.com)$/i;
const JOBUI_DOMAINS = new Set(['jobui.com', 'www.jobui.com']);
const EXCLUDED_RESULT_DOMAINS = new Set([
  'jobui.com',
  '51job.com',
  'zhaopin.com',
]);

function parsedUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function normalizedDomain(value) {
  const url = parsedUrl(value.includes('://') ? value : `https://${value}`);
  return url ? (getDomain(url.hostname) || url.hostname).toLowerCase() : '';
}

function hasOfficialSiteLink(links = [], officialDomain = '') {
  const expectedDomain = normalizedDomain(officialDomain);
  if (!expectedDomain) return false;
  return links.some((link) => {
    const target = parsedUrl(link?.href);
    if (!target || normalizedDomain(target.href) !== expectedDomain) return false;
    return !RECRUITMENT_HOST.test(target.hostname)
      && !RECRUITMENT_PATH.test(target.pathname);
  });
}

export function classifySearchResult({ company = '', officialDomain = '', title = '', url = '', kind = 'organic' } = {}) {
  const parsed = parsedUrl(url);
  const normalizedKind = String(kind || '').toLowerCase();
  if (!parsed) return { classification: 'REJECTED', reasonCode: 'invalid_url' };
  if (REJECTED_KINDS.has(normalizedKind)) return { classification: 'REJECTED', reasonCode: `search_result_${normalizedKind}` };

  const sourcePolicy = classifyRecruitmentSource({
    company,
    title,
    url,
    kind: normalizedKind,
  });
  if (sourcePolicy.decision === 'DISCOVERY_LOG_ONLY') {
    const rejection = {
      classification: 'REJECTED',
      reasonCode: JOBUI_DOMAINS.has(parsed.hostname.toLowerCase())
        || parsed.hostname.toLowerCase().endsWith('.jobui.com')
        ? 'excluded_jobui_domain'
        : sourcePolicy.reasonCode,
    };
    if (sourcePolicy.platform) rejection.platform = sourcePolicy.platform;
    return rejection;
  }
  if (sourcePolicy.decision === 'PLATFORM_CANDIDATE') {
    return {
      classification: 'PLATFORM_CANDIDATE',
      reasonCode: 'platform_company_candidate',
      sourceTier: 'PLATFORM_ONLY',
      platform: sourcePolicy.platform,
    };
  }

  const host = parsed.hostname.toLowerCase();

  const expectedDomain = normalizedDomain(officialDomain);
  const resultDomain = getDomain(host) || host;
  const firstParty = Boolean(expectedDomain && resultDomain === expectedDomain);
  const recruitmentShaped = RECRUITMENT_HOST.test(host)
    || RECRUITMENT_PATH.test(parsed.pathname)
    || KNOWN_ATS_HOST.test(host);
  if (firstParty && recruitmentShaped) return { classification: 'OFFICIAL_CANDIDATE', reasonCode: 'first_party_recruitment_url' };
  if (firstParty) return { classification: 'REJECTED', reasonCode: 'first_party_non_recruitment_page' };
  if (recruitmentShaped) {
    return {
      classification: 'VERIFICATION_CANDIDATE',
      reasonCode: 'recruitment_url_requires_verification',
    };
  }
  return { classification: 'REJECTED', reasonCode: 'unverified_non_recruitment_url' };
}

export function shouldOpenSearchResult({
  company = '',
  title = '',
  kind = 'organic',
  url = '',
  href = '',
} = {}) {
  const parsed = parsedUrl(url || href);
  if (!parsed || REJECTED_KINDS.has(String(kind || '').toLowerCase())) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'baidu.com' || host.endsWith('.baidu.com')) {
    const path = parsed.pathname.toLowerCase();
    return path === '/link' && Boolean(parsed.searchParams.get('url'));
  }
  if ([...EXCLUDED_RESULT_DOMAINS].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  )) return false;
  return classifyRecruitmentSource({
    company,
    title,
    url: parsed.href,
    kind,
  }).decision !== 'DISCOVERY_LOG_ONLY';
}

function isKnownAtsUrl(value) {
  const parsed = parsedUrl(value);
  return Boolean(parsed && KNOWN_ATS_HOST.test(parsed.hostname));
}

function recruitmentTypeForLink(text, url) {
  const value = `${text} ${url}`.toLowerCase();
  if (/实习|internship|intern\b/.test(value)) return 'INTERNSHIP';
  if (/应届|校招|graduate|campus/.test(value)) return 'GRADUATE';
  if (/社会|社招|social|experienced/.test(value)) return 'SOCIAL';
  if (/岗位|职位|position|jobs?/.test(value)) return 'JOB_LIST';
  return '';
}

export function discoverCareerLinks(baseUrl, links = []) {
  const base = parsedUrl(baseUrl);
  if (!base || !Array.isArray(links)) return [];
  const candidates = [];
  const seen = new Set();
  for (const link of links) {
    const recruitmentType = recruitmentTypeForLink(link?.text, link?.href);
    if (!recruitmentType) continue;
    let resolved;
    try {
      resolved = new URL(String(link.href || ''), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(resolved.protocol) || resolved.hostname !== base.hostname || seen.has(resolved.href)) continue;
    seen.add(resolved.href);
    candidates.push({
      url: resolved.href,
      text: String(link.text || '').trim(),
      recruitmentType,
      discoveryReason: 'career_navigation_link',
    });
  }
  return candidates;
}

export function buildDiscoveryReport(companyResults = []) {
  const summary = {
    companies: companyResults.length,
    completed: 0,
    blocked: 0,
    failed: 0,
    officialCandidates: 0,
    leadOnly: 0,
    entriesInspected: 0,
    activeEntries: 0,
    noOpeningEntries: 0,
    unknownEntries: 0,
    blockedEntries: 0,
    failedEntries: 0,
  };
  for (const result of companyResults) {
    if (result.status === 'COMPLETED') summary.completed++;
    else if (result.status === 'BLOCKED') summary.blocked++;
    else summary.failed++;
    summary.officialCandidates += result.officialCandidates?.length || 0;
    summary.leadOnly += result.leads?.length || 0;
    for (const entry of result.officialCandidates || []) {
      if (entry.pageStatus && entry.pageStatus !== 'DISCOVERED') summary.entriesInspected++;
      if (entry.vacancyStatus === 'ACTIVE') summary.activeEntries++;
      if (entry.vacancyStatus === 'NO_OPENINGS') summary.noOpeningEntries++;
      if (entry.vacancyStatus === 'UNKNOWN') summary.unknownEntries++;
      if (entry.pageStatus === 'BLOCKED') summary.blockedEntries++;
      if (entry.pageStatus === 'FAILED') summary.failedEntries++;
    }
  }
  return { generatedAt: new Date().toISOString(), summary, companies: companyResults };
}

export function buildBrowserRunReport({
  batch = {},
  companyResults = [],
  discoveryRuns = [],
} = {}) {
  const decisions = discoveryRuns.flatMap((run) => run?.report?.portalDecisions || []);
  const recruitmentEvents = discoveryRuns.flatMap((run) => (
    run?.report?.recruitmentEvents || []
  ));
  const jobs = discoveryRuns.flatMap((run) => run?.report?.extractedJobs || []);
  const candidateUrls = companyResults.flatMap((result) => (
    result.officialCandidates || []
  )).map((candidate) => candidate.url).filter(Boolean);
  const uniqueCandidateUrls = new Set(candidateUrls);
  const candidateCompanies = new Set(companyResults
    .filter((result) => result.officialCandidates?.length)
    .map((result) => result.company));
  const verifiedDecisions = decisions.filter((item) => item.verificationStatus === 'VERIFIED');
  const reviewDecisions = decisions.filter((item) => (
    ['REVIEW', 'BLOCKED'].includes(item.verificationStatus)
  ));
  const rejectedDecisions = decisions.filter((item) => item.verificationStatus === 'REJECTED');
  const jobPortalIds = new Set(jobs.map((job) => job.careerPortalId).filter(Boolean));
  const companiesWithJobs = new Set(jobs.map((job) => job.companyId).filter(Boolean));
  const confidenceScores = decisions
    .map((item) => Number(item.confidenceScore))
    .filter(Number.isFinite);
  const officialDecisions = decisions.filter((item) => item.sourceTier !== 'PLATFORM_ONLY');
  const platformDecisions = decisions.filter((item) => item.sourceTier === 'PLATFORM_ONLY');
  const verifiedOfficialDecisions = officialDecisions.filter((item) => (
    item.verificationStatus === 'VERIFIED'
  ));
  const officialJobPortalIds = new Set(jobs
    .filter((job) => job.sourceTier !== 'PLATFORM_ONLY')
    .map((job) => job.careerPortalId)
    .filter(Boolean));
  const officialConfidenceScores = officialDecisions
    .map((item) => Number(item.confidenceScore))
    .filter(Number.isFinite);
  const quality = buildQualityReport({
    portalsEvaluated: officialDecisions.length,
    portalsVerified: verifiedOfficialDecisions.length,
    officialExtractionAttempts: verifiedOfficialDecisions.length,
    officialExtractionSuccesses: officialJobPortalIds.size,
    platformOnlyAcceptanceCount: platformDecisions.filter((item) => (
      item.hiringAvailability === 'OPENINGS_FOUND'
    )).length,
    platformOnlySupersededCount: platformDecisions.filter((item) => (
      Boolean(item.supersededByPortalId)
    )).length,
    validCandidateResults: candidateUrls.length,
    duplicateCandidateResults: candidateUrls.length - uniqueCandidateUrls.size,
    rejectedPortals: officialDecisions.filter((item) => (
      item.verificationStatus === 'REJECTED'
    )).length,
    officialConfidenceScores,
    availabilityEvaluated: officialDecisions.length,
    unknownAvailabilityCount: officialDecisions.filter((item) => (
      item.hiringAvailability === 'UNKNOWN'
    )).length,
    blockedPortals: officialDecisions.filter((item) => (
      item.verificationStatus === 'BLOCKED'
    )).length,
    recruitmentEventsEvaluated: recruitmentEvents.length,
    missingStartDates: recruitmentEvents.filter((event) => !event.startAt).length,
    missingCloseDates: recruitmentEvents.filter((event) => !event.closesAt).length,
    missingLocations: recruitmentEvents.filter((event) => !event.locations?.length).length,
  });
  const fieldDefinitions = {
    location: (job) => Boolean(job.locations?.length),
    publishedAt: (job) => Boolean(job.publishedAt),
    closesAt: (job) => Boolean(job.closesAt),
    recruitmentType: (job) => Boolean(job.employmentType),
    applyUrl: (job) => Boolean(job.applyUrl),
  };
  const fieldCoverage = Object.fromEntries(Object.entries(fieldDefinitions).map(([field, present]) => {
    const presentCount = jobs.filter(present).length;
    return [field, { present: presentCount, missing: jobs.length - presentCount }];
  }));
  const failures = [];
  for (const result of companyResults) {
    if (['BLOCKED', 'FAILED'].includes(result.status)) {
      failures.push({
        company: result.company || null,
        stage: 'search',
        code: result.reasonCode || result.status,
        url: null,
        message: result.reasonCode || result.status,
      });
    }
    for (const failure of result.failures || []) {
      failures.push({
        company: result.company || null,
        stage: failure.stage || 'browser',
        code: failure.code || failure.reasonCode || 'FAILED',
        url: failure.url || null,
        message: String(failure.message || failure.error || failure.reasonCode || 'FAILED')
          .slice(0, 240),
      });
    }
  }
  for (const run of discoveryRuns) {
    for (const failure of run?.report?.failures || []) {
      failures.push({
        company: null,
        stage: failure.stage || 'pipeline',
        code: failure.code || 'FAILED',
        url: failure.url || null,
        message: String(failure.message || failure.code || 'FAILED').slice(0, 240),
      });
    }
  }

  return Object.freeze({
    generatedAt: new Date().toISOString(),
    status: batch.status || 'UNKNOWN',
    batch: Object.freeze({
      batchId: batch.batchId || null,
      total: Number(batch.total) || companyResults.length,
      succeeded: Number(batch.succeeded) || 0,
      failed: Number(batch.failed) || 0,
      deferred: Number(batch.deferred) || 0,
      pending: Number(batch.pending) || 0,
    }),
    discovery: Object.freeze({
      provider: 'chrome_baidu_visible_search',
      searchQueries: Object.freeze([
        ...new Set(companyResults.map((result) => result.query).filter(Boolean)),
      ]),
      searchResultCount: companyResults.reduce((sum, result) => (
        sum
        + (result.officialCandidates?.length || 0)
        + (result.leads?.length || 0)
        + (result.rejected?.length || 0)
      ), 0),
      candidateUrlCount: uniqueCandidateUrls.size,
      candidateCompanyCount: candidateCompanies.size,
      completedCompanies: companyResults.filter((item) => item.status === 'COMPLETED').length,
      blockedCompanies: companyResults.filter((item) => item.status === 'BLOCKED').length,
      failedCompanies: companyResults.filter((item) => item.status === 'FAILED').length,
    }),
    verification: Object.freeze({
      evaluated: decisions.length,
      verified: verifiedDecisions.length,
      pendingReview: reviewDecisions.length,
      rejected: rejectedDecisions.length,
      blocked: decisions.filter((item) => item.verificationStatus === 'BLOCKED').length,
      averageConfidenceScore: confidenceScores.length
        ? confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length
        : null,
    }),
    extraction: Object.freeze({
      companiesWithJobs: companiesWithJobs.size,
      jobsStored: jobs.length,
      portalsWithJobs: jobPortalIds.size,
    }),
    fieldCoverage: Object.freeze(fieldCoverage),
    quality,
    failures: Object.freeze(failures),
  });
}

export function isSearchBlockedPage(text) {
  return isBaiduBlockedSnapshot({ text });
}

async function readSearchRows(page, maxResults) {
  if (typeof page.readSearchRows === 'function') return page.readSearchRows(maxResults);
  return readBaiduRows(page, maxResults);
}

async function observeCareerPage(
  page,
  { requestedUrl, response = null, observedAt = new Date().toISOString() } = {},
) {
  if (typeof page.observeCareerPage === 'function') {
    return page.observeCareerPage({ requestedUrl, response, observedAt });
  }
  try {
    return await observeRenderedRecruitmentPage(page, {
      requestedUrl,
      response,
      observedAt,
    });
  } catch (error) {
    return {
      requestedUrl,
      finalUrl: requestedUrl,
      url: requestedUrl,
      status: 0,
      fetchStatus: 'FAILED',
      reasonCode: 'career_page_navigation_failed',
      title: '',
      html: '',
      text: '',
      links: [],
      observedAt,
      vacancyStatus: null,
      evidence: '',
      error: String(error?.message || error),
    };
  }
}

async function readCareerPage(page, url, timeoutMs, now = () => new Date().toISOString()) {
  const observedAt = now();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(400);
    return observeCareerPage(page, { requestedUrl: url, response, observedAt });
  } catch (error) {
    return {
      requestedUrl: url,
      finalUrl: url,
      url,
      status: 0,
      fetchStatus: 'FAILED',
      reasonCode: 'career_page_navigation_failed',
      title: '',
      html: '',
      text: '',
      links: [],
      observedAt,
      vacancyStatus: null,
      evidence: '',
      error: String(error?.message || error),
    };
  }
}

export async function discoverCompanyWithBrowser({
  company,
  officialDomain = '',
  browser,
  maxResults = 10,
  maxCandidates = 3,
  maxCareerEntries = 5,
  maxDepth = 2,
  timeoutMs = 10_000,
  now = () => new Date().toISOString(),
}) {
  if (!company || !browser) throw new Error('company and browser are required');
  const page = await browser.newPage();
  const query = `${company} 招聘`;
  const officialCandidates = [], platformCandidates = [], leads = [], rejected = [], failures = [], observations = [];
  try {
    await page.goto(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Baidu can redirect to its challenge page immediately after DOM content loads.
    // Allow that redirect to settle before interpreting a page with no result rows.
    await page.waitForTimeout(400);
    const bodyText = typeof page.readBodyText === 'function'
      ? await page.readBodyText()
      : await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
    if (isSearchBlockedPage(bodyText)) return { company, officialDomain, query, status: 'BLOCKED', reasonCode: 'search_challenge_or_access_blocked', officialCandidates, platformCandidates, leads, rejected, failures, observations };
    const rows = await readSearchRows(page, maxResults);
    let openedCandidates = 0;
    for (const row of rows) {
      if (!shouldOpenSearchResult({ ...row, company })) {
        rejected.push({ company, title: row.title, url: row.href, sourceUrl: row.href, searchQuery: query, searchKind: row.kind, snippet: row.snippet, classification: 'REJECTED', reasonCode: `search_result_${row.kind}` });
        continue;
      }
      if (openedCandidates >= Math.max(1, Number(maxCandidates) || 3)) break;
      openedCandidates++;
      let finalUrl = row.href;
      let response;
      try {
        response = await page.goto(row.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await page.waitForTimeout(400);
        finalUrl = page.url();
      } catch (error) {
        failures.push({ stage: 'open_search_result', url: row.href, reasonCode: 'result_navigation_failed', error: String(error?.message || error) });
        continue;
      }
      const classification = classifySearchResult({ company, officialDomain, title: row.title, url: finalUrl, kind: row.kind });
      const base = { company, title: row.title, url: finalUrl, sourceUrl: row.href, searchQuery: query, searchKind: row.kind, snippet: row.snippet, ...classification };
      if (classification.classification === 'PLATFORM_CANDIDATE') {
        const platformPage = await observeCareerPage(page, {
          requestedUrl: row.href,
          response,
          observedAt: now(),
        });
        observations.push(platformPage);
        const inspected = inspectPlatformCompanyPage({
          company,
          page: platformPage,
          platform: classification.platform,
        });
        if (inspected.platformIdentityConfirmed && inspected.jobs.length) {
          const platformCandidate = {
            ...base,
            ...inspected,
            url: platformPage.url || finalUrl,
            pageStatus: platformPage.fetchStatus,
            vacancyStatus: platformPage.vacancyStatus || 'UNKNOWN',
            evidence: platformPage.evidence || '',
          };
          platformCandidates.push(platformCandidate);
          leads.push(platformCandidate);
        } else {
          rejected.push({
            ...base,
            classification: 'REJECTED',
            reasonCode: inspected.platformIdentityConfirmed
              ? 'platform_current_jobs_missing'
              : 'platform_identity_unconfirmed',
          });
        }
      }
      else if (classification.classification === 'REJECTED') rejected.push(base);
      else {
        const observedCareerPage = await observeCareerPage(page, {
          requestedUrl: row.href,
          response,
          observedAt: now(),
        });
        const careerPage = {
          ...observedCareerPage,
          officialSiteLinked: hasOfficialSiteLink(
            observedCareerPage.links,
            officialDomain,
          ),
          verifiedAtsTenant: false,
        };
        const parentOfficialVerified = classification.classification === 'OFFICIAL_CANDIDATE'
          && careerPage.fetchStatus === 'COMPLETED'
          && careerPage.hasJobStructure === true
          && normalizedDomain(careerPage.url || finalUrl) === normalizedDomain(officialDomain);
        observations.push(careerPage);
        officialCandidates.push({
          ...base,
          url: careerPage.url || finalUrl,
          pageStatus: careerPage.fetchStatus,
          vacancyStatus: careerPage.vacancyStatus || null,
          evidence: careerPage.evidence || '',
          officialSiteLinked: careerPage.officialSiteLinked,
          verifiedTenant: careerPage.verifiedAtsTenant,
          parentOfficialVerified: false,
          officialAttributionUrl: null,
          depth: 0,
          parentUrl: null,
        });
        if (careerPage.fetchStatus === 'COMPLETED') {
          const trustedDomains = [officialDomain].filter(Boolean);
          const entryBudget = Math.max(1, Number(maxCareerEntries) || 5);
          const depthBudget = Math.max(0, Number(maxDepth) || 0);
          const visitedUrls = new Set([careerPage.url || finalUrl]);
          const queuedUrls = new Set();
          const queue = [...discoverRecruitmentEntries({
            baseUrl: careerPage.url || finalUrl,
            links: careerPage.links,
            trustedRegistrableDomains: trustedDomains,
            knownAtsRegistrableDomains: KNOWN_ATS_REGISTRABLE_DOMAINS,
            parentOfficialVerified,
            visitedUrls,
            parentUrl: careerPage.url || finalUrl,
            depth: 1,
            maxDepth: depthBudget,
            maxEntries: Math.max(0, entryBudget - visitedUrls.size),
          })];
          for (const entry of queue) queuedUrls.add(entry.url);
          while (queue.length && visitedUrls.size < entryBudget) {
            const entry = queue.shift();
            queuedUrls.delete(entry.url);
            if (visitedUrls.has(entry.url)) continue;
            visitedUrls.add(entry.url);
            const observedEntry = await readCareerPage(page, entry.url, timeoutMs, now);
            const inspectedEntry = {
              ...observedEntry,
              officialSiteLinked: hasOfficialSiteLink(
                observedEntry.links,
                officialDomain,
              ),
              verifiedAtsTenant: Boolean(
              entry.discoveryReason === 'verified_official_outbound_ats_link'
              && entry.parentOfficialVerified === true
              && isKnownAtsUrl(observedEntry.url || entry.url),
              ),
            };
            observations.push(inspectedEntry);
            const observedUrl = inspectedEntry.url || entry.url;
            visitedUrls.add(observedUrl);
            officialCandidates.push({
              ...base,
              title: entry.text || inspectedEntry.title || row.title,
              url: observedUrl,
              recruitmentType: entry.recruitmentType,
              pageStatus: inspectedEntry.fetchStatus,
              vacancyStatus: inspectedEntry.vacancyStatus || null,
              evidence: inspectedEntry.evidence || '',
              officialSiteLinked: inspectedEntry.officialSiteLinked,
              verifiedTenant: inspectedEntry.verifiedAtsTenant,
              parentOfficialVerified: entry.parentOfficialVerified === true,
              officialAttributionUrl: entry.officialAttributionUrl || null,
              discoveryReason: entry.discoveryReason,
              parentUrl: entry.parentUrl,
              depth: entry.depth,
            });
            if (inspectedEntry.fetchStatus !== 'COMPLETED') {
              failures.push({
                stage: 'inspect_career_entry',
                url: entry.url,
                reasonCode: inspectedEntry.reasonCode || 'career_entry_failed',
                error: inspectedEntry.error || '',
              });
              continue;
            }
            const remaining = Math.max(0, entryBudget - visitedUrls.size - queuedUrls.size);
            const childParentOfficialVerified = inspectedEntry.fetchStatus === 'COMPLETED'
              && inspectedEntry.hasJobStructure === true
              && normalizedDomain(observedUrl) === normalizedDomain(officialDomain);
            const children = discoverRecruitmentEntries({
              baseUrl: observedUrl,
              links: inspectedEntry.links,
              trustedRegistrableDomains: trustedDomains,
              knownAtsRegistrableDomains: KNOWN_ATS_REGISTRABLE_DOMAINS,
              parentOfficialVerified: childParentOfficialVerified,
              visitedUrls: [...visitedUrls, ...queuedUrls],
              parentUrl: observedUrl,
              depth: entry.depth + 1,
              maxDepth: depthBudget,
              maxEntries: remaining,
            });
            for (const child of children) {
              if (queuedUrls.has(child.url) || visitedUrls.has(child.url)) continue;
              queue.push(child);
              queuedUrls.add(child.url);
            }
          }
        } else failures.push({ stage: 'inspect_career_page', url: finalUrl, reasonCode: careerPage.reasonCode || 'career_page_failed', error: careerPage.error || '' });
      }
    }
    const unique = (items) => [...new Map(items.map((item) => [item.url, item])).values()];
    return { company, officialDomain, query, status: 'COMPLETED', officialCandidates: unique(officialCandidates), platformCandidates: unique(platformCandidates), leads: unique(leads), rejected: unique(rejected), failures, observations: unique(observations.map((item) => ({ ...item, url: item.finalUrl || item.url }))) };
  } catch (error) {
    return { company, officialDomain, query, status: 'FAILED', reasonCode: 'search_navigation_failed', officialCandidates, platformCandidates, leads, rejected, observations, failures: [...failures, { stage: 'search', reasonCode: 'search_navigation_failed', error: String(error?.message || error) }] };
  } finally {
    await page.close();
  }
}

export function normalizeBrowserCompanyInput(input) {
  const rawCompanies = Array.isArray(input) ? input : input?.companies;
  if (!Array.isArray(rawCompanies)) return [];
  return rawCompanies.map((item = {}) => {
    const chineseName = String(item.chineseName || item.name_cn || '').trim() || null;
    const englishName = String(item.englishName || item.name_en || '').trim() || null;
    const company = String(
      item.company
      || item.canonicalName
      || item.name
      || chineseName
      || englishName
      || '',
    ).trim();
    const officialDomains = item.officialDomains || item.official_domains || [];
    return {
      ...item,
      company,
      chineseName,
      englishName,
      officialDomain: item.officialDomain || officialDomains[0] || '',
      aliases: Array.isArray(item.aliases) ? item.aliases : [],
      industry: item.industry || item.industryTags || item.industry_tags || [],
      countryRegion: item.countryRegion || item.country_region || null,
    };
  });
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

export function browserDiscoveryLimits(args = {}) {
  return Object.freeze({
    maxResults: boundedInteger(args['max-results'], 10, 1, 20),
    maxCandidates: boundedInteger(args['max-candidates'], 3, 1, 5),
    maxCareerEntries: boundedInteger(args['max-career-entries'], 5, 1, 10),
    maxDepth: boundedInteger(args['max-depth'], 2, 0, 2),
    timeoutMs: boundedInteger(args['timeout-ms'], 10_000, 1_000, 30_000),
    searchDelayMs: boundedInteger(args['search-delay-ms'], 10_000, 10_000, 60_000),
    searchJitterMs: boundedInteger(args['search-jitter-ms'], 20_000, 0, 60_000),
    maxCompaniesPerRun: boundedInteger(args['max-companies-per-run'], 10, 1, 100),
  });
}

export function createMinimumSearchIntervalGate({
  minimumIntervalMs = 10_000,
  nowMs = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  return createAdaptiveSearchIntervalGate({
    minimumIntervalMs,
    jitterMs: 0,
    nowMs,
    sleep,
  });
}

export function buildBrowserLaunchOptions(args = {}) {
  const explicitHeadless = args.headless === true
    || String(args.headless || '').toLowerCase() === 'true';
  const legacyHeadful = args.headful === true
    || String(args.headful || '').toLowerCase() === 'true';
  return Object.freeze({
    channel: 'chrome',
    headless: legacyHeadful ? false : explicitHeadless,
  });
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    values[name] = ['headful', 'headless', 'retry-failed', 'health-probe'].includes(name)
      ? true
      : argv[++index];
  }
  return values;
}

export async function probeBaiduSearchHealth({
  browser,
  timeoutMs = 10_000,
} = {}) {
  if (!browser) throw new Error('browser is required');
  const page = await browser.newPage();
  try {
    await page.goto(`https://www.baidu.com/s?wd=${encodeURIComponent('招聘')}`, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    await page.waitForTimeout(400);
    const bodyText = typeof page.readBodyText === 'function'
      ? await page.readBodyText()
      : await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
    if (isSearchBlockedPage(bodyText)) {
      return { healthy: false, reasonCode: 'search_challenge_or_access_blocked' };
    }
    const rows = await readSearchRows(page, 1);
    return rows.length
      ? { healthy: true, reasonCode: null }
      : { healthy: false, reasonCode: 'search_results_unreadable' };
  } catch {
    return { healthy: false, reasonCode: 'health_probe_navigation_failed' };
  } finally {
    await page.close();
  }
}

async function runCli() {
  const runtimeProcess = globalThis.process;
  const args = parseArgs(runtimeProcess?.argv?.slice(2) || []);
  const healthProbeMode = Boolean(args['resume-provider'] && args['health-probe']);
  if (args.help || (!healthProbeMode && (!args.input || !args['output-dir']))) {
    runtimeProcess.stdout.write('Usage: node scripts/company-browser-discovery.mjs --input companies.json --output-dir output [--database data/lite-job-search.sqlite] [--xlsx-output outputs/student-applications.xlsx] [--browser-mode persistent-chrome|normal-chrome] [--profile-dir data/local-chrome-worker-profile] [--role 公开招聘岗位] [--industry AI] [--location 上海] [--freshness-days 90] [--target-count 1000] [--batch-id id] [--retry-failed] [--max-results 10] [--max-candidates 3] [--max-career-entries 5] [--max-depth 2] [--timeout-ms 10000] [--search-delay-ms 10000] [--search-jitter-ms 20000] [--max-companies-per-run 10] [--headless]\n       node scripts/company-browser-discovery.mjs --resume-provider baidu --health-probe [--database data/lite-job-search.sqlite] [--profile-dir data/local-chrome-worker-profile]\n');
    return args.help ? 0 : 2;
  }
  let companies = [];
  if (!healthProbeMode) {
    let input;
    try { input = JSON.parse(await fs.readFile(args.input, 'utf8')); }
    catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'input_read_failed', error: String(error?.message || error) })}\n`); return 2; }
    companies = normalizeBrowserCompanyInput(input);
    if (!companies.length || !companies.every((item) => item.company)) {
      process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'invalid_company_input' })}\n`); return 2;
    }
  }
  const browserMode = String(args['browser-mode'] || 'persistent-chrome');
  let chromium = null;
  if (browserMode === 'persistent-chrome') {
    try { ({ chromium } = await import('playwright')); }
    catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'playwright_not_available', error: String(error?.message || error) })}\n`); return 2; }
  }
  let browser;
  const profileDir = path.resolve(args['profile-dir'] || path.join('data', 'local-chrome-worker-profile'));
  try {
    await fs.mkdir(profileDir, { recursive: true });
    browser = await createBrowserRuntime({
      mode: browserMode,
      chrome: globalThis.chromeBrowserBinding || null,
      chromium,
      profileDir,
      headless: buildBrowserLaunchOptions(args).headless,
    });
  }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'browser_launch_failed', error: String(error?.message || error) })}\n`); return 2; }
  const databaseFile = path.resolve(args.database || path.join('data', 'lite-job-search.sqlite'));
  const repository = openSqliteMarketDiscoveryRepository({ file: databaseFile });
  repository.migrate();
  try {
    const limits = browserDiscoveryLimits(args);
    if (healthProbeMode) {
      const circuit = await resumeProviderCircuit({
        provider: args['resume-provider'],
        healthProbe: () => probeBaiduSearchHealth({
          browser,
          timeoutMs: limits.timeoutMs,
        }),
      }, { repository });
      process.stdout.write(`${JSON.stringify({
        status: circuit.state === 'CLOSED' ? 'HEALTHY' : 'BLOCKED',
        providerCircuit: circuit,
      })}\n`);
      return circuit.state === 'CLOSED' ? 0 : 1;
    }
    const waitForSearchSlot = createAdaptiveSearchIntervalGate({
      minimumIntervalMs: limits.searchDelayMs,
      jitterMs: limits.searchJitterMs,
    });
    const batchId = args['batch-id'] || `browser-${createHash('sha256')
      .update(JSON.stringify(companies.map((item) => ({
        company: item.company,
        officialDomain: item.officialDomain,
      }))))
      .digest('hex')
      .slice(0, 16)}`;
    const batch = await runBrowserCompanyBatch({
      batchId,
      companies,
      retryFailed: args['retry-failed'] === true,
      maxCompaniesPerRun: limits.maxCompaniesPerRun,
      runOptions: {
        role: args.role || '公开招聘岗位',
        industry: args.industry || '',
        location: args.location || '',
        freshnessDays: Number(args['freshness-days'] || 90),
        targetCount: Number(args['target-count'] || 1000),
      },
    }, {
      repository,
      discoverCompany: async (company) => {
        await waitForSearchSlot();
        return {
          ...company,
          ...await discoverCompanyWithBrowser({
          company: company.company,
          officialDomain: company.officialDomain,
          browser,
          ...limits,
        }),
        };
      },
      ingestCompany: (options) => ingestBrowserCompanyResult({
        ...options,
        industry: options.industry || options.companyResult.industry || [],
      }, { repository }),
    });
    const results = batch.companyResults;
    const report = buildDiscoveryReport(results);
    const runReport = buildBrowserRunReport({
      batch,
      companyResults: results,
      discoveryRuns: batch.discoveryRuns,
    });
    const candidates = results.flatMap((result) => result.officialCandidates).map(({ company, title, url, sourceUrl, searchQuery, evidence, ...rest }) => ({ company, title, url, sourceUrl, searchQuery, evidence, ...rest, discoveryMethod: 'playwright_search' }));
    const leads = results.flatMap((result) => result.leads).map((lead) => ({ ...lead, discoveryMethod: 'playwright_search' }));
    const studentRows = buildStudentApplicationRows({
      companies: repository.listCompanies(),
      portals: repository.listCareerPortals(),
      events: repository.listRecruitmentEvents(),
      jobs: repository.listJobOpenings(),
    });
    await fs.mkdir(args['output-dir'], { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(args['output-dir'], 'candidates.json'), `${JSON.stringify(candidates, null, 2)}\n`),
      fs.writeFile(path.join(args['output-dir'], 'leads.json'), `${JSON.stringify(leads, null, 2)}\n`),
      fs.writeFile(path.join(args['output-dir'], 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
      fs.writeFile(path.join(args['output-dir'], 'run-report.json'), `${JSON.stringify(runReport, null, 2)}\n`),
      fs.writeFile(path.join(args['output-dir'], 'student-application-rows.json'), `${JSON.stringify(studentRows, null, 2)}\n`),
    ]);
    let xlsxOutput = null;
    if (args['xlsx-output']) {
      const { buildStudentApplicationWorkbook } = await import('./build-browser-batch-xlsx.mjs');
      xlsxOutput = path.resolve(args['xlsx-output']);
      await buildStudentApplicationWorkbook({
        rows: studentRows,
        outputFile: xlsxOutput,
      });
    }
    process.stdout.write(`${JSON.stringify({ status: batch.status, batchId, databaseFile, outputDir: args['output-dir'], xlsxOutput, summary: report.summary, quality: runReport.quality })}\n`);
    return batch.failed > 0 ? 1 : 0;
  } finally {
    await browser.close();
    repository.close();
  }
}

if (globalThis.process?.argv?.[1] && path.resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then((code) => { globalThis.process.exitCode = code; }).catch((error) => { globalThis.process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'unexpected_error', error: String(error?.message || error) })}\n`); globalThis.process.exitCode = 1; });
}
