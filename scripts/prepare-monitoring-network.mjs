import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { buildMonitoringNetworkPlan } from '../src/application/build-monitoring-network-plan.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    values[token.slice(2)] = !next || next.startsWith('--') ? true : next;
    if (values[token.slice(2)] !== true) index += 1;
  }
  return values;
}

async function atomicJson(file, value) {
  const absolute = path.resolve(file);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, absolute);
}

export async function prepareMonitoringNetwork({
  databaseFile = 'data/lite-job-search.sqlite',
  outputFile = 'output/monitoring-network/plan.json',
  searchEngine = 'google',
  market = 'CN',
  targetCount = 300,
  includeNotDue = false,
  now = new Date().toISOString(),
} = {}) {
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.resolve(databaseFile),
  });
  try {
    repository.migrate();
    const plan = buildMonitoringNetworkPlan({
      companies: repository.listCompanies(),
      portals: repository.listCareerPortals(),
      sourceEndpoints: repository.listSourceEndpoints(),
      monitorPolicies: repository.listMonitorPolicies(),
      reviewTasks: repository.listReviewTasks(),
      userActions: repository.listUserActions(),
      jobs: repository.listJobOpenings(),
      providerCircuits: repository.listProviderCircuitStates(),
      searchEngine,
      market,
      targetCount,
      includeNotDue,
      now,
    });
    await atomicJson(outputFile, plan);
    return plan;
  } finally {
    repository.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  prepareMonitoringNetwork({
    databaseFile: args.database,
    outputFile: args.output,
    searchEngine: args['search-engine'],
    market: args.market,
    targetCount: args['target-count'],
    includeNotDue: args['include-not-due'] === true,
  }).then((plan) => {
    process.stdout.write(`${JSON.stringify({
      mode: plan.mode,
      selectedCounts: plan.selectedCounts,
      runnableCount: plan.runnableCount,
      deferredCount: plan.deferredCount,
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 2;
  });
}
