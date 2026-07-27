import assert from 'node:assert/strict';
import test from 'node:test';

import { executeVerificationTask } from '../src/application/execute-verification-task.mjs';
import { discoverCompanyLocally } from '../src/application/discover-company-locally.mjs';
import {
  createSearchCacheKey,
  planCompanyDiscovery,
} from '../src/application/local-first-discovery-planner.mjs';

function repository({
  portals = [],
  knowledge = [],
  cache = null,
} = {}) {
  return {
    listCareerPortals: () => portals,
    listCompanyWebKnowledge: () => knowledge,
    getReusableSearchCache: () => cache,
  };
}

const COMPANY = {
  id: 'company-1',
  canonicalName: '示例公司',
  officialDomains: [],
};

test('verified portal is reused without scheduling Baidu', () => {
  const plan = planCompanyDiscovery({
    company: COMPANY,
    roleKeywords: ['产品经理'],
    allowBaiduFallback: true,
  }, {
    repository: repository({
      portals: [{
        companyId: COMPANY.id,
        canonicalUrl: 'https://jobs.example.com/',
        verificationStatus: 'VERIFIED',
        sourceTier: 'OFFICIAL_SITE',
        officialIdentityConfirmed: true,
      }],
    }),
  });
  assert.equal(plan.queueType, 'LOCAL_OR_DIRECT_VERIFICATION');
  assert.equal(plan.terminalAction, 'VERIFY_CANDIDATES');
  assert.deepEqual(plan.candidates, ['https://jobs.example.com/']);
});

test('known official domain produces deterministic common paths before Baidu', () => {
  const plan = planCompanyDiscovery({
    company: { ...COMPANY, officialDomains: ['example.com'] },
    allowBaiduFallback: true,
  }, { repository: repository() });
  assert.equal(plan.queueType, 'LOCAL_OR_DIRECT_VERIFICATION');
  assert.ok(plan.candidates.includes('https://example.com/careers'));
});

test('fixed-pool planning checks only confirmed portals without domain expansion', () => {
  const plan = planCompanyDiscovery({
    company: { ...COMPANY, officialDomains: ['example.com'] },
    allowBaiduFallback: false,
    confirmedPortalsOnly: true,
  }, {
    repository: repository({
      portals: [{
        companyId: COMPANY.id,
        canonicalUrl: 'https://jobs.example.com/',
        verificationStatus: 'VERIFIED',
        sourceTier: 'OFFICIAL_SITE',
        officialIdentityConfirmed: true,
      }],
    }),
  });
  assert.deepEqual(plan.candidates, ['https://jobs.example.com/']);
  assert.deepEqual(plan.officialDomains, []);
  assert.equal(plan.confirmedPortalsOnly, true);
  assert.equal(plan.stages.find((stage) => stage.source === 'BAIDU_BROWSER').enabled, false);
});

test('no local evidence schedules Baidu only when explicitly allowed', () => {
  const baidu = planCompanyDiscovery({
    company: COMPANY,
    allowBaiduFallback: true,
  }, { repository: repository() });
  const manual = planCompanyDiscovery({
    company: COMPANY,
    allowBaiduFallback: false,
  }, { repository: repository() });
  assert.equal(baidu.queueType, 'BAIDU_DISCOVERY_REQUIRED');
  assert.equal(manual.terminalAction, 'MANUAL_OFFICIAL_DISCOVERY');
});

test('no local evidence can schedule Google with an engine-specific cache key', () => {
  const plan = planCompanyDiscovery({
    company: COMPANY,
    searchEngine: 'google',
    allowSearchFallback: true,
  }, { repository: repository() });
  assert.equal(plan.queueType, 'PUBLIC_SEARCH_DISCOVERY_REQUIRED');
  assert.equal(plan.terminalAction, 'GOOGLE_DISCOVERY');
  assert.equal(plan.searchEngine, 'google');
  assert.equal(plan.stages.find((stage) => stage.source === 'GOOGLE_BROWSER').enabled, true);
  assert.notEqual(plan.cacheKey, createSearchCacheKey({
    engine: 'baidu',
    query: '示例公司 招聘',
    locale: 'zh-CN',
  }));
});

test('search cache key includes absolute date range and strategy', () => {
  const a = createSearchCacheKey({
    engine: 'baidu',
    query: '示例公司 招聘',
    locale: 'zh-CN',
    absoluteDateFrom: '2026-04-01',
    absoluteDateTo: '2026-07-01',
  });
  const b = createSearchCacheKey({
    engine: 'baidu',
    query: '示例公司 招聘',
    locale: 'zh-CN',
    absoluteDateFrom: '2026-05-01',
    absoluteDateTo: '2026-07-01',
  });
  assert.notEqual(a, b);
});

test('verification task executes Direct HTTP then ATS then Playwright only as needed', async () => {
  const calls = [];
  const result = await executeVerificationTask({
    candidates: ['https://ats.example.com/jobs'],
  }, {
    directHttp: async () => {
      calls.push('direct');
      return { status: 'COMPLETED', completed: false, atsType: 'moka' };
    },
    atsAdapter: async () => {
      calls.push('ats');
      return { status: 'COMPLETED', completed: true };
    },
    playwrightFallback: async () => {
      calls.push('browser');
      return { completed: true };
    },
  });
  assert.deepEqual(calls, ['direct', 'ats']);
  assert.equal(result.method, 'ATS_ADAPTER');
});

test('local discovery excludes HTTP errors and preserves failed child observations', async () => {
  const result = await discoverCompanyLocally({
    company: { id: 'company-1', company: '示例公司' },
    plan: {
      query: '示例公司 招聘',
      candidates: ['https://example.com/careers', 'https://example.com/jobs'],
      officialDomains: [],
      stages: [],
    },
    resolveAts: async () => null,
    fetchPage: async (url) => {
      if (url.endsWith('/careers')) {
        return { status: 404, finalUrl: url, html: '<title>Not Found</title>' };
      }
      throw new Error('network failed');
    },
  });
  assert.equal(result.officialCandidates.length, 0);
  assert.equal(result.observations.length, 2);
  assert.equal(result.observations[1].fetchStatus, 'FAILED');
  assert.equal(result.status, 'COMPLETED');
});
