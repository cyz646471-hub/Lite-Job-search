import { readFile } from 'node:fs/promises';

import { discoverMarketJobs } from '../application/discover-market-jobs.mjs';
import { createMarketDiscoveryRuntime } from '../runtime/create-market-discovery-runtime.mjs';
import { buildQualityReport } from '../quality/quality-report.mjs';
import { readRecords } from './io.mjs';

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function emptyReport(failure) {
  return {
    searchQueries: [],
    candidateUrlCount: 0,
    candidateCompanyCount: 0,
    officialVerifiedCount: 0,
    reviewCount: 0,
    rejectedCount: 0,
    extractedJobCount: 0,
    failures: [failure],
    llmUsage: [],
    quality: buildQualityReport({}),
  };
}

export function parseTimeRange(value, fallback = 90) {
  if (value == null || value === '') return fallback;
  const numeric = Number(value);
  if (Number.isInteger(numeric)) return numeric;
  const text = String(value).trim().toLowerCase();
  const amount = Number(text.match(/\d+/)?.[0] || 0);
  if (!amount) return fallback;
  if (/month|个月|月/.test(text)) return amount * 30;
  if (/week|周|星期/.test(text)) return amount * 7;
  if (/day|天|日/.test(text)) return amount;
  return fallback;
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
    const reason = 'LLM_PLANNING_NOT_CONFIGURED';
    return {
      status: 'NOT_CONFIGURED',
      reason,
      liveSearchExecuted: false,
      jobsStored: 0,
      portalsVerified: 0,
      report: emptyReport({
        stage: 'configuration',
        code: 'NOT_CONFIGURED',
        provider: null,
        query: null,
        message: reason,
        url: null,
      }),
    };
  }
  const manualEntries = options.manual ? await readRecords(options.manual) : [];
  const fixturePages = options.fixturePages ? await readJson(options.fixturePages) : null;
  let runtime;
  try {
    runtime = await runtimeFactory({
      env,
      market: options.market,
      databaseFile: options.database,
      manualEntries,
      planningFixture,
      fixturePages,
    });
    return await discoverMarketJobs({
      market: options.market,
      roleType: options.role,
      industryTags: String(options.industry || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      location: options.location || null,
      freshnessDays: parseTimeRange(options.sinceDays || options.timeRange, 90),
      targetCount: Number(options.limit || options.targetCount || 20),
    }, runtime);
  } catch (error) {
    const message = String(error?.message || error || 'unknown error').slice(0, 240);
    return {
      status: 'FAILED',
      reason: message,
      runId: error?.runId || null,
      liveSearchExecuted: error?.liveSearchExecuted === true,
      jobsStored: 0,
      portalsVerified: 0,
      report: emptyReport({
        stage: error?.failureStage || (runtime ? 'discovery' : 'runtime_initialization'),
        code: 'FAILED',
        provider: null,
        query: null,
        message,
        url: null,
      }),
    };
  } finally {
    runtime?.close();
  }
}
