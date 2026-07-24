import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getDomain } from 'tldts';

const THIRD_PARTY_PLATFORMS = [
  ['Liepin', (host) => host === 'liepin.com' || host.endsWith('.liepin.com')],
  ['BOSS', (host) => host === 'zhipin.com' || host.endsWith('.zhipin.com')],
  ['Zhaopin', (host) => host === 'zhaopin.com' || host.endsWith('.zhaopin.com')],
  ['51job', (host) => host === '51job.com' || host.endsWith('.51job.com')],
];

const REJECTED_KINDS = new Set(['ad', 'advertisement', 'sponsored', 'promotion', 'news']);
const RECRUITMENT_PATH = /\/(?:career|careers|job|jobs|recruit|recruitment|social|campus|position|positions|internship|graduate)(?:[/?#]|$)/i;
const RECRUITMENT_HOST = /^(?:job|jobs|career|careers|hr|recruit|recruitment)\./i;

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
  const platform = platformForHost(host);
  if (platform) {
    return hasCompanyIdentity(title, company)
      ? { classification: 'LEAD_ONLY', reasonCode: 'third_party_company_lead', platform }
      : { classification: 'REJECTED', reasonCode: 'third_party_identity_unconfirmed', platform };
  }

  const expectedDomain = normalizedDomain(officialDomain);
  const resultDomain = getDomain(host) || host;
  const firstParty = Boolean(expectedDomain && resultDomain === expectedDomain);
  const recruitmentShaped = RECRUITMENT_HOST.test(host) || RECRUITMENT_PATH.test(parsed.pathname);
  if (firstParty && recruitmentShaped) return { classification: 'OFFICIAL_CANDIDATE', reasonCode: 'first_party_recruitment_url' };
  if (firstParty) return { classification: 'REJECTED', reasonCode: 'first_party_non_recruitment_page' };
  return { classification: 'REJECTED', reasonCode: 'unverified_non_recruitment_url' };
}

export function shouldOpenSearchResult({ kind = 'organic' } = {}) {
  return !REJECTED_KINDS.has(String(kind || '').toLowerCase());
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
  const summary = { companies: companyResults.length, completed: 0, blocked: 0, failed: 0, officialCandidates: 0, leadOnly: 0 };
  for (const result of companyResults) {
    if (result.status === 'COMPLETED') summary.completed++;
    else if (result.status === 'BLOCKED') summary.blocked++;
    else summary.failed++;
    summary.officialCandidates += result.officialCandidates?.length || 0;
    summary.leadOnly += result.leads?.length || 0;
  }
  return { generatedAt: new Date().toISOString(), summary, companies: companyResults };
}

function isBlockedText(text) {
  return /验证码|安全验证|访问过于频繁|请完成验证|captcha|access denied|enable javascript/i.test(String(text || ''));
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

async function readCareerPage(page, url, timeoutMs) {
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(400);
    const text = await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
    if (isBlockedText(text) || [401, 403, 429].includes(response?.status?.())) return { status: 'BLOCKED', reasonCode: 'challenge_or_access_blocked', url: page.url(), evidence: text.slice(0, 500) };
    const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => ({ text: (anchor.innerText || anchor.textContent || '').trim(), href: anchor.href })).filter((link) => link.text && link.href));
    const hasJobStructure = /职位|岗位|招聘|job opening|open positions/i.test(text);
    const noOpenings = /暂无(?:职位|岗位|招聘)|没有(?:职位|岗位)|no open positions|no jobs found/i.test(text);
    return {
      status: 'COMPLETED', url: page.url(), hasJobStructure, vacancyStatus: noOpenings ? 'NO_OPENINGS' : hasJobStructure ? 'UNKNOWN' : 'NOT_A_LIST',
      evidence: text.slice(0, 1000), links,
    };
  } catch (error) {
    return { status: 'FAILED', reasonCode: 'career_page_navigation_failed', url, error: String(error?.message || error) };
  }
}

export async function discoverCompanyWithBrowser({ company, officialDomain = '', browser, maxResults = 10, timeoutMs = 20_000 }) {
  if (!company || !browser) throw new Error('company and browser are required');
  const page = await browser.newPage();
  const query = `${company} 招聘`;
  const officialCandidates = [], leads = [], rejected = [], failures = [];
  try {
    await page.goto(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const bodyText = await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
    if (isBlockedText(bodyText)) return { company, query, status: 'BLOCKED', reasonCode: 'search_challenge_or_access_blocked', officialCandidates, leads, rejected, failures };
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
        const careerPage = await readCareerPage(page, finalUrl, timeoutMs);
        officialCandidates.push({ ...base, pageStatus: careerPage.status, vacancyStatus: careerPage.vacancyStatus || null, evidence: careerPage.evidence || '' });
        if (careerPage.status === 'COMPLETED') {
          for (const link of discoverCareerLinks(careerPage.url, careerPage.links)) {
            officialCandidates.push({ ...base, title: link.text || row.title, url: link.url, recruitmentType: link.recruitmentType, pageStatus: 'DISCOVERED', discoveryReason: link.discoveryReason });
          }
        } else failures.push({ stage: 'inspect_career_page', url: finalUrl, reasonCode: careerPage.reasonCode || 'career_page_failed', error: careerPage.error || '' });
      }
    }
    const unique = (items) => [...new Map(items.map((item) => [item.url, item])).values()];
    return { company, query, status: 'COMPLETED', officialCandidates: unique(officialCandidates), leads: unique(leads), rejected: unique(rejected), failures };
  } catch (error) {
    return { company, query, status: 'FAILED', reasonCode: 'search_navigation_failed', officialCandidates, leads, rejected, failures: [...failures, { stage: 'search', reasonCode: 'search_navigation_failed', error: String(error?.message || error) }] };
  } finally {
    await page.close();
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    values[name] = name === 'headful' ? true : argv[++index];
  }
  return values;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input || !args['output-dir']) {
    process.stdout.write('Usage: node scripts/company-browser-discovery.mjs --input companies.json --output-dir output [--max-results 10] [--headful]\n');
    return args.help ? 0 : 2;
  }
  let input;
  try { input = JSON.parse(await fs.readFile(args.input, 'utf8')); }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'input_read_failed', error: String(error?.message || error) })}\n`); return 2; }
  const companies = Array.isArray(input) ? input : input.companies;
  if (!Array.isArray(companies) || !companies.every((item) => typeof item?.company === 'string' && item.company.trim())) {
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'invalid_company_input' })}\n`); return 2;
  }
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'playwright_not_available', error: String(error?.message || error) })}\n`); return 2; }
  let browser;
  try { browser = await chromium.launch({ headless: !args.headful }); }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'browser_launch_failed', error: String(error?.message || error) })}\n`); return 2; }
  try {
    const results = [];
    for (const company of companies) results.push(await discoverCompanyWithBrowser({ ...company, browser, maxResults: Number(args['max-results'] || 10) }));
    const report = buildDiscoveryReport(results);
    const candidates = results.flatMap((result) => result.officialCandidates).map(({ company, title, url, sourceUrl, searchQuery, evidence, ...rest }) => ({ company, title, url, sourceUrl, searchQuery, evidence, ...rest, discoveryMethod: 'playwright_search' }));
    const leads = results.flatMap((result) => result.leads).map((lead) => ({ ...lead, discoveryMethod: 'playwright_search' }));
    await fs.mkdir(args['output-dir'], { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(args['output-dir'], 'candidates.json'), `${JSON.stringify(candidates, null, 2)}\n`),
      fs.writeFile(path.join(args['output-dir'], 'leads.json'), `${JSON.stringify(leads, null, 2)}\n`),
      fs.writeFile(path.join(args['output-dir'], 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
    ]);
    process.stdout.write(`${JSON.stringify({ status: 'COMPLETED', outputDir: args['output-dir'], summary: report.summary })}\n`);
    return 0;
  } finally { await browser.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then((code) => { process.exitCode = code; }).catch((error) => { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'unexpected_error', error: String(error?.message || error) })}\n`); process.exitCode = 1; });
}
