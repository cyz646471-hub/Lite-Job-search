import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { discoverCnMarketCompanies } from './discover-cn-market-companies.mjs';
import { runPersistentBrowserSupervisor } from './run-persistent-browser-supervisor.mjs';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    out[token.slice(2)] = !next || next.startsWith('--') ? true : next;
    if (out[token.slice(2)] !== true) index += 1;
  }
  return out;
}

export async function runCnMarketDiscoveryCycle({
  databaseFile = 'data/lite-job-search.sqlite', outputDir = 'output/cn-market-discovery',
  profileDir = 'data/browser-profiles/career-op-main', role = '产品经理', industry = '', targetCount = 50,
  searchDelayMs = 4_000, headless = false, batchId = '', searchEngine = 'google',
} = {}) {
  const resolvedOutput = path.resolve(outputDir);
  const queueFile = path.join(resolvedOutput, 'company-leads.json');
  const discovery = await discoverCnMarketCompanies({
    databaseFile, outputFile: queueFile, profileDir, role, industry, targetCount, searchDelayMs, headless, searchEngine,
  });
  if (discovery.status === 'BLOCKED' || !discovery.queue.length) {
    return { status: discovery.status, phase: 'MARKET_DISCOVERY', discovery, worker: null };
  }
  const worker = await runPersistentBrowserSupervisor({
    input: queueFile, outputDir: path.join(resolvedOutput, 'worker'), database: databaseFile, profileDir,
    batchId: batchId || `cn-market-${Date.now()}`, targetCount: discovery.queue.length,
    role, industry, searchDelayMs, headless, searchEngine, allowSearchFallback: true,
  });
  return { status: worker.status, phase: 'COMPANY_VERIFICATION_AND_EXTRACTION', discovery, worker };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = parseArgs(process.argv.slice(2));
  runCnMarketDiscoveryCycle({ databaseFile: input.database, outputDir: input['output-dir'], profileDir: input['profile-dir'], role: input.role, industry: input.industry, targetCount: input['target-count'], searchDelayMs: input['search-delay-ms'], headless: input.headless === true, batchId: input['batch-id'], searchEngine: input['search-engine'] }).then((result) => process.stdout.write(`${JSON.stringify({ status: result.status, phase: result.phase, discoveredLeadCount: result.discovery.discoveredLeadCount, queuedCompanyCount: result.discovery.queue.length, workerBatchId: result.worker?.batchId || null })}\n`)).catch((error) => { process.stderr.write(`${JSON.stringify({ status: 'FAILED', error: String(error?.message || error) })}\n`); process.exitCode = 2; });
}
