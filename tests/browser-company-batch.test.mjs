import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runBrowserCompanyBatch } from '../src/application/run-browser-company-batch.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

async function createRepository(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-browser-batch-'));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  repository.migrate();
  t.after(() => repository.close());
  return repository;
}

test('writes each company before starting the next and resumes succeeded items', async (t) => {
  const repository = await createRepository(t);
  const events = [];
  const input = {
    batchId: 'browser-2026-07-25',
    companies: [{ company: '甲公司' }, { company: '乙公司' }],
  };
  let failSecond = true;
  const dependencies = {
    repository,
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 6, 25, 0, 0, tick++)).toISOString();
    })(),
    discoverCompany: async (company) => {
      events.push(`search:${company.company}`);
      if (company.company === '乙公司' && failSecond) throw new Error('network failed');
      return {
        company: company.company,
        query: `${company.company} 招聘`,
        status: 'COMPLETED',
        officialCandidates: [],
        observations: [],
      };
    },
    ingestCompany: async ({ companyResult }) => {
      events.push(`stored:${companyResult.company}`);
      return { status: 'COMPLETE', runId: `run-${companyResult.company}` };
    },
  };

  const first = await runBrowserCompanyBatch(input, dependencies);

  assert.deepEqual(events.slice(0, 2), ['search:甲公司', 'stored:甲公司']);
  assert.equal(first.status, 'COMPLETE_WITH_ERRORS');
  assert.equal(first.succeeded, 1);
  assert.equal(first.failed, 1);

  events.length = 0;
  await runBrowserCompanyBatch(input, dependencies);
  assert.deepEqual(events, []);

  failSecond = false;
  const retried = await runBrowserCompanyBatch({
    ...input,
    retryFailed: true,
  }, dependencies);
  assert.deepEqual(events, ['search:乙公司', 'stored:乙公司']);
  assert.equal(retried.status, 'COMPLETE');
  assert.equal(retried.succeeded, 2);
});

test('blocked browser search is checkpointed without ingestion', async (t) => {
  const repository = await createRepository(t);
  let ingested = false;

  const result = await runBrowserCompanyBatch({
    batchId: 'browser-blocked',
    companies: [{ company: '受限公司' }],
  }, {
    repository,
    discoverCompany: async (company) => ({
      company: company.company,
      query: `${company.company} 招聘`,
      status: 'BLOCKED',
      reasonCode: 'search_challenge_or_access_blocked',
      officialCandidates: [],
      observations: [],
    }),
    ingestCompany: async () => {
      ingested = true;
      return { status: 'COMPLETE' };
    },
  });

  assert.equal(ingested, false);
  assert.equal(result.status, 'PAUSED');
  assert.equal(result.failed, 0);
  assert.equal(result.deferred, 1);
  assert.equal(result.items[0].status, 'DEFERRED');
  assert.equal(result.items[0].resultStatus, 'BLOCKED');
  assert.match(result.items[0].errorMessage, /search_challenge_or_access_blocked/);
});

test('browser batch stops after the first search challenge and checkpoints remaining companies', async (t) => {
  const repository = await createRepository(t);
  const searched = [];

  const result = await runBrowserCompanyBatch({
    batchId: 'browser-circuit-breaker',
    companies: [
      { company: 'Blocked Co' },
      { company: 'Must Stay Pending Co' },
    ],
  }, {
    repository,
    discoverCompany: async (company) => {
      searched.push(company.company);
      return {
        company: company.company,
        status: 'BLOCKED',
        reasonCode: 'search_challenge_or_access_blocked',
      };
    },
    ingestCompany: async () => ({ status: 'COMPLETE' }),
  });

  assert.deepEqual(searched, ['Blocked Co']);
  assert.equal(result.status, 'PAUSED');
  assert.equal(result.failed, 0);
  assert.equal(result.deferred, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.items[0].status, 'DEFERRED');
  assert.equal(result.items[1].status, 'PENDING');
  assert.equal(repository.getProviderCircuitState('baidu').state, 'OPEN');
});
