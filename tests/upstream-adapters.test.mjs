import assert from 'node:assert/strict';
import test from 'node:test';

import { detectAtsFingerprint } from '../engine/upstream/planner/cn-ats-fingerprint.mjs';
import { toLegacyJobResult } from '../src/adapters/legacy/job-result-adapter.mjs';
import { createUpstreamJobExtractionAdapter } from '../src/adapters/upstream/job-extraction-adapter.mjs';
import { createOfficialVerificationAdapter } from '../src/adapters/upstream/official-verification-adapter.mjs';

const NOW = '2026-07-24T00:00:00.000Z';

test('CN ATS fingerprint registry recognizes supported tenant domains', () => {
  assert.equal(detectAtsFingerprint({
    url: 'https://example.mokahr.com/jobs',
  }).ats, 'MOKA');
  assert.equal(detectAtsFingerprint({
    url: 'https://example.beisencloud.com/campus',
  }).ats, 'Beisen');
  assert.equal(detectAtsFingerprint({
    url: 'https://example.hotjob.cn/jobs',
  }).ats, 'HOTJOB');
  assert.equal(detectAtsFingerprint({
    url: 'https://example.zhiye.com/social',
  }).ats, 'Zhiye');
});

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

test('ATS tenant requires directed attribution from a verified official page', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: 'Example Tech', officialDomains: ['example.com'] },
    candidate: {
      url: 'https://example.mokahr.com/jobs',
      verifiedTenant: true,
      parentOfficialVerified: true,
      officialAttributionUrl: 'https://example.com/careers',
    },
    page: {
      status: 200,
      finalUrl: 'https://example.mokahr.com/jobs',
      html: '<h1>Open positions</h1>',
    },
  });

  assert.ok(result.evidence.some((item) => item.code === 'verified_ats_tenant'));
  assert.ok(result.evidence.some((item) => item.code === 'official_site_confirms_ats_tenant'));
});

test('unverified parent cannot create official ATS attribution evidence', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: 'Example Tech', officialDomains: ['example.com'] },
    candidate: {
      url: 'https://example.mokahr.com/jobs',
      verifiedTenant: true,
      parentOfficialVerified: false,
      officialAttributionUrl: 'https://untrusted.example/list',
    },
    page: {
      status: 200,
      finalUrl: 'https://example.mokahr.com/jobs',
      html: '<a href="https://example.com/">Official site</a>',
      officialSiteLinked: true,
    },
  });

  assert.ok(!result.evidence.some(
    (item) => item.code === 'official_site_confirms_ats_tenant',
  ));
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

test('platform-only candidate is defensively isolated from official verification', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: '希奥端', officialDomains: [] },
    candidate: {
      url: 'https://www.liepin.com/company-jobs/13296749/',
      sourceTier: 'PLATFORM_ONLY',
    },
    page: {
      status: 200,
      finalUrl: 'https://www.liepin.com/company-jobs/13296749/',
      html: '<h1>希奥端招聘职位</h1>',
    },
  });

  assert.equal(result.pageType, 'JOB_LIST');
  assert.equal(result.vacancyStatus, 'UNKNOWN');
  assert.equal(result.atsType, '');
  assert.deepEqual(result.evidence.map((item) => item.code), ['aggregator_domain']);
});

test('employee development language on an official recruitment surface is not a training-provider rejection', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: '长江证券', officialDomains: ['cjsc.com.cn'] },
    candidate: { url: 'https://cjzq.zhiye.com/campus' },
    page: {
      status: 200,
      finalUrl: 'https://cjzq.zhiye.com/campus',
      title: '长江证券校园招聘',
      html: '<main><h1>校园招聘</h1><a href="/campus/jobs">岗位列表</a><p>全周期培训与成长支持</p><footer>长江证券股份有限公司 Powered by Beisen</footer></main>',
    },
  });

  assert.ok(!result.evidence.some((item) => item.code === 'training_provider'));
  assert.ok(result.evidence.some((item) => item.code === 'recruitment_structure'));
});

test('commercial career coaching remains a training-provider rejection', async () => {
  const adapter = createVerificationAdapter();
  const result = await adapter.inspect({
    company: { canonicalName: '示例科技', officialDomains: [] },
    candidate: { url: 'https://example.com/career-coaching' },
    page: {
      status: 200,
      finalUrl: 'https://example.com/career-coaching',
      html: '<h1>求职培训课程</h1><p>付费内推与职业辅导服务</p>',
    },
  });

  assert.ok(result.evidence.some((item) => item.code === 'training_provider'));
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
          publishedAt: '07-01',
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
      atsType: 'MOKA',
      sourceTier: 'OFFICIAL_ATS',
      pageType: 'JOB_LIST',
      verificationStatus: 'VERIFIED',
    },
    intent: { roleFamily: 'PRODUCT_MANAGEMENT' },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'AI 产品经理');
  assert.equal(jobs[0].publishedAt, null);
  assert.equal(jobs[0].sourceTier, 'OFFICIAL_ATS');
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
