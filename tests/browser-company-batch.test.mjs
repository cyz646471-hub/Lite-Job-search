import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createClosedCircuit,
  transitionCircuit,
} from '../src/application/browser-search-circuit-breaker.mjs';
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

test('blocked candidate ingestion fails only that company and continues the batch', async (t) => {
  const repository = await createRepository(t);
  const searched = [];

  const result = await runBrowserCompanyBatch({
    batchId: 'browser-candidate-blocked',
    companies: [
      { company: '候选页受限公司' },
      { company: '后续公司' },
    ],
  }, {
    repository,
    discoverCompany: async (company) => {
      searched.push(company.company);
      return {
        company: company.company,
        status: 'COMPLETED',
        officialCandidates: [],
        observations: [],
      };
    },
    ingestCompany: async ({ companyResult }) => (
      companyResult.company === '候选页受限公司'
        ? { status: 'BLOCKED', runId: 'run-blocked' }
        : { status: 'COMPLETE', runId: 'run-complete' }
    ),
  });

  assert.deepEqual(searched, ['候选页受限公司', '后续公司']);
  assert.equal(result.status, 'COMPLETE_WITH_ERRORS');
  assert.equal(result.failed, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.deferred, 0);
  assert.equal(result.items[0].status, 'FAILED');
  assert.equal(result.items[0].resultStatus, 'FAILED');
  assert.equal(repository.getProviderCircuitState('baidu')?.state ?? 'CLOSED', 'CLOSED');
});

test('browser batch defers remaining Baidu companies after the first challenge', async (t) => {
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
  assert.equal(result.deferred, 2);
  assert.equal(result.pending, 0);
  assert.equal(result.items[0].status, 'DEFERRED');
  assert.equal(result.items[1].status, 'DEFERRED');
  assert.equal(repository.getProviderCircuitState('baidu').state, 'OPEN');
});

test('an official-domain company still receives local navigation while public search is open', async (t) => {
  const repository = await createRepository(t);
  repository.saveProviderCircuitState(transitionCircuit(
    createClosedCircuit('google', '2026-07-29T00:00:00.000Z'),
    { type: 'BLOCKED', reasonCode: 'search_challenge_or_access_blocked' },
    '2026-07-29T00:00:01.000Z',
  ));
  const contexts = [];

  const result = await runBrowserCompanyBatch({
    batchId: 'browser-local-before-google',
    provider: 'google',
    companies: [{
      company: '官网已知公司',
      officialDomain: 'example.com',
    }],
  }, {
    repository,
    discoverCompany: async (company, context) => {
      contexts.push({ company, context });
      return {
        company: company.company,
        status: 'COMPLETED',
        liveSearchExecuted: false,
        officialCandidates: [{
          url: 'https://example.com/careers',
          pageStatus: 'COMPLETED',
        }],
        observations: [],
      };
    },
    ingestCompany: async () => ({ status: 'COMPLETE' }),
  });

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].company.queueType, 'LOCAL_OR_DIRECT_VERIFICATION');
  assert.equal(contexts[0].context.publicSearchAllowed, false);
  assert.equal(result.succeeded, 1);
  assert.equal(result.deferred, 0);
});
