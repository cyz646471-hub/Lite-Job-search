import { createHash } from 'node:crypto';

const FAILURE_STATUSES = new Set([
  'FAILED',
  'NOT_CONFIGURED',
  'BLOCKED',
  'DEFERRED_BY_BUDGET',
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function boundedError(error) {
  return String(error?.message || error || 'unknown error').slice(0, 240);
}

export async function runDiscoveryBatch({
  batchId,
  items = [],
  inputHash = null,
  retryFailed = false,
  retryDeferred = false,
  stopOnResultStatuses = [],
  maxItemsPerRun = Number.POSITIVE_INFINITY,
  pauseBeforeRun = false,
  pauseOnBlocked = true,
} = {}, {
  repository,
  runItem,
  shouldDeferItem = null,
  shouldStop = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!batchId || !Array.isArray(items) || !items.length) {
    throw new Error('batchId and at least one item are required');
  }
  if (!repository || typeof runItem !== 'function') {
    throw new Error('batch repository and runItem are required');
  }
  const itemKeys = items.map((input) => String(input.id || hash(input)));
  if (new Set(itemKeys).size !== itemKeys.length) {
    throw new Error('duplicate batch item key');
  }
  repository.beginBatch({
    id: batchId,
    inputHash: inputHash || hash(items),
    startedAt: now(),
  });
  const stopStatuses = new Set(stopOnResultStatuses.map(String));
  const itemBudget = Number.isFinite(Number(maxItemsPerRun))
    ? Math.max(1, Math.trunc(Number(maxItemsPerRun)))
    : Number.POSITIVE_INFINITY;
  const initialCheckpoints = items.map((input, position) => repository.ensureBatchItem({
    batchId,
    itemKey: itemKeys[position],
    position,
    input,
    createdAt: now(),
  }));
  let attempted = 0;
  let paused = pauseBeforeRun === true;
  let stopRequested = false;

  for (const [position, input] of items.entries()) {
    if (paused) break;
    const itemKey = itemKeys[position];
    const checkpoint = initialCheckpoints[position];
    if (checkpoint.status === 'SUCCEEDED') continue;
    if (checkpoint.status === 'FAILED' && !retryFailed) continue;
    if (checkpoint.status === 'DEFERRED' && !retryDeferred) continue;
    if (typeof shouldStop === 'function' && await shouldStop({
      batchId,
      itemKey,
      position,
      input,
    })) {
      stopRequested = true;
      paused = true;
      break;
    }
    if (typeof shouldDeferItem === 'function') {
      const deferral = await shouldDeferItem(input, {
        batchId,
        itemKey,
        position,
      });
      if (deferral) {
        repository.deferBatchItem({
          batchId,
          itemKey,
          resultStatus: deferral.resultStatus || 'DEFERRED',
          retryClass: deferral.retryClass || 'PROVIDER_BLOCKED',
          deferReason: deferral.deferReason || 'SEARCH_ENGINE_OPEN',
          deferredUntil: deferral.deferredUntil || null,
          errorMessage: boundedError(deferral.reason || deferral.deferReason),
          completedAt: now(),
        });
        continue;
      }
    }
    if (attempted >= itemBudget) {
      paused = true;
      break;
    }

    attempted += 1;
    repository.startBatchItem({ batchId, itemKey, startedAt: now() });
    try {
      const result = await runItem(input, { batchId, itemKey, position });
      const resultStatus = result?.status || 'FAILED';
      if (resultStatus === 'BLOCKED') {
        repository.deferBatchItem({
          batchId,
          itemKey,
          resultStatus,
          retryClass: 'PROVIDER_BLOCKED',
          deferReason: result?.deferReason || 'SEARCH_ENGINE_OPEN',
          deferredUntil: null,
          errorMessage: boundedError(result?.reason || resultStatus),
          completedAt: now(),
        });
        if (pauseOnBlocked) {
          paused = true;
          break;
        }
        continue;
      }
      const failed = FAILURE_STATUSES.has(resultStatus);
      repository.completeBatchItem({
        batchId,
        itemKey,
        status: failed ? 'FAILED' : 'SUCCEEDED',
        resultStatus,
        discoveryRunId: result?.runId || null,
        errorMessage: failed ? boundedError(result?.reason || resultStatus) : null,
        completedAt: now(),
      });
      if (stopStatuses.has(resultStatus)) {
        paused = true;
        break;
      }
    } catch (error) {
      repository.completeBatchItem({
        batchId,
        itemKey,
        status: 'FAILED',
        resultStatus: 'FAILED',
        discoveryRunId: null,
        errorMessage: boundedError(error),
        completedAt: now(),
      });
    }
  }

  const checkpoints = repository.listBatchItems(batchId);
  const succeeded = checkpoints.filter((item) => item.status === 'SUCCEEDED').length;
  const failed = checkpoints.filter((item) => item.status === 'FAILED').length;
  const deferred = checkpoints.filter((item) => item.status === 'DEFERRED').length;
  const pending = checkpoints.filter((item) => (
    ['PENDING', 'RUNNING'].includes(item.status)
  )).length;
  const status = stopRequested
    ? 'STOPPED'
    : paused && (pending + deferred) > 0
    ? 'PAUSED'
    : failed > 0
    ? 'COMPLETE_WITH_ERRORS'
    : deferred > 0
      ? 'PAUSED'
    : pending > 0
      ? 'PARTIAL'
      : 'COMPLETE';
  repository.completeBatch({ id: batchId, status, completedAt: now() });
  return Object.freeze({
    batchId,
    status,
    total: checkpoints.length,
    succeeded,
    failed,
    deferred,
    pending,
    stopRequested,
    items: Object.freeze(checkpoints),
  });
}
