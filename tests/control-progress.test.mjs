import assert from 'node:assert/strict';
import test from 'node:test';

import { buildControlProgress } from '../src/application/build-control-progress.mjs';

function repository() {
  return {
    listControlTasks: () => [{
      id: 'task-1',
      batchId: 'batch-1',
      state: 'RUNNING',
      roleKeywords: ['公开招聘岗位'],
      targetCount: 100,
      absoluteDateFrom: '2026-04-29',
      absoluteDateTo: '2026-07-28',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:10:00.000Z',
    }],
    listBatchRuns: () => [{
      id: 'batch-1',
      status: 'RUNNING',
      startedAt: '2026-07-28T00:00:00.000Z',
      completedAt: null,
    }],
    getBatchRun: () => null,
    listBatchItems: () => [
      {
        batchId: 'batch-1',
        itemKey: 'company-a',
        input: { id: 'company-a', company: '甲公司' },
        status: 'SUCCEEDED',
        resultStatus: 'PARTIAL',
        attemptCount: 1,
        completedAt: '2026-07-28T00:03:00.000Z',
      },
      {
        batchId: 'batch-1',
        itemKey: 'company-b',
        input: { id: 'company-b', company: '乙公司' },
        status: 'FAILED',
        resultStatus: 'FAILED',
        errorMessage: 'candidate_page_blocked',
        attemptCount: 2,
        completedAt: '2026-07-28T00:04:00.000Z',
      },
      {
        batchId: 'batch-1',
        itemKey: 'company-c',
        input: { id: 'company-c', company: '丙公司' },
        status: 'RUNNING',
        resultStatus: null,
        attemptCount: 1,
        startedAt: '2026-07-28T00:05:00.000Z',
      },
      {
        batchId: 'batch-1',
        itemKey: 'company-d',
        input: { id: 'company-d', company: '丁公司' },
        status: 'PENDING',
        resultStatus: null,
        attemptCount: 0,
      },
    ],
    listWorkerInstances: () => [{
      instanceId: 'worker-1',
      batchId: 'batch-1',
      pid: 123,
      state: 'RUNNING',
      heartbeatAt: '2026-07-28T00:09:50.000Z',
      currentCompanyId: 'company-c',
      lastCompletedCompanyId: 'company-b',
      lastError: null,
    }],
    listCompanies: () => [
      { id: 'company-a', canonicalName: '甲公司' },
      { id: 'company-b', canonicalName: '乙公司' },
      { id: 'company-c', canonicalName: '丙公司' },
      { id: 'company-d', canonicalName: '丁公司' },
    ],
    listCareerPortals: () => [
      { verificationStatus: 'VERIFIED' },
      { verificationStatus: 'PENDING_REVIEW' },
    ],
    listRecruitmentEvents: () => [{ id: 'event-1' }],
    listJobOpenings: () => [{ id: 'job-1' }, { id: 'job-2' }],
    listProviderCircuitStates: () => [],
  };
}

test('progress snapshot includes unmaterialized companies and live worker context', () => {
  const progress = buildControlProgress({
    repository: repository(),
    now: '2026-07-28T00:10:00.000Z',
  });
  assert.equal(progress.progress.target, 100);
  assert.equal(progress.progress.materialized, 4);
  assert.equal(progress.progress.processed, 2);
  assert.equal(progress.progress.remaining, 98);
  assert.equal(progress.progress.notMaterialized, 96);
  assert.equal(progress.progress.percent, 2);
  assert.equal(progress.worker.health, 'HEALTHY');
  assert.equal(progress.worker.currentCompany, '丙公司');
  assert.equal(progress.worker.lastCompletedCompany, '乙公司');
  assert.equal(progress.failureReasons[0].reason, 'candidate_page_blocked');
  assert.equal(progress.quality.verifiedPortals, 1);
  assert.equal(progress.quality.jobOpenings, 2);
});

test('progress snapshot marks a running worker with an expired heartbeat as stale', () => {
  const progress = buildControlProgress({
    repository: repository(),
    now: '2026-07-28T00:12:00.000Z',
    staleHeartbeatSeconds: 60,
  });
  assert.equal(progress.worker.health, 'STALE');
  assert.equal(progress.worker.heartbeatAgeSeconds, 130);
});

test('progress timing uses completions since the latest resume instead of stale lifetime counts', () => {
  const source = repository();
  const progress = buildControlProgress({
    repository: {
      ...source,
      listBatchRuns: () => [{
        ...source.listBatchRuns()[0],
        resumedAt: '2026-07-28T00:08:00.000Z',
      }],
      listBatchItems: () => [
        {
          batchId: 'batch-1',
          itemKey: 'company-old',
          input: { company: '旧完成公司' },
          status: 'SUCCEEDED',
          resultStatus: 'PARTIAL',
          completedAt: '2026-07-28T00:03:00.000Z',
        },
        {
          batchId: 'batch-1',
          itemKey: 'company-new',
          input: { company: '新完成公司' },
          status: 'SUCCEEDED',
          resultStatus: 'PARTIAL',
          completedAt: '2026-07-28T00:09:00.000Z',
        },
      ],
    },
    now: '2026-07-28T00:10:00.000Z',
  });
  assert.equal(progress.timing.completedInWindow, 1);
  assert.equal(progress.timing.windowStartedAt, '2026-07-28T00:08:00.000Z');
  assert.equal(progress.timing.elapsedSeconds, 120);
  assert.equal(progress.timing.companiesPerHour, 30);
});

test('progress snapshot prefers the newest terminal task over an older stop request', () => {
  const source = repository();
  const progress = buildControlProgress({
    repository: {
      ...source,
      listControlTasks: () => [
        {
          ...source.listControlTasks()[0],
          id: 'task-latest',
          batchId: 'batch-latest',
          state: 'FAILED',
        },
        {
          ...source.listControlTasks()[0],
          id: 'task-old',
          batchId: 'batch-old',
          state: 'STOP_REQUESTED',
        },
      ],
      listBatchRuns: () => [{
        ...source.listBatchRuns()[0],
        id: 'batch-latest',
        status: 'COMPLETE_WITH_ERRORS',
      }],
      listBatchItems: () => [],
      listWorkerInstances: () => [],
    },
  });
  assert.equal(progress.task.id, 'task-latest');
});
