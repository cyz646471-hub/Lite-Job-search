import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { buildNewCompanyWatchPlan } from '../src/application/build-new-company-watch-plan.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

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

async function readWatchlist(file) {
  const payload = JSON.parse(await readFile(path.resolve(file), 'utf8'));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.companies)) return payload.companies;
  throw new Error('watchlist must be an array or an object with companies');
}

async function atomicWrite(file, value) {
  const destination = path.resolve(file);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, destination);
}

export async function prepareNewCompanyWatch({
  watchlistFile = 'data/company-registry/new-company-watchlist.json',
  databaseFile = 'data/lite-job-search.sqlite',
  outputFile = 'output/new-company-watch/queue.json',
  staleDays = 3,
  targetCount = 50,
  includeFresh = false,
  now = new Date().toISOString(),
} = {}) {
  const repository = openSqliteMarketDiscoveryRepository({ file: path.resolve(databaseFile) });
  try {
    repository.migrate();
    const plan = buildNewCompanyWatchPlan({
      watchlist: await readWatchlist(watchlistFile),
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
  const plan = await prepareNewCompanyWatch({
    watchlistFile: args.watchlist,
    databaseFile: args.database,
    outputFile: args.output,
    staleDays: args['stale-days'],
    targetCount: args['target-count'],
    includeFresh: args['include-fresh'] === true,
  });
  process.stdout.write(`${JSON.stringify({ mode: plan.mode, selectedCount: plan.selectedCount, stateCounts: plan.stateCounts, skipped: plan.skipped }, null, 2)}\n`);
}
