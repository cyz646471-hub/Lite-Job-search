import assert from 'node:assert/strict';
import test from 'node:test';

import { createSearchSourceAdapter } from '../src/adapters/upstream/search-source-adapter.mjs';
import { discoverCompanies } from '../src/discovery/company-discovery.mjs';

const intent = {
  id: 'intent-1',
  market: 'CN',
  freshnessDays: 90,
};

test('SearchRouter adapter maps a planned query without changing freshness', async () => {
  const requests = [];
  const searchSource = createSearchSourceAdapter({
    router: {
      async search(request) {
        requests.push(request);
        return { status: 'ok', provider: 'fixture', items: [], attempts: [] };
      },
    },
  });

  await searchSource.search({ text: '"AI 产品经理" 招聘', topK: 12 }, intent);

  assert.deepEqual(requests[0], {
    query: '"AI 产品经理" 招聘',
    market: 'CN',
    topK: 12,
    freshnessDays: 90,
    cacheKey: 'market-discovery|CN|"AI 产品经理" 招聘',
  });
});

test('company discovery deduplicates canonical URLs and logs every result', async () => {
  const searchSource = {
    async search() {
      return {
        status: 'ok',
        provider: 'fixture',
        attempts: [{ provider: 'fixture', status: 'ok', networkRequest: false }],
        liveSearchExecuted: false,
        items: [
          { company: '示例科技', title: '示例科技招聘', url: 'https://jobs.example.com/', rank: 1 },
          { company: '示例科技', title: '重复结果', url: 'https://jobs.example.com/#jobs', rank: 2 },
        ],
      };
    },
  };

  const result = await discoverCompanies({
    intent,
    queryPlan: { queries: [{ text: '"AI 产品经理" 招聘', topK: 10 }] },
    searchSource,
    runId: 'run-1',
    now: '2026-07-24T00:00:00.000Z',
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].company, '示例科技');
  assert.equal(result.logs.length, 2);
  assert.deepEqual(result.logs.map((item) => item.outcome), ['DISCOVERED', 'DUPLICATE']);
  assert.equal(result.liveSearchExecuted, false);
});

test('company discovery extracts company identity from a recruitment title', async () => {
  const result = await discoverCompanies({
    intent,
    queryPlan: { queries: [{ text: 'query', topK: 10 }] },
    searchSource: {
      search: async () => ({
        status: 'ok',
        provider: 'fixture',
        attempts: [],
        items: [{
          title: '示例智能科技招聘官网 - AI 产品经理',
          url: 'https://jobs.example.com',
          rank: 1,
        }],
      }),
    },
    runId: 'run-1',
  });

  assert.equal(result.candidates[0].company, '示例智能科技');
  assert.ok(result.candidates[0].companyIdentityKey);
});

test('missing company identity is logged for review and not auto-processed', async () => {
  const result = await discoverCompanies({
    intent,
    queryPlan: { queries: [{ text: 'query', topK: 10 }] },
    searchSource: {
      search: async () => ({
        status: 'ok',
        provider: 'fixture',
        attempts: [],
        items: [{ title: '点击查看详情', url: 'https://unknown.example/page', rank: 1 }],
      }),
    },
    runId: 'run-1',
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.logs[0].outcome, 'REVIEW_REQUIRED');
  assert.equal(result.logs[0].metadata.reason, 'company_identity_missing');
});

test('budget deferral remains distinct from no results', async () => {
  const result = await discoverCompanies({
    intent,
    queryPlan: { queries: [{ text: 'query', topK: 10 }] },
    searchSource: {
      search: async () => ({
        status: 'search_deferred_by_budget',
        provider: 'fixture',
        items: [],
        attempts: [{ provider: 'fixture', status: 'search_deferred_by_budget' }],
      }),
    },
    runId: 'run-1',
  });

  assert.equal(result.status, 'DEFERRED_BY_BUDGET');
  assert.equal(result.candidates.length, 0);
});

test('not configured remains distinct from an empty successful search', async () => {
  const result = await discoverCompanies({
    intent,
    queryPlan: { queries: [{ text: 'query', topK: 10 }] },
    searchSource: {
      search: async () => ({
        status: 'not_configured',
        provider: 'none',
        items: [],
        attempts: [],
      }),
    },
    runId: 'run-1',
  });

  assert.equal(result.status, 'NOT_CONFIGURED');
});
