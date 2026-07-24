import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getDomain } from 'tldts';
import { ingestBrowserCompanyResult } from '../src/application/ingest-browser-company-result.mjs';
import { runBrowserCompanyBatch } from '../src/application/run-browser-company-batch.mjs';
import { discoverRecruitmentEntries } from '../src/discovery/recruitment-entry-discovery.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const THIRD_PARTY_PLATFORMS = [
  ['Liepin', (host) => host === 'liepin.com' || host.endsWith('.liepin.com')],
  ['BOSS', (host) => host === 'zhipin.com' || host.endsWith('.zhipin.com')],
  ['Zhaopin', (host) => host === 'zhaopin.com' || host.endsWith('.zhaopin.com')],
  ['51job', (host) => host === '51job.com' || host.endsWith('.51job.com')],
];

const REJECTED_KINDS = new Set(['ad', 'advertisement', 'sponsored', 'promotion', 'news']);
const RECRUITMENT_PATH = /\/(?:career|careers|job|jobs|recruit|recruitment|social|campus|position|positions|internship|graduate)(?:[/?#]|$)/i;
const RECRUITMENT_HOST = /^(?:job|jobs|career|careers|hr|recruit|recruitment)\./i;
const KNOWN_ATS_HOST = /(?:^|\.)(?:mokahr\.com|mokahr\.cn|beisen\.com|hotjob\.cn)$/i;
const JOBUI_DOMAINS = new Set(['jobui.com', 'www.jobui.com']);

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

function platformForHost(host) {
  return THIRD_PARTY_PLATFORMS.find(([, matches]) => matches(host))?.[0] || '';
}

function hasCompanyIdentity(title, company) {
  const normalizedTitle = String(title || '').toLowerCase().replace(/\s+/g, '');
  const normalizedCompany = String(company || '').toLowerCase().replace(/\s+/g, '');
  return Boolean(normalizedCompany && normalizedTitle.includes(normalizedCompany));
}

export function classifySearchResult({ company = '', officialDomain = '', title = '', url = '', kind = 'organic' } = {}) {
  const parsed = parsedUrl(url);
  const normalizedKind = String(kind || '').toLowerCase();
  if (!parsed) return { classification: 'REJECTED', reasonCode: 'invalid_url' };
  if (REJECTED_KINDS.has(normalizedKind)) return { classification: 'REJECTED', reasonCode: `search_result_${normalizedKind}` };

  const host = parsed.hostname.toLowerCase();
  if (JOBUI_DOMAINS.has(host) || host.endsWith('.jobui.com')) {
    return { classification: 'REJECTED', reasonCode: 'excluded_jobui_domain' };
  }
  const platform = platformForHost(host);
  if (platform) {
    return hasCompanyIdentity(title, company)
      ? { classification: 'LEAD_ONLY', reasonCode: 'third_party_company_lead', platform }
      : { classification: 'REJECTED', reasonCode: 'third_party_identity_unconfirmed', platform };
  }

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

export function shouldOpenSearchResult({ kind = 'organic', url = '' } = {}) {
  const host = parsedUrl(url)?.hostname.toLowerCase() || '';
  return !REJECTED_KINDS.has(String(kind || '').toLowerCase())
    && !JOBUI_DOMAINS.has(host)
    && !host.endsWith('.jobui.com');
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

function ratio(numerator, denominator) {
  return {
    numerator,
    denominator,
    value: denominator ? numerator / denominator : null,
  };
}

export function buildBrowserRunReport({
  batch = {},
  companyResults = [],
  discoveryRuns = [],
} = {}) {
  const decisions = discoveryRuns.flatMap((run) => run?.report?.portalDecisions || []);
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
    quality: Object.freeze({
      officialVerificationRate: ratio(verifiedDecisions.length, decisions.length),
      jobExtractionSuccessRate: ratio(jobPortalIds.size, verifiedDecisions.length),
      falsePositiveRate: ratio(rejectedDecisions.length, decisions.length),
      duplicateRate: ratio(candidateUrls.length - uniqueCandidateUrls.size, candidateUrls.length),
      averageConfidenceScore: confidenceScores.length
        ? confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length
        : null,
    }),
    failures: Object.freeze(failures),
  });
}

export function isSearchBlockedPage(text) {
  return /验证码|安全验证|访问过于频繁|请完成.*验证|captcha|access denied|enable javascript/i.test(String(text || ''));
}

async function readSearchRows(page, maxResults) {
  return page.locator('a[href]').evaluateAll((anchors, limit) => anchors.map((anchor) => {
    const title = (anchor.innerText || anchor.textContent || '').trim();
    const container = anchor.closest('[class*="result"], [class*="c-container"], article, li, div') || anchor.parentElement;
    const text = (container?.innerText || '').trim();
    const className = String(container?.className || '');
    const joined = `${title} ${text} ${className}`.toLowerCase();
    const kind = /广告|推广|sponsored|advertisement|ec-/.test(joined)
      ? 'advertisement'
      : /新闻|news/.test(joined) ? 'news' : 'organic';
    return { title, href: anchor.href, snippet: text.slice(0, 1200), kind };
  }).filter((row) => row.title && row.href).slice(0, limit), maxResults);
}

async function readCareerPage(page, url, timeoutMs, now = () => new Date().toISOString()) {
  const observedAt = now();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(400);
    const status = Number(response?.status?.()) || 200;
    const finalUrl = page.url();
    const text = await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
    const html = await page.locator('html')
      .evaluate((node) => node.outerHTML)
      .catch(() => '');
    const title = typeof page.title === 'function' ? await page.title().catch(() => '') : '';
    const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => ({
      text: (anchor.innerText || anchor.textContent || '').trim(),
      href: anchor.href,
    })).filter((link) => link.text && link.href));
    const blocked = isSearchBlockedPage(text) || [401, 403, 429].includes(status);
    const hasJobStructure = /职位|岗位|招聘|job opening|open positions/i.test(text);
    const noOpenings = /暂无(?:职位|岗位|招聘)|没有(?:职位|岗位)|no open positions|no jobs found/i.test(text);
    return {
      requestedUrl: url,
      finalUrl,
      url: finalUrl,
      status,
      fetchStatus: blocked ? 'BLOCKED' : 'COMPLETED',
      reasonCode: blocked ? 'challenge_or_access_blocked' : null,
      title,
      html,
      text,
      links,
      observedAt,
      hasJobStructure,
      vacancyStatus: blocked
        ? 'BLOCKED'
        : noOpenings
          ? 'NO_OPENINGS'
          : hasJobStructure
            ? 'UNKNOWN'
            : 'NOT_A_LIST',
      evidence: text.slice(0, blocked ? 500 : 1000),
    };
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
  timeoutMs = 20_000,
  now = () => new Date().toISOString(),
}) {
  if (!company || !browser) throw new Error('company and browser are required');
  const page = await browser.newPage();
  const query = `${company} 招聘`;
  const officialCandidates = [], leads = [], rejected = [], failures = [], observations = [];
  try {
    await page.goto(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Baidu can redirect to its challenge page immediately after DOM content loads.
    // Allow that redirect to settle before interpreting a page with no result rows.
    await page.waitForTimeout(400);
    const bodyText = await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
    if (isSearchBlockedPage(bodyText)) return { company, officialDomain, query, status: 'BLOCKED', reasonCode: 'search_challenge_or_access_blocked', officialCandidates, leads, rejected, failures, observations };
    const rows = await readSearchRows(page, maxResults);
    for (const row of rows) {
      if (!shouldOpenSearchResult(row)) {
        rejected.push({ company, title: row.title, url: row.href, sourceUrl: row.href, searchQuery: query, searchKind: row.kind, snippet: row.snippet, classification: 'REJECTED', reasonCode: `search_result_${row.kind}` });
        continue;
      }
      let finalUrl = row.href;
      try {
        await page.goto(row.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        finalUrl = page.url();
      } catch (error) {
        failures.push({ stage: 'open_search_result', url: row.href, reasonCode: 'result_navigation_failed', error: String(error?.message || error) });
        continue;
      }
      const classification = classifySearchResult({ company, officialDomain, title: row.title, url: finalUrl, kind: row.kind });
      const base = { company, title: row.title, url: finalUrl, sourceUrl: row.href, searchQuery: query, searchKind: row.kind, snippet: row.snippet, ...classification };
      if (classification.classification === 'LEAD_ONLY') leads.push(base);
      else if (classification.classification === 'REJECTED') rejected.push(base);
      else {
        const careerPage = await readCareerPage(page, finalUrl, timeoutMs, now);
        careerPage.officialSiteLinked = hasOfficialSiteLink(careerPage.links, officialDomain);
        observations.push(careerPage);
        officialCandidates.push({
          ...base,
          url: careerPage.url || finalUrl,
          pageStatus: careerPage.fetchStatus,
          vacancyStatus: careerPage.vacancyStatus || null,
          evidence: careerPage.evidence || '',
          depth: 0,
          parentUrl: null,
        });
        if (careerPage.fetchStatus === 'COMPLETED') {
          const trustedDomains = [officialDomain].filter(Boolean);
          const visitedUrls = new Set([careerPage.url || finalUrl]);
          const queuedUrls = new Set();
          const queue = [...discoverRecruitmentEntries({
            baseUrl: careerPage.url || finalUrl,
            links: careerPage.links,
            trustedRegistrableDomains: trustedDomains,
            visitedUrls,
            parentUrl: careerPage.url || finalUrl,
            depth: 1,
            maxDepth: 2,
            maxEntries: 20,
          })];
          for (const entry of queue) queuedUrls.add(entry.url);
          while (queue.length && visitedUrls.size < 20) {
            const entry = queue.shift();
            queuedUrls.delete(entry.url);
            if (visitedUrls.has(entry.url)) continue;
            visitedUrls.add(entry.url);
            const inspectedEntry = await readCareerPage(page, entry.url, timeoutMs, now);
            inspectedEntry.officialSiteLinked = hasOfficialSiteLink(
              inspectedEntry.links,
              officialDomain,
            );
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
            const remaining = Math.max(0, 20 - visitedUrls.size - queuedUrls.size);
            const children = discoverRecruitmentEntries({
              baseUrl: observedUrl,
              links: inspectedEntry.links,
              trustedRegistrableDomains: trustedDomains,
              visitedUrls: [...visitedUrls, ...queuedUrls],
              parentUrl: observedUrl,
              depth: entry.depth + 1,
              maxDepth: 2,
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
    return { company, officialDomain, query, status: 'COMPLETED', officialCandidates: unique(officialCandidates), leads: unique(leads), rejected: unique(rejected), failures, observations: unique(observations.map((item) => ({ ...item, url: item.finalUrl || item.url }))) };
  } catch (error) {
    return { company, officialDomain, query, status: 'FAILED', reasonCode: 'search_navigation_failed', officialCandidates, leads, rejected, observations, failures: [...failures, { stage: 'search', reasonCode: 'search_navigation_failed', error: String(error?.message || error) }] };
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

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    values[name] = ['headful', 'retry-failed'].includes(name) ? true : argv[++index];
  }
  return values;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input || !args['output-dir']) {
    process.stdout.write('Usage: node scripts/company-browser-discovery.mjs --input companies.json --output-dir output [--database data/lite-job-search.sqlite] [--role 公开招聘岗位] [--industry AI] [--location 上海] [--freshness-days 90] [--target-count 1000] [--batch-id id] [--retry-failed] [--max-results 10] [--headful]\n');
    return args.help ? 0 : 2;
  }
  let input;
  try { input = JSON.parse(await fs.readFile(args.input, 'utf8')); }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'input_read_failed', error: String(error?.message || error) })}\n`); return 2; }
  const companies = normalizeBrowserCompanyInput(input);
  if (!companies.length || !companies.every((item) => item.company)) {
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'invalid_company_input' })}\n`); return 2;
  }
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'playwright_not_available', error: String(error?.message || error) })}\n`); return 2; }
  let browser;
  try { browser = await chromium.launch({ headless: !args.headful }); }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'browser_launch_failed', error: String(error?.message || error) })}\n`); return 2; }
  const databaseFile = path.resolve(args.database || path.join('data', 'lite-job-search.sqlite'));
  const repository = openSqliteMarketDiscoveryRepository({ file: databaseFile });
  repository.migrate();
  try {
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
      runOptions: {
        role: args.role || '公开招聘岗位',
        industry: args.industry || '',
        location: args.location || '',
        freshnessDays: Number(args['freshness-days'] || 90),
        targetCount: Number(args['target-count'] || 1000),
      },
    }, {
      repository,
      discoverCompany: async (company) => ({
        ...company,
        ...await discoverCompanyWithBrowser({
          company: company.company,
          officialDomain: company.officialDomain,
          browser,
          maxResults: Number(args['max-results'] || 10),
        }),
      }),
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
    await fs.mkdir(args['output-dir'], { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(args['output-dir'], 'candidates.json'), `${JSON.stringify(candidates, null, 2)}\n`),
      fs.writeFile(path.join(args['output-dir'], 'leads.json'), `${JSON.stringify(leads, null, 2)}\n`),
      fs.writeFile(path.join(args['output-dir'], 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
      fs.writeFile(path.join(args['output-dir'], 'run-report.json'), `${JSON.stringify(runReport, null, 2)}\n`),
    ]);
    process.stdout.write(`${JSON.stringify({ status: batch.status, batchId, databaseFile, outputDir: args['output-dir'], summary: report.summary, quality: runReport.quality })}\n`);
    return batch.status === 'COMPLETE_WITH_ERRORS' ? 1 : 0;
  } finally {
    await browser.close();
    repository.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then((code) => { process.exitCode = code; }).catch((error) => { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'unexpected_error', error: String(error?.message || error) })}\n`); process.exitCode = 1; });
}
