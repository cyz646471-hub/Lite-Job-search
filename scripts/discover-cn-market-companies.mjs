import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { buildCnMarketDiscoveryPlan, extractCnMarketCompanyLeads } from '../src/application/build-cn-market-discovery-plan.mjs';
import { isPublicSearchBlockedSnapshot, publicSearchUrl } from '../src/adapters/browser/public-search-page-adapter.mjs';
import { createBrowserRuntime } from './chrome-extension-browser-adapter.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

function args(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { const key = argv[i]; if (!key.startsWith('--')) continue; const value = argv[i + 1]; out[key.slice(2)] = !value || value.startsWith('--') ? true : value; if (out[key.slice(2)] !== true) i += 1; } return out; }
function count(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.max(1, Math.min(1_000, parsed)) : fallback; }
async function atomicJson(file, value) { const target = path.resolve(file); await mkdir(path.dirname(target), { recursive: true }); const temp = `${target}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, target); }
async function delay(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }

export async function discoverCnMarketCompanies({
  databaseFile = 'data/lite-job-search.sqlite', outputFile = 'output/cn-market-discovery/company-leads.json',
  profileDir = 'data/browser-profiles/career-op-main', role = '产品经理', industry = '', targetCount = 50,
  searchDelayMs = 4_000, maxResults = 10, headless = false,
} = {}) {
  const repository = openSqliteMarketDiscoveryRepository({ file: path.resolve(databaseFile) });
  repository.migrate();
  const knownCompanies = repository.listCompanies();
  const base = buildCnMarketDiscoveryPlan({ role, industry, targetCount, knownCompanies });
  let browser;
  const leads = [];
  const searchRuns = [];
  try {
    const { chromium } = await import('playwright');
    browser = await createBrowserRuntime({ mode: 'persistent-chrome', chromium, profileDir: path.resolve(profileDir), headless });
    const seenNames = new Set(knownCompanies.flatMap((company) => [company.canonicalName, company.chineseName, company.englishName, ...(company.aliases || [])]));
    for (const query of base.queries) {
      if (leads.length >= base.targetCount) break;
      const page = await browser.newPage();
      try {
        const response = await page.goto(publicSearchUrl('baidu', query.query), { waitUntil: 'domcontentloaded', timeout: 15_000 });
        const text = await page.readBodyText();
        if (isPublicSearchBlockedSnapshot({ engine: 'baidu', text, status: response?.status?.() || 200, url: page.url() })) {
          searchRuns.push({ query, status: 'BLOCKED', reasonCode: 'BAIDU_SECURITY_CHALLENGE' });
          break;
        }
        const extracted = extractCnMarketCompanyLeads(await page.readSearchRows(maxResults), { query, seenNames });
        extracted.leads.forEach((lead) => { seenNames.add(lead.company); leads.push(lead); });
        searchRuns.push({ query, status: 'SUCCESS', candidateRows: extracted.leads.length, rejectedRows: extracted.rejected.length });
      } catch (error) {
        searchRuns.push({ query, status: 'FAILED', reasonCode: 'PUBLIC_SEARCH_FAILED', error: String(error?.message || error) });
      } finally { await page.close().catch(() => {}); }
      if (leads.length < base.targetCount) await delay(Math.max(4_000, Number(searchDelayMs) || 4_000));
    }
  } finally { await browser?.close(); repository.close(); }
  const finalPlan = buildCnMarketDiscoveryPlan({ role, industry, targetCount, knownCompanies, discoveredCandidates: leads });
  const result = { ...finalPlan, discoveredLeadCount: leads.length, searchRuns, queue: finalPlan.queue, companies: finalPlan.queue, status: searchRuns.some((run) => run.status === 'BLOCKED') ? 'BLOCKED' : 'COMPLETE' };
  await atomicJson(outputFile, result);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = args(process.argv.slice(2));
  discoverCnMarketCompanies({ databaseFile: input.database, outputFile: input.output, profileDir: input['profile-dir'], role: input.role, industry: input.industry, targetCount: input['target-count'], searchDelayMs: input['search-delay-ms'], maxResults: input['max-results'], headless: input.headless === true }).then((result) => process.stdout.write(`${JSON.stringify({ status: result.status, discoveredLeadCount: result.discoveredLeadCount, queuedCompanyCount: result.queue.length, outputFile: input.output || 'output/cn-market-discovery/company-leads.json' })}\n`)).catch((error) => { process.stderr.write(`${JSON.stringify({ status: 'FAILED', error: String(error?.message || error) })}\n`); process.exitCode = 2; });
}
