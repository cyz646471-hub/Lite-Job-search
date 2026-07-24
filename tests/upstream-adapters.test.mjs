import assert from 'node:assert/strict';
import test from 'node:test';

import { toLegacyJobResult } from '../src/adapters/legacy/job-result-adapter.mjs';
import { createUpstreamJobExtractionAdapter } from '../src/adapters/upstream/job-extraction-adapter.mjs';
import { createOfficialVerificationAdapter } from '../src/adapters/upstream/official-verification-adapter.mjs';

const NOW = '2026-07-24T00:00:00.000Z';

function createVerificationAdapter() {
  return createOfficialVerificationAdapter({
    detectAts: ({ url }) => ({
      ats: url.includes('mokahr') ? 'MOKA' : '',
      confidence: url.includes('mokahr') ? 1 : 0,
      evidence: url.includes('mokahr') ? 'fixture' : '',
    }),
    classifyPage: ({ status, parsed }) => ({
      pageRole: parsed?.pageRole || 'JOB_LIST',
      vacancyStatus: [401, 403, 429].includes(status) ? 'BLOCKED' : 'ACTIVE',
      links: [],
    }),
    evaluateIdentity: () => ({
      strongEvidence: [],
      mediumEvidence: ['job_content_match'],
      riskSignals: [],
    }),
  });
}

test('ATS fingerprint without tenant identity remains neutral', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: '示例科技', officialDomains: [] },
    candidate: { url: 'https://example.mokahr.com/jobs' },
    page: {
      status: 200,
      finalUrl: 'https://example.mokahr.com/jobs',
      html: '<h1>招聘职位</h1>',
    },
  });

  assert.equal(result.atsType, 'MOKA');
  assert.ok(result.evidence.some((item) => item.code === 'ats_fingerprint_only'));
  assert.ok(!result.evidence.some((item) => item.code === 'verified_ats_tenant'));
});

test('known official domain becomes an independent anchor', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: '示例科技', officialDomains: ['example.com'] },
    candidate: { url: 'https://jobs.example.com/openings' },
    page: {
      status: 200,
      finalUrl: 'https://jobs.example.com/openings',
      html: '<h1>Open positions</h1>',
    },
  });

  assert.ok(result.evidence.some((item) => item.code === 'official_domain_match'));
  assert.ok(!result.evidence.some((item) => item.code === 'candidate_self_domain'));
});

test('candidate domain without prior company evidence does not self-verify', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: '示例科技', officialDomains: [] },
    candidate: { url: 'https://jobs.untrusted.example/openings' },
    page: {
      status: 200,
      finalUrl: 'https://jobs.untrusted.example/openings',
      html: '<h1>Open positions</h1>',
    },
  });

  assert.ok(result.evidence.some((item) => item.code === 'candidate_self_domain'));
  assert.ok(!result.evidence.some((item) => item.code === 'official_domain_match'));
});

test('aggregator hard rejection is emitted before ATS evidence', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: '示例科技', officialDomains: [] },
    candidate: {
      url: 'https://www.zhipin.com/job_detail/1',
      verifiedTenant: true,
    },
    page: {
      status: 200,
      finalUrl: 'https://www.zhipin.com/job_detail/1',
      html: '<h1>招聘职位</h1>',
    },
  });

  assert.equal(result.evidence[0].code, 'aggregator_domain');
});

test('blocked page produces a non-bypass evidence code', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: '示例科技', officialDomains: ['example.com'] },
    candidate: { url: 'https://jobs.example.com/openings' },
    page: {
      status: 403,
      finalUrl: 'https://jobs.example.com/openings',
      html: 'Access denied',
    },
  });

  assert.ok(result.evidence.some((item) => item.code === 'blocked_page'));
});

test('job extraction maps page provider jobs without inventing dates', async () => {
  const extractor = createUpstreamJobExtractionAdapter({
    now: () => NOW,
    fetchPage: async () => ({
      status: 200,
      finalUrl: 'https://jobs.example.com/openings',
      html: '<h1>AI 产品经理</h1>',
    }),
    resolvePageProvider: async () => ({
      id: 'fixture',
      parse: () => ({
        activeJobs: [{
          id: 'ai-pm',
          title: 'AI 产品经理',
          location: '上海',
          detailUrl: 'https://jobs.example.com/positions/ai-pm',
        }],
      }),
    }),
  });

  const jobs = await extractor.extract({
    company: { id: 'company-1', canonicalName: '示例科技' },
    portal: {
      id: 'portal-1',
      companyId: 'company-1',
      canonicalUrl: 'https://jobs.example.com/openings',
      pageType: 'JOB_LIST',
      verificationStatus: 'VERIFIED',
    },
    intent: { roleFamily: 'PRODUCT_MANAGEMENT' },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'AI 产品经理');
  assert.equal(jobs[0].publishedAt, null);
  assert.equal(jobs[0].jobDetailUrl, 'https://jobs.example.com/positions/ai-pm');
});

test('job extraction refuses an unverified portal', async () => {
  const extractor = createUpstreamJobExtractionAdapter({
    fetchPage: async () => ({ status: 200, finalUrl: 'https://example.com', html: '' }),
  });
  await assert.rejects(extractor.extract({
    company: { id: 'company-1' },
    portal: {
      id: 'portal-1',
      companyId: 'company-1',
      canonicalUrl: 'https://example.com',
      pageType: 'JOB_LIST',
      verificationStatus: 'REVIEW',
    },
    intent: {},
  }), /verified CareerPortal/);
});

test('job extraction preserves an unknown liveness state', async () => {
  const extractor = createUpstreamJobExtractionAdapter({
    fetchPage: async () => ({
      status: 200,
      finalUrl: 'https://jobs.example.com/openings',
      jobs: [{
        id: 'unknown-state',
        title: 'AI 产品经理',
        detailUrl: 'https://jobs.example.com/positions/unknown-state',
      }],
    }),
  });
  const [opening] = await extractor.extract({
    company: { id: 'company-1' },
    portal: {
      id: 'portal-1',
      companyId: 'company-1',
      canonicalUrl: 'https://jobs.example.com/openings',
      pageType: 'JOB_LIST',
      verificationStatus: 'VERIFIED',
    },
  });
  assert.equal(opening.status, 'UNKNOWN');
});

test('legacy projection preserves the actual portal URL role', () => {
  const result = toLegacyJobResult({
    company: { canonicalName: '示例科技', market: 'CN' },
    portal: {
      pageType: 'JOB_LIST',
      canonicalUrl: 'https://jobs.example.com/openings',
      verificationStatus: 'VERIFIED',
    },
    opening: {
      title: 'AI 产品经理',
      locations: ['上海'],
      publishedAt: '2026-07-20T00:00:00.000Z',
      sourceUrl: 'https://jobs.example.com/positions/ai-pm',
      status: 'ACTIVE',
    },
  });

  assert.equal(result.jobListUrl, 'https://jobs.example.com/openings');
  assert.equal(result.applyUrl, null);
  assert.equal(result.sourceUrl, 'https://jobs.example.com/positions/ai-pm');
});
