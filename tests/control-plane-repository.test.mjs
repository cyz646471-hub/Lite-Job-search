import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createControlPlaneService } from '../src/application/control-plane-service.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const NOW = '2026-07-27T00:00:00.000Z';

async function repositoryFor(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ljs-control-repo-'));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  repository.migrate();
  t.after(() => {
    repository.close();
    return rm(directory, { recursive: true, force: true });
  });
  return repository;
}

test('worker heartbeat and stop target only the requested batch', async (t) => {
  const repository = await repositoryFor(t);
  repository.beginBatch({ id: 'batch-a', inputHash: 'a', status: 'PENDING', startedAt: NOW });
  repository.beginBatch({ id: 'batch-b', inputHash: 'b', status: 'PENDING', startedAt: NOW });
  for (const [instanceId, batchId] of [['worker-a', 'batch-a'], ['worker-b', 'batch-b']]) {
    repository.registerWorker({
      instanceId,
      batchId,
      profileKey: instanceId,
      hostName: 'host',
      pid: 1,
      processStartToken: instanceId,
      state: 'RUNNING',
      startedAt: NOW,
      heartbeatAt: NOW,
    });
  }
  repository.requestBatchStop({ batchId: 'batch-a', requestedAt: NOW });
  repository.requestWorkerStop({ instanceId: 'worker-a', requestedAt: NOW });
  assert.equal(repository.isBatchStopRequested('batch-a'), true);
  assert.equal(repository.isBatchStopRequested('batch-b'), false);
  assert.equal(repository.getWorkerInstance('worker-a').state, 'STOP_REQUESTED');
  assert.equal(repository.getWorkerInstance('worker-b').state, 'RUNNING');
});

test('only one worker acquires the HALF_OPEN probe lease', async (t) => {
  const repository = await repositoryFor(t);
  repository.saveProviderCircuitState({
    provider: 'baidu',
    state: 'OPEN',
    reasonCode: 'CAPTCHA_REQUIRED',
    openedAt: NOW,
    manualActionRequired: true,
    updatedAt: NOW,
  });
  repository.acknowledgeProviderCircuit({
    provider: 'baidu',
    acknowledgedAt: '2026-07-27T00:01:00.000Z',
  });
  const leases = ['worker-a', 'worker-b'].map((ownerId) => repository.acquireProviderProbeLease({
    provider: 'baidu',
    ownerId,
    acquiredAt: '2026-07-27T00:02:00.000Z',
    leaseUntil: '2026-07-27T00:03:00.000Z',
  }));
  assert.equal(leases.filter(Boolean).length, 1);
  assert.equal(repository.getProviderCircuitState('baidu').state, 'HALF_OPEN');
});

test('challenge and transient cache outcomes are never reusable as no results', async (t) => {
  const repository = await repositoryFor(t);
  for (const outcome of ['CHALLENGE', 'TRANSIENT_ERROR']) {
    repository.putSearchCache({
      cacheKey: outcome,
      engine: 'baidu',
      normalizedQuery: '公司 招聘',
      locale: 'zh-CN',
      strategyVersion: 'v1',
      outcome,
      result: { candidates: [] },
      createdAt: NOW,
    });
    assert.equal(repository.getReusableSearchCache(outcome, NOW), null);
  }
  repository.putSearchCache({
    cacheKey: 'success',
    engine: 'baidu',
    normalizedQuery: '公司 招聘',
    locale: 'zh-CN',
    strategyVersion: 'v1',
    outcome: 'SUCCESS',
    result: { candidates: ['https://example.com/careers'] },
    createdAt: NOW,
  });
  assert.deepEqual(repository.getReusableSearchCache('success', NOW).result.candidates, [
    'https://example.com/careers',
  ]);
});

test('control service creates structured tasks and audits stop and resume', async (t) => {
  const repository = await repositoryFor(t);
  let tick = 0;
  const service = createControlPlaneService({
    repository,
    now: () => `2026-07-27T00:00:0${tick++}.000Z`,
  });
  const task = service.createTask({
    location: '中国大陆',
    role_keywords: ['AI产品经理'],
    industry: 'AI',
    absolute_date_from: '2026-04-27',
    absolute_date_to: '2026-07-27',
    target_count: 20,
    selection_mode: 'STALE_OR_UNVERIFIED_ONLY',
    target_unit: 'COMPANIES_WITH_MATCHING_JOBS',
    allow_baidu_fallback: true,
  });
  assert.equal(repository.getBatchRun(task.batchId).status, 'PENDING');
  service.stopBatch(task.batchId);
  assert.equal(repository.getBatchRun(task.batchId).status, 'STOP_REQUESTED');
  service.resumeBatch(task.batchId);
  assert.equal(repository.getBatchRun(task.batchId).status, 'PENDING');
  assert.deepEqual(
    repository.listAuditLogs().map((item) => item.action),
    ['BATCH_RESUMED', 'BATCH_STOP_REQUESTED', 'TASK_CREATED'],
  );
});

test('control service acknowledges a Google challenge without switching engines', async (t) => {
  const repository = await repositoryFor(t);
  repository.saveProviderCircuitState({
    provider: 'google',
    state: 'OPEN',
    reasonCode: 'search_challenge_or_access_blocked',
    openedAt: NOW,
    manualActionRequired: true,
    updatedAt: NOW,
  });
  const service = createControlPlaneService({
    repository,
    now: () => '2026-07-27T00:01:00.000Z',
  });
  const result = service.acknowledgeSearchProvider('google');
  assert.equal(result.provider, 'google');
  assert.equal(result.state, 'OPEN');
  assert.equal(result.manualAcknowledgedAt, '2026-07-27T00:01:00.000Z');
  assert.equal(repository.getProviderCircuitState('baidu'), null);
});
