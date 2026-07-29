const ACTIVE_TASK_STATES = new Set(['PENDING', 'RUNNING']);
const ACTIVE_BATCH_STATES = new Set(['PENDING', 'RUNNING', 'PAUSED', 'STOP_REQUESTED']);
const TERMINAL_WORKER_STATES = new Set(['EXITED', 'CRASHED']);

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = selector(value) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function companyName(item, companiesById) {
  const input = item?.input || {};
  return input.company
    || input.canonicalName
    || input.chineseName
    || input.englishName
    || companiesById.get(input.id)?.canonicalName
    || null;
}

function itemMatchesCompany(item, companyId) {
  if (!companyId) return false;
  const input = item?.input || {};
  return [input.id, input.companyId, input.companyIdentityKey].includes(companyId)
    || item.itemKey === companyId;
}

function durationMetrics({
  startedAt,
  resumedAt,
  items,
  processed,
  remaining,
  now,
  rollingWindowSeconds = 60 * 60,
}) {
  const startedMs = Date.parse(startedAt || '');
  const resumedMs = Date.parse(resumedAt || '');
  const nowMs = Date.parse(now);
  if (!Number.isFinite(startedMs) || nowMs <= startedMs || processed < 1) {
    return {
      elapsedSeconds: null,
      companiesPerHour: null,
      etaSeconds: null,
      completedInWindow: 0,
      windowStartedAt: null,
    };
  }
  const sessionStartedMs = Number.isFinite(resumedMs) && resumedMs > startedMs
    ? resumedMs
    : startedMs;
  const rollingStartedMs = Math.max(
    sessionStartedMs,
    nowMs - Math.max(60, rollingWindowSeconds) * 1000,
  );
  const completedInWindow = items.filter((item) => {
    if (item.status !== 'SUCCEEDED') return false;
    const completedMs = Date.parse(item.completedAt || '');
    return Number.isFinite(completedMs)
      && completedMs >= rollingStartedMs
      && completedMs <= nowMs;
  }).length;
  const useRollingWindow = rollingStartedMs > startedMs || completedInWindow > 0;
  const measurementStartedMs = useRollingWindow ? rollingStartedMs : startedMs;
  const measurementProcessed = useRollingWindow ? completedInWindow : processed;
  const elapsedSeconds = Math.max(1, Math.round((nowMs - measurementStartedMs) / 1000));
  const companiesPerHour = measurementProcessed / (elapsedSeconds / 3600);
  return {
    elapsedSeconds,
    companiesPerHour: Number(companiesPerHour.toFixed(2)),
    etaSeconds: companiesPerHour > 0
      ? Math.round((remaining / companiesPerHour) * 3600)
      : null,
    completedInWindow: useRollingWindow ? completedInWindow : processed,
    windowStartedAt: new Date(measurementStartedMs).toISOString(),
  };
}

export function buildControlProgress({
  repository,
  batchId = null,
  now = new Date().toISOString(),
  staleHeartbeatSeconds = 60,
} = {}) {
  if (!repository) throw new Error('repository is required');
  const tasks = repository.listControlTasks();
  const batches = repository.listBatchRuns();
  const selectedTask = batchId
    ? tasks.find((task) => task.batchId === batchId)
    : tasks.find((task) => ACTIVE_TASK_STATES.has(task.state))
      || tasks[0]
      || null;
  const selectedBatchId = batchId
    || selectedTask?.batchId
    || batches.find((batch) => ACTIVE_BATCH_STATES.has(batch.status))?.id
    || batches[0]?.id
    || null;
  const batch = selectedBatchId
    ? batches.find((item) => item.id === selectedBatchId)
      || repository.getBatchRun(selectedBatchId)
    : null;
  const task = selectedTask?.batchId === selectedBatchId
    ? selectedTask
    : tasks.find((item) => item.batchId === selectedBatchId) || null;
  const items = selectedBatchId ? repository.listBatchItems(selectedBatchId) : [];
  const worker = repository.listWorkerInstances()
    .find((item) => item.batchId === selectedBatchId) || null;
  const companies = repository.listCompanies();
  const companiesById = new Map(companies.map((company) => [company.id, company]));
  const scopedCompanyIds = new Set(items
    .flatMap((item) => [item?.input?.id, item?.input?.companyId, item?.itemKey])
    .filter((id) => companiesById.has(id)));
  const scopeEnabled = scopedCompanyIds.size > 0;
  const scopedCompanies = scopeEnabled
    ? companies.filter((company) => scopedCompanyIds.has(company.id))
    : companies;
  const portals = repository.listCareerPortals()
    .filter((portal) => !scopeEnabled || scopedCompanyIds.has(portal.companyId));
  const events = repository.listRecruitmentEvents()
    .filter((event) => !scopeEnabled || scopedCompanyIds.has(event.companyId));
  const jobs = repository.listJobOpenings()
    .filter((job) => !scopeEnabled || scopedCompanyIds.has(job.companyId));
  const activePortals = portals.filter((portal) => !portal.supersededByPortalId);
  const candidatePortalCompanies = new Set(activePortals.map((portal) => portal.companyId).filter(Boolean));
  const verifiedEntryCompanies = new Set(activePortals
    .filter((portal) => portal.verificationStatus === 'VERIFIED')
    .map((portal) => portal.companyId)
    .filter(Boolean));
  const openHiringCompanies = new Set(activePortals
    .filter((portal) => portal.hiringAvailability === 'OPENINGS_FOUND')
    .map((portal) => portal.companyId)
    .filter(Boolean));
  const jobExtractedCompanies = new Set(jobs.map((job) => job.companyId).filter(Boolean));
  const publishedCompanies = new Set(jobs
    .filter((job) => job.publicationStatus === 'PUBLISHED')
    .map((job) => job.companyId)
    .filter(Boolean));

  const itemCounts = countBy(items, (item) => item.status);
  const resultCounts = countBy(
    items.filter((item) => item.resultStatus),
    (item) => item.resultStatus,
  );
  const succeeded = itemCounts.SUCCEEDED || 0;
  const failed = itemCounts.FAILED || 0;
  const deferred = itemCounts.DEFERRED || 0;
  const running = itemCounts.RUNNING || 0;
  const pendingMaterialized = itemCounts.PENDING || 0;
  const attempted = succeeded + failed + deferred;
  const processed = succeeded;
  const target = Math.max(Number(task?.targetCount) || 0, items.length);
  const notMaterialized = Math.max(0, target - items.length);
  const remaining = Math.max(0, target - processed);
  const progressPercent = target > 0
    ? Number(Math.min(100, (processed / target) * 100).toFixed(2))
    : 0;

  const heartbeatMs = Date.parse(worker?.heartbeatAt || '');
  const nowMs = Date.parse(now);
  const heartbeatAgeSeconds = Number.isFinite(heartbeatMs)
    ? Math.max(0, Math.round((nowMs - heartbeatMs) / 1000))
    : null;
  const workerHealth = !worker
    ? 'NOT_STARTED'
    : TERMINAL_WORKER_STATES.has(worker.state)
      ? worker.state
      : heartbeatAgeSeconds != null && heartbeatAgeSeconds > staleHeartbeatSeconds
        ? 'STALE'
        : 'HEALTHY';
  const currentItem = items.find((item) => item.status === 'RUNNING')
    || items.find((item) => itemMatchesCompany(item, worker?.currentCompanyId))
    || null;
  const lastCompletedItem = items
    .find((item) => itemMatchesCompany(item, worker?.lastCompletedCompanyId))
    || [...items]
      .filter((item) => item.completedAt)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0]
    || null;

  const failureGroups = new Map();
  const failedItems = items.filter((item) => ['FAILED', 'DEFERRED'].includes(item.status));
  for (const item of failedItems) {
    const reason = item.errorMessage
      || item.deferReason
      || item.retryClass
      || item.resultStatus
      || 'UNKNOWN';
    failureGroups.set(reason, (failureGroups.get(reason) || 0) + 1);
  }
  const failureReasons = [...failureGroups.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
  const recentFailures = [...failedItems]
    .sort((left, right) => String(right.completedAt || right.startedAt || '')
      .localeCompare(String(left.completedAt || left.startedAt || '')))
    .slice(0, 10)
    .map((item) => ({
      company: companyName(item, companiesById),
      status: item.status,
      reason: item.errorMessage || item.deferReason || item.retryClass || item.resultStatus,
      attemptCount: item.attemptCount,
      completedAt: item.completedAt,
    }));
  const timing = durationMetrics({
    startedAt: batch?.startedAt || task?.createdAt,
    resumedAt: batch?.resumedAt,
    items,
    processed,
    remaining,
    now,
  });
  const updatedAt = [
    task?.updatedAt,
    batch?.completedAt,
    batch?.startedAt,
    worker?.heartbeatAt,
    ...items.map((item) => item.completedAt || item.startedAt),
  ].filter(Boolean).sort().at(-1) || null;

  return Object.freeze({
    status: batch ? 'OK' : 'NOT_CONFIGURED',
    generatedAt: now,
    task: task ? {
      id: task.id,
      batchId: task.batchId,
      state: task.state,
      roleKeywords: task.roleKeywords,
      targetCount: task.targetCount,
      dateFrom: task.absoluteDateFrom,
      dateTo: task.absoluteDateTo,
    } : null,
    batch,
    progress: {
      target,
      materialized: items.length,
      processed,
      attempted,
      succeeded,
      failed,
      deferred,
      running,
      pendingMaterialized,
      notMaterialized,
      remaining,
      percent: progressPercent,
      resultCounts,
    },
    worker: worker ? {
      instanceId: worker.instanceId,
      pid: worker.pid,
      state: worker.state,
      health: workerHealth,
      heartbeatAt: worker.heartbeatAt,
      heartbeatAgeSeconds,
      currentCompany: companyName(currentItem, companiesById)
        || companiesById.get(worker.currentCompanyId)?.canonicalName
        || null,
      lastCompletedCompany: companyName(lastCompletedItem, companiesById)
        || companiesById.get(worker.lastCompletedCompanyId)?.canonicalName
        || null,
      lastError: worker.lastError,
    } : null,
    quality: {
      companies: scopedCompanies.length,
      registeredCompanies: scopedCompanies.length,
      candidatePortalCompanies: candidatePortalCompanies.size,
      verifiedEntryCompanies: verifiedEntryCompanies.size,
      openHiringCompanies: openHiringCompanies.size,
      jobExtractedCompanies: jobExtractedCompanies.size,
      publishedCompanies: publishedCompanies.size,
      verifiedPortals: activePortals.filter((portal) => portal.verificationStatus === 'VERIFIED').length,
      recruitmentEvents: events.length,
      jobOpenings: jobs.length,
    },
    timing,
    failureReasons,
    recentFailures,
    circuits: repository.listProviderCircuitStates(),
    updatedAt,
  });
}
