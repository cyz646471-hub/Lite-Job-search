import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildMonitorCanaryCohort } from '../src/application/build-monitor-canary-cohort.mjs';
import { runKnownEndpointMonitor } from '../src/application/run-known-endpoint-monitor.mjs';
import { createPageFetcher } from '../src/runtime/fetch-page.mjs';
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
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

function metrics(repository, startedAt, cohort, cycleReports) {
  const observations = repository.listFetchObservations({ limit: 5000 })
    .filter((item) => item.fetchedAt >= startedAt
      && cohort.companies.some((company) => company.sourceEndpointId === item.sourceEndpointId));
  const successful = observations.filter((item) => (
    ['SUCCESS', 'NOT_MODIFIED', 'NO_OPENINGS'].includes(item.outcome)
  ));
  const cohortCompanyIds = new Set(cohort.companies.map((item) => item.companyId));
  const jobs = repository.listJobOpenings()
    .filter((job) => cohortCompanyIds.has(job.companyId));
  const cohortJobIds = new Set(jobs.map((job) => job.id));
  const changes = repository.listJobRevisions({ limit: 5000 })
    .filter((item) => item.observedAt >= startedAt
      && cohortJobIds.has(item.jobId)
      && ['DISCOVERED', 'UPDATED', 'CLOSED', 'REOPENED'].includes(item.changeType));
  const browserFallbacks = observations.filter((item) => (
    item.metadata?.transport === 'BROWSER'
  ));
  const actionable = jobs.filter((job) => (
    job.status === 'ACTIVE'
    && job.publicationStatus === 'PUBLISHED'
    && ['A', 'B'].includes(job.qualityGrade)
  ));
  return {
    attemptedChecks: observations.length,
    successfulChecks: successful.length,
    endpointCheckSuccessRate: observations.length
      ? successful.length / observations.length
      : 0,
    changedJobCount: changes.length,
    jobChangeDiscoveryRate: successful.length ? changes.length / successful.length : 0,
    browserFallbackCount: browserFallbacks.length,
    browserFallbackRate: observations.length
      ? browserFallbacks.length / observations.length
      : 0,
    actionableJobCount: actionable.length,
    monitoredJobCount: jobs.length,
    actionableRate: jobs.length ? actionable.length / jobs.length : 0,
    cycleCount: cycleReports.length,
  };
}

export async function runOneDayMonitorCanary({
  databaseFile = 'data/lite-job-search.sqlite',
  outputDir = 'output/monitoring-network/one-day-canary',
  targetCount = 250,
  durationHours = 24,
  cycleMinutes = 30,
  timeoutMs = 15_000,
  singleCycle = false,
} = {}) {
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.resolve(databaseFile),
  });
  repository.migrate();
  const startedAt = new Date().toISOString();
  const cohort = buildMonitorCanaryCohort({
    companies: repository.listCompanies(),
    portals: repository.listCareerPortals(),
    sourceEndpoints: repository.listSourceEndpoints(),
    monitorPolicies: repository.listMonitorPolicies(),
    jobs: repository.listJobOpenings(),
    targetCount,
  });
  const endAt = new Date(
    Date.parse(startedAt) + Math.max(0.01, Number(durationHours) || 24) * 3_600_000,
  ).toISOString();
  const cycleReports = [];
  await atomicJson(path.join(outputDir, 'cohort.json'), cohort);
  await atomicJson(path.join(outputDir, 'status.json'), {
    status: 'STARTING',
    startedAt,
    endAt,
    updatedAt: new Date().toISOString(),
    cohort,
    metrics: metrics(repository, startedAt, cohort, cycleReports),
    cycles: cycleReports,
  });

  try {
    let cycle = 0;
    while (singleCycle || Date.now() < Date.parse(endAt)) {
      const report = await runKnownEndpointMonitor({
        repository,
        fetchPage: createPageFetcher({ timeoutMs }),
        outputDir,
        targetCount: cohort.selectedCount,
        market: 'CN',
        includeNotDue: cycle === 0,
        sourceEndpointIds: cohort.companies.map((item) => item.sourceEndpointId),
        onProgress: async (progress) => {
          await atomicJson(path.join(outputDir, 'status.json'), {
            status: 'RUNNING',
            startedAt,
            endAt,
            updatedAt: new Date().toISOString(),
            cohort: {
              targetCount: cohort.targetCount,
              eligibleCompanyCount: cohort.eligibleCompanyCount,
              selectedCount: cohort.selectedCount,
              shortage: cohort.shortage,
            },
            currentCycle: cycle,
            currentCycleProgress: progress,
            metrics: metrics(repository, startedAt, cohort, cycleReports),
            cycles: cycleReports,
          });
        },
      });
      cycleReports.push({
        cycle,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        processedCount: report.processedCount,
        counts: report.counts,
        jobCount: report.jobCount,
      });
      const status = {
        status: singleCycle ? 'COMPLETED_SINGLE_CYCLE' : 'RUNNING',
        startedAt,
        endAt,
        updatedAt: new Date().toISOString(),
        cohort,
        metrics: metrics(repository, startedAt, cohort, cycleReports),
        cycles: cycleReports,
      };
      await atomicJson(path.join(outputDir, 'status.json'), status);
      cycle += 1;
      if (singleCycle) return status;
      const remaining = Date.parse(endAt) - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(
        resolve,
        Math.min(remaining, Math.max(1, Number(cycleMinutes) || 30) * 60_000),
      ));
    }
    const finalReport = {
      status: 'COMPLETED',
      startedAt,
      completedAt: new Date().toISOString(),
      cohort,
      metrics: metrics(repository, startedAt, cohort, cycleReports),
      cycles: cycleReports,
    };
    await atomicJson(path.join(outputDir, 'final-report.json'), finalReport);
    await atomicJson(path.join(outputDir, 'status.json'), finalReport);
    return finalReport;
  } finally {
    repository.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  runOneDayMonitorCanary({
    databaseFile: args.database,
    outputDir: args.output,
    targetCount: args['target-count'],
    durationHours: args['duration-hours'],
    cycleMinutes: args['cycle-minutes'],
    timeoutMs: args['timeout-ms'],
    singleCycle: args['single-cycle'] === true,
  }).then((report) => {
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      selectedCount: report.cohort.selectedCount,
      shortage: report.cohort.shortage,
      metrics: report.metrics,
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 2;
  });
}
