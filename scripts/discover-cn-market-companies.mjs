import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { buildCnMarketDiscoveryPlan, extractCnMarketCompanyLeads } from '../src/application/build-cn-market-discovery-plan.mjs';
import { isPublicSearchBlockedSnapshot, normalizePublicSearchEngine, publicSearchUrl } from '../src/adapters/browser/public-search-page-adapter.mjs';
import { createBrowserRuntime } from './chrome-extension-browser-adapter.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

function args(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { const key = argv[i]; if (!key.startsWith('--')) continue; const value = argv[i + 1]; out[key.slice(2)] = !value || value.startsWith('--') ? true : value; if (out[key.slice(2)] !== true) i += 1; } return out; }
async function atomicJson(file, value) { const target = path.resolve(file); await mkdir(path.dirname(target), { recursive: true }); const temp = `${target}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, target); }
async function delay(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function readCheckpoint(file) { try { return JSON.parse(await readFile(path.resolve(file), 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; } }
function pagedSearchUrl(engine, query, pageIndex) { const url = new URL(publicSearchUrl(engine, query)); url.searchParams.set(engine === 'google' ? 'start' : 'pn', String(Math.max(0, pageIndex) * 10)); return url.href; }
function bounded(value, fallback, maximum) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, Math.trunc(parsed))) : fallback; }

export async function discoverCnMarketCompanies({
  databaseFile = 'data/lite-job-search.sqlite', outputFile = 'output/cn-market-discovery/company-leads.json',
  profileDir = 'data/browser-profiles/cn-market-lead-discovery', role = '产品经理', industry = '', targetCount = 50,
  searchDelayMs = 4_000, maxResults = 10, maxPagesPerQuery = 5, headless = false, searchEngine = 'google',
} = {}) {
  const repository = openSqliteMarketDiscoveryRepository({ file: path.resolve(databaseFile) });
  repository.migrate();
  const knownCompanies = repository.listCompanies();
  const base = buildCnMarketDiscoveryPlan({ role, industry, targetCount, knownCompanies });
  const selectedEngine = normalizePublicSearchEngine(searchEngine);
  const checkpoint = await readCheckpoint(outputFile);
  const leads = Array.isArray(checkpoint?.rawLeads) ? checkpoint.rawLeads : [];
  const searchRuns = Array.isArray(checkpoint?.searchRuns) ? checkpoint.searchRuns : [];
  const completed = new Set(searchRuns.filter((run) => run.status === 'SUCCESS').map((run) => run.key));
  const checkpointResult = async (status = 'RUNNING') => {
    const finalPlan = buildCnMarketDiscoveryPlan({ role, industry, targetCount, knownCompanies, discoveredCandidates: leads });
    const result = { ...finalPlan, rawLeads: leads, discoveredLeadCount: leads.length, searchRuns, queue: finalPlan.queue, companies: finalPlan.queue, status };
    await atomicJson(outputFile, result);
    return result;
  };
  const circuit = repository.getProviderCircuitState(selectedEngine);
  if (circuit && ['OPEN', 'HALF_OPEN'].includes(circuit.state)) {
    searchRuns.push({
      key: 'PROVIDER_PREFLIGHT',
      status: 'BLOCKED',
      reasonCode: `PROVIDER_CIRCUIT_${circuit.state}`,
      provider: selectedEngine,
    });
    repository.close();
    return checkpointResult('BLOCKED');
  }
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await createBrowserRuntime({ mode: 'persistent-chrome', chromium, profileDir: path.resolve(profileDir), headless });
    const seenNames = new Set([
      ...knownCompanies.flatMap((company) => [company.canonicalName, company.chineseName, company.englishName, ...(company.aliases || [])]),
      ...leads.flatMap((lead) => [lead.company, lead.chineseName, ...(lead.aliases || [])]),
    ]);
    for (const query of base.queries) {
      for (let pageIndex = 0; pageIndex < bounded(maxPagesPerQuery, 5, 20); pageIndex += 1) {
        if (leads.length >= base.targetCount) return checkpointResult('COMPLETE');
        const key = `${query.id}:${pageIndex}`;
        if (completed.has(key)) continue;
        const page = await browser.newPage();
        try {
          const response = await page.goto(pagedSearchUrl(selectedEngine, query.query, pageIndex), { waitUntil: 'domcontentloaded', timeout: 15_000 });
          const text = await page.readBodyText();
          if (isPublicSearchBlockedSnapshot({ engine: selectedEngine, text, status: response?.status?.() || 200, url: page.url() })) {
            searchRuns.push({ key, query, pageIndex, status: 'BLOCKED', reasonCode: `${selectedEngine.toUpperCase()}_SECURITY_CHALLENGE` });
            return checkpointResult('BLOCKED');
          }
          const extracted = extractCnMarketCompanyLeads(await page.readPublicSearchRows(selectedEngine, maxResults), { query, seenNames });
          extracted.leads.forEach((lead) => { seenNames.add(lead.company); leads.push(lead); });
          searchRuns.push({ key, query, pageIndex, status: 'SUCCESS', candidateRows: extracted.leads.length, rejectedRows: extracted.rejected.length });
        } catch (error) {
          searchRuns.push({ key, query, pageIndex, status: 'FAILED', reasonCode: 'PUBLIC_SEARCH_FAILED', error: String(error?.message || error) });
        } finally { await page.close().catch(() => {}); }
        await checkpointResult('RUNNING');
        await delay(Math.max(4_000, Number(searchDelayMs) || 4_000));
      }
    }
  } finally { await browser?.close(); repository.close(); }
  return checkpointResult('COMPLETE');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = args(process.argv.slice(2));
  discoverCnMarketCompanies({ databaseFile: input.database, outputFile: input.output, profileDir: input['profile-dir'], role: input.role, industry: input.industry, targetCount: input['target-count'], searchDelayMs: input['search-delay-ms'], maxResults: input['max-results'], maxPagesPerQuery: input['max-pages-per-query'], headless: input.headless === true, searchEngine: input['search-engine'] }).then((result) => process.stdout.write(`${JSON.stringify({ status: result.status, discoveredLeadCount: result.discoveredLeadCount, queuedCompanyCount: result.queue.length, outputFile: input.output || 'output/cn-market-discovery/company-leads.json' })}\n`)).catch((error) => { process.stderr.write(`${JSON.stringify({ status: 'FAILED', error: String(error?.message || error) })}\n`); process.exitCode = 2; });
}
