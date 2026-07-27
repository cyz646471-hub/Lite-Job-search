import { createHash, randomUUID } from 'node:crypto';
import { normalizePublicSearchEngine } from '../adapters/browser/public-search-page-adapter.mjs';

const SELECTION_MODES = new Set([
  'NEW_COMPANIES_ONLY',
  'RECHECK_EXISTING_AND_NEW',
  'STALE_OR_UNVERIFIED_ONLY',
]);
const TARGET_UNITS = new Set([
  'COMPANIES_PROCESSED',
  'COMPANIES_WITH_VERIFIED_PORTAL',
  'COMPANIES_WITH_MATCHING_JOBS',
]);

function isoDate(value, field) {
  const normalized = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
  return normalized;
}

function taskHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function validateControlTask(input = {}) {
  const roleKeywords = Array.isArray(input.role_keywords)
    ? input.role_keywords.map(String).map((value) => value.trim()).filter(Boolean)
    : String(input.role_keywords || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!roleKeywords.length) throw new Error('role_keywords is required');
  const absoluteDateFrom = isoDate(input.absolute_date_from, 'absolute_date_from');
  const absoluteDateTo = isoDate(input.absolute_date_to, 'absolute_date_to');
  if (absoluteDateFrom > absoluteDateTo) {
    throw new Error('absolute_date_from must not be after absolute_date_to');
  }
  const targetCount = Number(input.target_count);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 10_000) {
    throw new Error('target_count must be an integer from 1 to 10000');
  }
  const selectionMode = String(input.selection_mode || '');
  const targetUnit = String(input.target_unit || '');
  if (!SELECTION_MODES.has(selectionMode)) throw new Error('invalid selection_mode');
  if (!TARGET_UNITS.has(targetUnit)) throw new Error('invalid target_unit');
  return Object.freeze({
    location: String(input.location || '').trim() || null,
    roleKeywords: Object.freeze(roleKeywords),
    industry: String(input.industry || '').trim() || null,
    absoluteDateFrom,
    absoluteDateTo,
    targetCount,
    selectionMode,
    targetUnit,
    allowBaiduFallback: input.allow_baidu_fallback === true,
  });
}

export function createControlPlaneService({
  repository,
  now = () => new Date().toISOString(),
  actor = 'local-user',
} = {}) {
  if (!repository) throw new Error('repository is required');
  const audit = (action, targetType, targetId, details = {}) => repository.appendAuditLog({
    id: randomUUID(),
    action,
    targetType,
    targetId,
    actor,
    details,
    createdAt: now(),
  });
  const acknowledgeSearchProvider = (provider) => {
    const normalizedProvider = normalizePublicSearchEngine(provider);
    const acknowledgedAt = now();
    const circuit = repository.acknowledgeProviderCircuit({
      provider: normalizedProvider,
      acknowledgedAt,
    });
    audit('SEARCH_PROVIDER_MANUAL_VERIFICATION_ACKNOWLEDGED', 'PROVIDER', normalizedProvider, {
      acknowledgedAt,
    });
    return circuit;
  };

  return Object.freeze({
    createTask(input) {
      const task = validateControlTask(input);
      const id = `task-${randomUUID()}`;
      const batchId = `batch-${id.slice(5)}`;
      const createdAt = now();
      repository.beginBatch({
        id: batchId,
        inputHash: `UNMATERIALIZED:${taskHash(task)}`,
        status: 'PENDING',
        startedAt: createdAt,
      });
      const created = repository.createControlTask({
        id,
        batchId,
        ...task,
        state: 'PENDING',
        createdAt,
        updatedAt: createdAt,
      });
      audit('TASK_CREATED', 'TASK', id, task);
      return created;
    },
    status() {
      return {
        tasks: repository.listControlTasks(),
        batches: repository.listBatchRuns(),
        workers: repository.listWorkerInstances(),
        circuits: repository.listProviderCircuitStates(),
        deferredItems: repository.listDeferredBatchItems(),
        reviewTasks: typeof repository.listReviewTasks === 'function'
          ? repository.listReviewTasks({ status: 'OPEN' })
          : [],
      };
    },
    stopBatch(batchId) {
      const requestedAt = now();
      const batch = repository.requestBatchStop({ batchId, requestedAt });
      const workers = repository.listWorkerInstances().filter((worker) => (
        worker.batchId === batchId && !['EXITED', 'CRASHED'].includes(worker.state)
      ));
      for (const worker of workers) {
        repository.requestWorkerStop({ instanceId: worker.instanceId, requestedAt });
      }
      audit('BATCH_STOP_REQUESTED', 'BATCH', batchId, {
        workerIds: workers.map((worker) => worker.instanceId),
      });
      return batch;
    },
    resumeBatch(batchId) {
      const resumedAt = now();
      const batch = repository.resumeBatch({ batchId, resumedAt });
      audit('BATCH_RESUMED', 'BATCH', batchId);
      return batch;
    },
    acknowledgeSearchProvider,
    acknowledgeBaidu() {
      return acknowledgeSearchProvider('baidu');
    },
    createReviewTask(input) {
      const createdAt = now();
      const task = repository.upsertReviewTask({
        ...input,
        createdAt,
        updatedAt: createdAt,
      });
      audit('REVIEW_TASK_CREATED', 'REVIEW_TASK', task.id, {
        reviewType: task.reviewType,
        targetType: task.targetType,
        targetId: task.targetId,
      });
      return task;
    },
    resolveReviewTask(id, input = {}) {
      const existing = repository.listReviewTasks().find((task) => task.id === id);
      if (!existing) throw new Error(`unknown ReviewTask: ${id}`);
      const reviewedAt = now();
      const task = repository.upsertReviewTask({
        ...existing,
        ...input,
        id,
        status: input.status || 'RESOLVED',
        reviewer: input.reviewer || actor,
        updatedAt: reviewedAt,
        reviewedAt,
      });
      audit('REVIEW_TASK_RESOLVED', 'REVIEW_TASK', id, {
        status: task.status,
        result: task.result,
      });
      return task;
    },
    assignJob(input) {
      const timestamp = now();
      const assignment = repository.upsertJobAssignment({
        ...input,
        assignedBy: input.assignedBy || actor,
        assignedAt: input.assignedAt || timestamp,
        updatedAt: timestamp,
      });
      audit('JOB_ASSIGNED', 'JOB_OPENING', assignment.jobId, {
        assignmentId: assignment.id,
        assigneeType: assignment.assigneeType,
        assigneeId: assignment.assigneeId,
      });
      return assignment;
    },
    recordUserAction(input) {
      const action = repository.appendUserAction({
        ...input,
        actorId: input.actorId || actor,
        createdAt: input.createdAt || now(),
      });
      audit('USER_ACTION_RECORDED', action.jobId ? 'JOB_OPENING' : 'USER', action.jobId || action.actorId, {
        userActionId: action.id,
        actionType: action.actionType,
        triggersReverification: action.triggersReverification,
      });
      return action;
    },
  });
}
