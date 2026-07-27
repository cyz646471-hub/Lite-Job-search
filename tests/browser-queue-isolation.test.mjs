import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BROWSER_QUEUE_TYPES,
  runBrowserCompanyBatch,
} from '../src/application/run-browser-company-batch.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

test('Baidu challenge defers only Baidu tasks while direct verification continues', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ljs-queue-isolation-'));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  repository.migrate();
  t.after(() => {
    repository.close();
    return rm(directory, { recursive: true, force: true });
  });
  const calls = [];
  const batch = await runBrowserCompanyBatch({
    batchId: 'queue-isolation',
    provider: 'baidu',
    companies: [{
      id: 'baidu-blocked',
      company: '百度任务一',
      queueType: BROWSER_QUEUE_TYPES.BAIDU,
    }, {
      id: 'baidu-deferred',
      company: '百度任务二',
      queueType: BROWSER_QUEUE_TYPES.BAIDU,
    }, {
      id: 'direct-continues',
      company: '直接官网任务',
      queueType: BROWSER_QUEUE_TYPES.LOCAL,
    }],
  }, {
    repository,
    now: () => '2026-07-27T00:00:00.000Z',
    discoverCompany: async (company) => {
      calls.push(company.id);
      if (company.id === 'baidu-blocked') {
        return { status: 'BLOCKED', reasonCode: 'CAPTCHA_REQUIRED' };
      }
      return { status: 'COMPLETED', officialCandidates: [], observations: [] };
    },
    ingestCompany: async () => ({ status: 'PARTIAL', runId: 'direct-run' }),
  });
  assert.deepEqual(calls, ['baidu-blocked', 'direct-continues']);
  assert.equal(batch.succeeded, 1);
  assert.equal(batch.deferred, 2);
  assert.equal(batch.status, 'PAUSED');
  assert.equal(repository.getProviderCircuitState('baidu').state, 'OPEN');
});
