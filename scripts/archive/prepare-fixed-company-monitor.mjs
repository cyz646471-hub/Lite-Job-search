import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { buildFixedCompanyMonitorPlan } from '../../src/application/build-fixed-company-monitor-plan.mjs';
import { openSqliteMarketDiscoveryRepository } from '../../src/storage/sqlite-job-repository.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(file), 'utf8'));
}

async function atomicWrite(file, value) {
  const absolute = path.resolve(file);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, absolute);
}

export async function prepareFixedCompanyMonitor({
  registryFile = 'data/company-registry/golden-seed-companies-current.json',
  priorityFile = 'data/company-registry/cn-company-search-seed-v1.json',
  databaseFile = 'data/lite-job-search.sqlite',
  outputFile = 'output/fixed-company-monitor/queue.json',
  staleDays = 7,
  targetCount = 200,
  includeFresh = false,
  now = new Date().toISOString(),
} = {}) {
  const registryPayload = await readJson(registryFile);
  const registry = Array.isArray(registryPayload)
    ? registryPayload
    : registryPayload.companies || registryPayload.records || [];
  const priorityPayload = await readJson(priorityFile);
  const priorityNames = priorityPayload.rawCompanies
    || priorityPayload.companies?.map((company) => company.company || company.name)
    || [];
  const repository = openSqliteMarketDiscoveryRepository({ file: path.resolve(databaseFile) });
  try {
    repository.migrate();
    const plan = buildFixedCompanyMonitorPlan({
      registry,
      priorityNames,
      companies: repository.listCompanies(),
      portals: repository.listCareerPortals(),
      staleDays,
      targetCount,
      includeFresh,
      now,
    });
    await atomicWrite(outputFile, plan);
    return plan;
  } finally {
    repository.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const plan = await prepareFixedCompanyMonitor({
    registryFile: args.registry,
    priorityFile: args.priority,
    databaseFile: args.database,
    outputFile: args.output,
    staleDays: args['stale-days'],
    targetCount: args['target-count'],
    includeFresh: args['include-fresh'] === true,
  });
  process.stdout.write(`${JSON.stringify({
    mode: plan.mode,
    selectedCount: plan.selectedCount,
    eligibleCount: plan.eligibleCount,
    skipped: plan.skipped,
    searchFallbackAllowed: plan.searchFallbackAllowed,
  }, null, 2)}\n`);
}
