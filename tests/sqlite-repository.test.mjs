import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertMarketDiscoveryRepository } from '../src/ports/job-repository.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const NOW = '2026-07-24T00:00:00.000Z';

function createCompany(overrides = {}) {
  return {
    id: 'company-1',
    canonicalName: '示例科技',
    aliases: ['示例'],
    primaryOfficialDomain: 'example.com',
    officialDomains: ['example.com'],
    industryTags: ['AI'],
    market: 'CN',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createPortal(overrides = {}) {
  return {
    id: 'portal-1',
    companyId: 'company-1',
    canonicalUrl: 'https://jobs.example.com/',
    url: 'https://jobs.example.com/',
    registrableDomain: 'example.com',
    atsType: '',
    pageType: 'JOB_LIST',
    verificationStatus: 'VERIFIED',
    confidenceScore: 80,
    evidence: [],
    firstSeenAt: NOW,
    lastVerifiedAt: NOW,
    ...overrides,
  };
}

function createOpening(overrides = {}) {
  return {
    id: 'job-1',
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    sourceJobId: '1',
    title: 'AI 产品经理',
    normalizedTitle: 'ai 产品经理',
    roleFamily: 'PRODUCT_MANAGEMENT',
    locations: ['上海'],
    employmentType: 'full_time',
    publishedAt: '2026-07-20T00:00:00.000Z',
    closesAt: null,
    jobDetailUrl: 'https://jobs.example.com/1',
    applyUrl: null,
    status: 'ACTIVE',
    sourceUrl: 'https://jobs.example.com/1',
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    ...overrides,
  };
}

async function createRepository(prefix = 'lite-job-market-') {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  assertMarketDiscoveryRepository(repository);
  repository.migrate();
  return repository;
}

test('SQLite repositories upsert a complete verified chain idempotently', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());

  repository.upsertCompany(createCompany());
  repository.upsertCompany(createCompany({ aliases: ['示例', 'Example Tech'] }));
  repository.upsertCompany(createCompany({
    aliases: [],
    primaryOfficialDomain: null,
    officialDomains: [],
    industryTags: [],
  }));
  repository.upsertCareerPortal(createPortal());
  repository.upsertJobOpening(createOpening());
  repository.upsertJobOpening(createOpening({ lastSeenAt: '2026-07-24T01:00:00.000Z' }));

  assert.equal(repository.listCompanies().length, 1);
  assert.deepEqual(repository.listCompanies()[0].aliases, ['Example Tech', '示例']);
  assert.deepEqual(repository.listCompanies()[0].officialDomains, ['example.com']);
  assert.equal(repository.listCompanies()[0].primaryOfficialDomain, 'example.com');
  assert.deepEqual(repository.listCompanies()[0].industryTags, ['AI']);
  assert.equal(repository.listCareerPortals().length, 1);
  assert.equal(repository.listJobOpenings().length, 1);
  assert.equal(repository.listJobOpenings()[0].lastSeenAt, '2026-07-24T01:00:00.000Z');
});

test('repository rejects jobs under an unverified portal', async (t) => {
  const repository = await createRepository('lite-job-market-review-');
  t.after(() => repository.close());

  repository.upsertCompany(createCompany({
    id: 'company-2',
    canonicalName: '待复核公司',
    aliases: [],
    primaryOfficialDomain: null,
    officialDomains: [],
  }));
  repository.upsertCareerPortal(createPortal({
    id: 'portal-2',
    companyId: 'company-2',
    canonicalUrl: 'https://tenant.example/jobs',
    url: 'https://tenant.example/jobs',
    registrableDomain: 'tenant.example',
    atsType: 'MOKA',
    verificationStatus: 'REVIEW',
    confidenceScore: 50,
  }));

  assert.throws(() => repository.upsertJobOpening(createOpening({
    id: 'job-2',
    companyId: 'company-2',
    careerPortalId: 'portal-2',
    sourceJobId: '2',
    locations: [],
    employmentType: null,
    jobDetailUrl: 'https://tenant.example/jobs/2',
    sourceUrl: 'https://tenant.example/jobs/2',
  })), /verified CareerPortal/);
});

test('runs, logs and evidence round-trip structured fields', async (t) => {
  const repository = await createRepository('lite-job-market-audit-');
  t.after(() => repository.close());

  repository.beginRun({
    id: 'run-1',
    intent: { id: 'intent-1', roleType: 'AI 产品经理' },
    startedAt: NOW,
  });
  repository.upsertCompany(createCompany());
  repository.upsertCareerPortal(createPortal());
  repository.replaceVerificationEvidence('portal-1', [{
    code: 'official_domain_match',
    direction: 'POSITIVE',
    weight: 35,
    observedValue: 'example.com',
    sourceUrl: 'https://jobs.example.com/',
    observedAt: NOW,
  }]);
  repository.appendDiscoveryLog({
    id: 'log-1',
    runId: 'run-1',
    searchIntentId: 'intent-1',
    query: '"AI 产品经理" 招聘',
    expandedKeywords: ['AI PM'],
    searchSource: 'manual',
    searchedAt: NOW,
    resultUrl: 'https://jobs.example.com/',
    resultRank: 1,
    outcome: 'VERIFIED_PORTAL',
    metadata: { score: 80 },
  });
  repository.completeRun({ id: 'run-1', status: 'COMPLETED', completedAt: NOW });

  assert.deepEqual(repository.listCareerPortals()[0].evidence, [{
    code: 'official_domain_match',
    direction: 'POSITIVE',
    weight: 35,
    observedValue: 'example.com',
    sourceUrl: 'https://jobs.example.com/',
    observedAt: NOW,
  }]);
  assert.deepEqual(repository.listDiscoveryLogs()[0].expandedKeywords, ['AI PM']);
  assert.deepEqual(repository.listDiscoveryLogs()[0].metadata, { score: 80 });
});

test('downgrading a portal removes its openings from the formal result set', async (t) => {
  const repository = await createRepository('lite-job-market-downgrade-');
  t.after(() => repository.close());

  repository.upsertCompany(createCompany());
  repository.upsertCareerPortal(createPortal());
  repository.upsertJobOpening(createOpening());
  assert.equal(repository.listJobOpenings().length, 1);

  repository.upsertCareerPortal(createPortal({
    verificationStatus: 'REVIEW',
    confidenceScore: 50,
  }));

  assert.equal(repository.listJobOpenings().length, 0);
});
