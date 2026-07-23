import assert from 'node:assert/strict';
import test from 'node:test';

import { runDiscoveryBatch } from '../src/application/run-discovery-batch.mjs';

function memoryCheckpointRepository() {
  const items = new Map();
  return {
    beginBatch: (batch) => batch,
    ensureBatchItem(item) {
      if (!items.has(item.itemKey)) items.set(item.itemKey, { ...item, status: 'PENDING', attemptCount: 0 });
      return items.get(item.itemKey);
    },
    startBatchItem({ itemKey }) {
      const item = items.get(itemKey);
      Object.assign(item, { status: 'RUNNING', attemptCount: item.attemptCount + 1 });
    },
    completeBatchItem({ itemKey, ...updates }) {
      Object.assign(items.get(itemKey), updates);
    },
    listBatchItems: () => [...items.values()],
    completeBatch: (batch) => batch,
  };
}

test('batch isolates item failures and continues later items', async () => {
  const repository = memoryCheckpointRepository();
  const calls = [];
  const report = await runDiscoveryBatch({
    batchId: 'batch-1',
    items: [
      { role: 'AI产品经理' },
      { role: '3C产品经理' },
      { role: '后端开发' },
    ],
  }, {
    repository,
    runItem: async (item) => {
      calls.push(item.role);
      if (item.role === '3C产品经理') throw new Error('fixture provider failure');
      return { status: 'PARTIAL', runId: `run-${calls.length}`, jobsStored: 1 };
    },
    now: () => '2026-07-24T00:00:00.000Z',
  });

  assert.deepEqual(calls, ['AI产品经理', '3C产品经理', '后端开发']);
  assert.equal(report.status, 'COMPLETE_WITH_ERRORS');
  assert.equal(report.succeeded, 2);
  assert.equal(report.failed, 1);
});

test('batch resume skips succeeded items and retries failed only when requested', async () => {
  const repository = memoryCheckpointRepository();
  let attempts = 0;
  const input = {
    batchId: 'batch-resume',
    items: [{ role: 'AI产品经理' }, { role: '后端开发' }],
  };
  await runDiscoveryBatch(input, {
    repository,
    runItem: async (item) => {
      attempts += 1;
      if (item.role === '后端开发') throw new Error('temporary');
      return { status: 'PARTIAL', runId: 'run-success' };
    },
  });
  await runDiscoveryBatch(input, {
    repository,
    runItem: async () => {
      attempts += 1;
      return { status: 'COMPLETE', runId: 'unexpected' };
    },
  });
  assert.equal(attempts, 2);

  await runDiscoveryBatch({ ...input, retryFailed: true }, {
    repository,
    runItem: async () => {
      attempts += 1;
      return { status: 'COMPLETE', runId: 'run-retry' };
    },
  });
  assert.equal(attempts, 3);
});

test('batch rejects duplicate stable item ids', async () => {
  await assert.rejects(
    runDiscoveryBatch({
      batchId: 'batch-duplicate',
      items: [{ id: 'same', role: 'A' }, { id: 'same', role: 'B' }],
    }, {
      repository: memoryCheckpointRepository(),
      runItem: async () => ({ status: 'COMPLETE' }),
    }),
    /duplicate batch item key/,
  );
});
