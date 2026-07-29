import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';
import { finalizeControlTaskOutput } from '../src/application/finalize-control-task-output.mjs';
import { runWithWorkerErrorPolicy } from '../src/application/worker-error-policy.mjs';
import { normalizeBrowserCompanyInput } from './company-browser-discovery.mjs';
import { runPersistentBrowserSupervisor } from './run-persistent-browser-supervisor.mjs';

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

function normalized(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function companyMatches(stored, input) {
  const inputNames = new Set([
    input.company,
    input.chineseName,
    input.englishName,
    ...(input.aliases || []),
  ].map(normalized).filter(Boolean));
  const inputDomains = new Set([
    input.officialDomain,
    ...(input.officialDomains || []),
  ].map(normalized).filter(Boolean));
  return [
    stored.canonicalName,
    stored.chineseName,
    stored.englishName,
    ...(stored.aliases || []),
  ].map(normalized).some((name) => inputNames.has(name))
    || (stored.officialDomains || []).map(normalized)
      .some((domain) => inputDomains.has(domain));
}

function stableCompanyId(company) {
  if (company.id) return String(company.id);
  return `company-plan-${createHash('sha256')
    .update(JSON.stringify([company]))
    .digest('hex')
    .slice(0, 24)}`;
}

export function selectCompanies(task, companies, repository) {
  const storedCompanies = repository.listCompanies();
  const portals = repository.listCareerPortals();
  const selected = companies.filter((company) => {
    const stored = storedCompanies.find((candidate) => companyMatches(candidate, company));
    if (task.selectionMode === 'NEW_COMPANIES_ONLY') return !stored;
    if (task.selectionMode === 'RECHECK_EXISTING_AND_NEW') return true;
    if (!stored) return true;
    const verified = portals.filter((portal) => (
      portal.companyId === stored.id && portal.verificationStatus === 'VERIFIED'
    ));
    return !verified.length || verified.some((portal) => (
      !portal.lastCheckedAt
      || portal.lastCheckedAt.slice(0, 10) < task.absoluteDateFrom
    ));
  });
  const multiplier = task.targetUnit === 'COMPANIES_PROCESSED' ? 1 : 5;
  return selected.slice(0, Math.min(selected.length, task.targetCount * multiplier));
}

function batchCompanyIds(task, repository) {
  const items = repository.listBatchItems(task.batchId);
  const companies = repository.listCompanies();
  return new Set(items.flatMap((item) => {
    const stored = companies.find((candidate) => companyMatches(candidate, item.input || {}));
    return stored ? [stored.id] : [];
  }));
}

export function targetProgress(task, repository) {
  const companyIds = batchCompanyIds(task, repository);
  if (task.targetUnit === 'COMPANIES_PROCESSED') {
    const items = repository.listBatchItems(task.batchId);
    return items.filter((item) => item.status === 'SUCCEEDED').length;
  }
  if (task.targetUnit === 'COMPANIES_WITH_VERIFIED_PORTAL') {
    return new Set(repository.listCareerPortals()
      .filter((portal) => (
        companyIds.has(portal.companyId)
        && portal.verificationStatus === 'VERIFIED'
      ))
      .map((portal) => portal.companyId)).size;
  }
  const keywords = task.roleKeywords.map((value) => value.toLowerCase());
  return new Set(repository.listJobOpenings()
    .filter((job) => (
      companyIds.has(job.companyId)
      && (!job.publishedAt
        || (job.publishedAt.slice(0, 10) >= task.absoluteDateFrom
          && job.publishedAt.slice(0, 10) <= task.absoluteDateTo))
      && keywords.some((keyword) => (
        String(job.title || '').toLowerCase().includes(keyword)
        || String(job.normalizedTitle || '').toLowerCase().includes(keyword)
      ))
    ))
    .map((job) => job.companyId)).size;
}

export async function runControlTask(args = {}, dependencies = {}) {
  if (!args.task || !args.registry || !args.database || !args['output-dir']) {
    throw new Error('task, registry, database and output-dir are required');
  }
  const database = path.resolve(args.database);
  const registry = JSON.parse(await readFile(args.registry, 'utf8'));
  const companies = normalizeBrowserCompanyInput(registry);
  let repository = openSqliteMarketDiscoveryRepository({ file: database });
  repository.migrate();
  const task = repository.getControlTask(args.task);
  if (!task) throw new Error(`unknown control task: ${args.task}`);
  const selected = selectCompanies(task, companies, repository)
    .map((company) => ({ ...company, id: stableCompanyId(company) }));
  if (!selected.length) {
    repository.updateControlTaskState({
      id: task.id,
      state: 'PARTIAL',
      updatedAt: new Date().toISOString(),
    });
    repository.close();
    return { status: 'PARTIAL', reason: 'NO_ELIGIBLE_COMPANIES', selected: 0 };
  }
  const materializedAt = new Date().toISOString();
  for (const [position, company] of selected.entries()) {
    repository.ensureBatchItem({
      batchId: task.batchId,
      itemKey: String(company.id),
      position,
      input: company,
      createdAt: materializedAt,
    });
  }
  repository.updateControlTaskState({
    id: task.id,
    state: 'RUNNING',
    updatedAt: new Date().toISOString(),
  });
  repository.close();

  const outputDir = path.resolve(args['output-dir']);
  await mkdir(outputDir, { recursive: true });
  const selectedFile = path.join(outputDir, 'selected-companies.json');
  await writeFile(selectedFile, `${JSON.stringify(selected, null, 2)}\n`);
  const maxPerRun = Math.max(1, Math.min(200, Number(args['max-companies-per-run']) || 10));
  const configuredSupervisorRetries = Number(args['max-supervisor-retries']);
  const maxSupervisorRetries = Math.max(
    0,
    Math.min(10, Number.isFinite(configuredSupervisorRetries) ? configuredSupervisorRetries : 2),
  );
  const configuredRetryDelayMs = Number(args['supervisor-retry-delay-ms']);
  const retryDelayMs = Math.max(
    0,
    Math.min(30_000, Number.isFinite(configuredRetryDelayMs) ? configuredRetryDelayMs : 2_000),
  );
  const runSupervisor = dependencies.runSupervisor || runPersistentBrowserSupervisor;
  let finalRun = null;
  let progress = 0;
  let pausedByRecovery = null;
  for (let offset = 0; offset < selected.length; offset += maxPerRun) {
    repository = openSqliteMarketDiscoveryRepository({ file: database });
    repository.migrate();
    const stoppedBeforeChunk = repository.isBatchStopRequested(task.batchId);
    repository.close();
    if (stoppedBeforeChunk) break;
    const chunk = selected.slice(offset, offset + maxPerRun);
    const chunkFile = path.join(outputDir, `selected-companies-${String(offset / maxPerRun + 1).padStart(4, '0')}.json`);
    await writeFile(chunkFile, `${JSON.stringify(chunk, null, 2)}\n`);
    const supervised = await runWithWorkerErrorPolicy(() => runSupervisor({
        input: chunkFile,
        outputDir,
        database,
        profileDir: args['profile-dir'],
        batchId: task.batchId,
        batchInputHash: task.batchId,
        targetCount: chunk.length,
        role: task.roleKeywords.join(','),
        industry: task.industry || '',
        location: task.location || '',
        freshnessDays: Math.max(
          1,
          Math.ceil((Date.parse(task.absoluteDateTo) - Date.parse(task.absoluteDateFrom))
            / (24 * 60 * 60 * 1000)),
        ),
        maxCompaniesPerRun: maxPerRun,
        timeoutMs: Number(args['timeout-ms']) || 15_000,
        searchDelayMs: Number(args['search-delay-ms']) || 4_000,
        searchJitterMs: args['search-jitter-ms'] == null
          ? 4_000
          : Number(args['search-jitter-ms']),
        retryFailed: args['retry-failed'] === true,
        allowBaiduFallback: task.allowBaiduFallback,
        searchEngine: args['search-engine'] || 'baidu',
        xlsxOutput: args.xlsx || path.join(outputDir, 'student-applications.xlsx'),
        writeArtifacts: false,
      }), {
      maxRetries: maxSupervisorRetries,
      retryDelayMs,
      sleep: dependencies.sleep,
      onError: async ({
        attempt,
        canRetry,
        classification,
      }) => {
        const auditRepository = openSqliteMarketDiscoveryRepository({ file: database });
        try {
          auditRepository.migrate();
          auditRepository.appendAuditLog({
            id: randomUUID(),
            action: canRetry ? 'WORKER_ERROR_RETRY_SCHEDULED' : 'WORKER_ERROR_TERMINAL_ACTION',
            targetType: 'TASK',
            targetId: task.id,
            actor: 'control-task-runner',
            details: {
              batchId: task.batchId,
              chunkOffset: offset,
              attempt,
              canRetry,
              code: classification.code,
              action: classification.action,
              reason: classification.reason.slice(0, 500),
            },
            createdAt: new Date().toISOString(),
          });
        } finally {
          auditRepository.close();
        }
      },
    });
    if (supervised.status === 'PAUSED') {
      pausedByRecovery = supervised.error;
      finalRun = {
        status: 'PAUSED',
        reasonCode: supervised.error.code,
        reason: supervised.error.reason,
      };
    } else {
      finalRun = supervised.value;
    }
    repository = openSqliteMarketDiscoveryRepository({ file: database });
    repository.migrate();
    if (pausedByRecovery) {
      repository.completeBatch({
        id: task.batchId,
        status: 'PAUSED',
        completedAt: new Date().toISOString(),
      });
    }
    progress = targetProgress(task, repository);
    const pending = repository.listBatchItems(task.batchId)
      .some((item) => ['PENDING', 'RUNNING'].includes(item.status));
    const stopped = repository.isBatchStopRequested(task.batchId);
    repository.close();
    const moreChunks = offset + maxPerRun < selected.length;
    if (
      progress >= task.targetCount
      || pausedByRecovery
      || stopped
      || finalRun?.status === 'STOPPED'
      || (!pending && !moreChunks)
    ) break;
  }

  repository = openSqliteMarketDiscoveryRepository({ file: database });
  repository.migrate();
  const finalOutput = pausedByRecovery
    ? null
    : await finalizeControlTaskOutput({
        database,
        outputDir,
        taskId: task.id,
        batchId: task.batchId,
      });
  const state = repository.isBatchStopRequested(task.batchId)
    ? 'STOPPED'
    : pausedByRecovery
      ? 'PARTIAL'
      : progress >= task.targetCount
        ? 'COMPLETE'
        : 'PARTIAL';
  repository.updateControlTaskState({
    id: task.id,
    state,
    updatedAt: new Date().toISOString(),
  });
  repository.close();
  return {
    status: state,
    taskId: task.id,
    batchId: task.batchId,
    selected: selected.length,
    targetProgress: progress,
    targetCount: task.targetCount,
    lastRunStatus: finalRun?.status || null,
    recovery: pausedByRecovery,
    finalOutput,
  };
}

async function markTaskFailed(args) {
  if (!args.task || !args.database) return;
  let repository;
  try {
    repository = openSqliteMarketDiscoveryRepository({ file: path.resolve(args.database) });
    repository.migrate();
    if (repository.getControlTask(args.task)) {
      repository.updateControlTaskState({
        id: args.task,
        state: 'FAILED',
        updatedAt: new Date().toISOString(),
      });
    }
  } finally {
    repository?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  runControlTask(args).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(async (error) => {
    await markTaskFailed(args).catch(() => {});
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 2;
  });
}
