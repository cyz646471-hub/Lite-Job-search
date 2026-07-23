import { readFile } from 'node:fs/promises';

import { discoverMarketJobs } from '../application/discover-market-jobs.mjs';
import { createMarketDiscoveryRuntime } from '../runtime/create-market-discovery-runtime.mjs';
import { readRecords } from './io.mjs';

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function runDiscoverCommand(options, {
  env = process.env,
  runtimeFactory = createMarketDiscoveryRuntime,
} = {}) {
  if (!options.market || !options.role) {
    throw new Error('discover requires --market and --role');
  }
  const planningFixture = options.planningFixture
    ? await readJson(options.planningFixture)
    : null;
  if (!planningFixture && !(env.LITE_JOB_LLM_ENDPOINT && env.LITE_JOB_LLM_MODEL)) {
    return {
      status: 'NOT_CONFIGURED',
      reason: 'LLM_PLANNING_NOT_CONFIGURED',
      liveSearchExecuted: false,
      jobsStored: 0,
      portalsVerified: 0,
    };
  }
  const manualEntries = options.manual ? await readRecords(options.manual) : [];
  const fixturePages = options.fixturePages ? await readJson(options.fixturePages) : null;
  const runtime = await runtimeFactory({
    env,
    market: options.market,
    databaseFile: options.database,
    manualEntries,
    planningFixture,
    fixturePages,
  });
  try {
    return await discoverMarketJobs({
      market: options.market,
      roleType: options.role,
      industryTags: String(options.industry || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      freshnessDays: Number(options.sinceDays || 90),
      targetCount: Number(options.limit || 20),
    }, runtime);
  } finally {
    runtime.close();
  }
}
