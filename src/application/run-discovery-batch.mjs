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
  retryFailed = false,
} = {}, {
  repository,
  runItem,
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
    inputHash: hash(items),
    startedAt: now(),
  });

  for (const [position, input] of items.entries()) {
    const itemKey = itemKeys[position];
    const checkpoint = repository.ensureBatchItem({
      batchId,
      itemKey,
      position,
      input,
      createdAt: now(),
    });
    if (checkpoint.status === 'SUCCEEDED') continue;
    if (checkpoint.status === 'FAILED' && !retryFailed) continue;

    repository.startBatchItem({ batchId, itemKey, startedAt: now() });
    try {
      const result = await runItem(input, { batchId, itemKey, position });
      const failed = FAILURE_STATUSES.has(result?.status);
      repository.completeBatchItem({
        batchId,
        itemKey,
        status: failed ? 'FAILED' : 'SUCCEEDED',
        resultStatus: result?.status || 'FAILED',
        discoveryRunId: result?.runId || null,
        errorMessage: failed ? boundedError(result?.reason || result?.status) : null,
        completedAt: now(),
      });
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
  const pending = checkpoints.length - succeeded - failed;
  const status = failed > 0
    ? 'COMPLETE_WITH_ERRORS'
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
    pending,
    items: Object.freeze(checkpoints),
  });
}
