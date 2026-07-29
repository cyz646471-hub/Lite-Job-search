import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { prepareNewCompanyWatch } from './prepare-new-company-watch.mjs';
import { runPersistentBrowserSupervisor } from './run-persistent-browser-supervisor.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values[key] = true;
    else { values[key] = next; index += 1; }
  }
  return values;
}

export async function runNewCompanyWatch(options = {}) {
  const queueFile = path.resolve(options.queueFile || 'output/new-company-watch/queue.json');
  const plan = await prepareNewCompanyWatch({
    watchlistFile: options.watchlistFile,
    databaseFile: options.databaseFile,
    outputFile: queueFile,
    staleDays: options.staleDays,
    targetCount: options.targetCount,
    includeFresh: options.includeFresh,
  });
  if (!plan.companies.length) return { plan, run: null };
  const run = await runPersistentBrowserSupervisor({
    input: queueFile,
    outputDir: options.outputDir || 'output/new-company-watch/run',
    database: options.databaseFile || 'data/lite-job-search.sqlite',
    profileDir: options.profileDir,
    targetCount: plan.companies.length,
    maxCompaniesPerRun: options.maxCompaniesPerRun || Math.min(100, plan.companies.length),
    role: options.role || '公开招聘岗位',
    industry: options.industry || '',
    location: options.location || '中国大陆',
    freshnessDays: options.freshnessDays || 90,
    headless: options.headless === true,
    writeArtifacts: options.writeArtifacts !== false,
    allowSearchFallback: true,
    searchEngine: options.searchEngine || 'baidu',
  });
  return { plan, run };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const result = await runNewCompanyWatch({
    watchlistFile: args.watchlist,
    databaseFile: args.database,
    queueFile: args.queue,
    outputDir: args['output-dir'],
    profileDir: args['profile-dir'],
    staleDays: args['stale-days'],
    targetCount: args['target-count'],
    maxCompaniesPerRun: args['max-companies-per-run'],
    freshnessDays: args['freshness-days'],
    role: args.role,
    industry: args.industry,
    location: args.location,
    searchEngine: args['search-engine'],
    includeFresh: args['include-fresh'] === true,
    headless: args.headless === true,
  });
  process.stdout.write(`${JSON.stringify({ selectedCount: result.plan.selectedCount, stateCounts: result.plan.stateCounts, executed: Boolean(result.run) }, null, 2)}\n`);
}
