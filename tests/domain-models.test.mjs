import assert from 'node:assert/strict';
import test from 'node:test';

import { createCareerPortal } from '../src/domain/career-portal.mjs';
import { createCompany } from '../src/domain/company.mjs';
import { createDiscoveryLog } from '../src/domain/discovery-log.mjs';
import { createJobOpening, isRecentOpening, stableOpeningId } from '../src/domain/job-opening.mjs';
import { createSearchIntent } from '../src/domain/search-intent.mjs';
import { createVerificationEvidence } from '../src/domain/verification-evidence.mjs';

const NOW = '2026-07-24T00:00:00.000Z';

test('SearchIntent normalizes role, industry and locale', () => {
  const intent = createSearchIntent({
    market: 'china',
    roleType: '  AI 产品经理 ',
    industryTags: ['AI', ' 互联网 ', 'AI'],
    freshnessDays: 90,
    targetCount: 20,
  }, { id: 'intent-1', now: NOW });

  assert.deepEqual(intent, {
    id: 'intent-1',
    market: 'CN',
    roleType: 'AI 产品经理',
    industryTags: ['AI', '互联网'],
    freshnessDays: 90,
    targetCount: 20,
    locale: 'zh-CN',
    createdAt: NOW,
  });
});

test('SearchIntent rejects invalid role and bounds', () => {
  assert.throws(
    () => createSearchIntent({ market: 'CN', roleType: '', freshnessDays: 90, targetCount: 1 }, { id: 'x' }),
    /roleType/,
  );
  assert.throws(
    () => createSearchIntent({ market: 'CN', roleType: 'PM', freshnessDays: 0, targetCount: 1 }, { id: 'x' }),
    /freshnessDays/,
  );
  assert.throws(
    () => createSearchIntent({ market: 'CN', roleType: 'PM', freshnessDays: 90, targetCount: 1001 }, { id: 'x' }),
    /targetCount/,
  );
});

test('Company normalizes domains and protects input arrays', () => {
  const aliases = [' 示例科技 ', 'Example AI'];
  const company = createCompany({
    id: 'company-1',
    canonicalName: ' 示例智能科技 ',
    aliases,
    officialDomains: ['EXAMPLE.COM', 'example.com'],
    industryTags: ['AI'],
    market: 'CN',
  }, { now: NOW });
  aliases.push('mutated');

  assert.equal(company.canonicalName, '示例智能科技');
  assert.deepEqual(company.aliases, ['示例科技', 'Example AI']);
  assert.deepEqual(company.officialDomains, ['example.com']);
  assert.equal(company.primaryOfficialDomain, 'example.com');
  assert.ok(Object.isFrozen(company));
});

test('CareerPortal validates page and verification status', () => {
  const portal = createCareerPortal({
    id: 'portal-1',
    companyId: 'company-1',
    canonicalUrl: 'https://jobs.example.com/',
    registrableDomain: 'example.com',
    pageType: 'JOB_LIST',
    verificationStatus: 'VERIFIED',
    confidenceScore: 80,
  }, { now: NOW });

  assert.equal(portal.pageType, 'JOB_LIST');
  assert.equal(portal.verificationStatus, 'VERIFIED');
  assert.equal(portal.firstSeenAt, NOW);
  assert.throws(() => createCareerPortal({
    id: 'portal-2',
    companyId: 'company-1',
    canonicalUrl: 'https://example.com',
    pageType: 'LIST',
    verificationStatus: 'VERIFIED',
  }), /pageType/);
});

test('JobOpening uses source job id before URL fallback', () => {
  const first = stableOpeningId({
    companyId: 'company-1',
    sourceJobId: 'job-42',
    sourceUrl: 'https://jobs.example.com/42',
    title: 'AI 产品经理',
  });
  const second = stableOpeningId({
    companyId: 'company-1',
    sourceJobId: 'job-42',
    sourceUrl: 'https://jobs.example.com/changed',
    title: 'Changed title',
  });
  assert.equal(first, second);
});

test('JobOpening preserves unknown publication date and does not call it recent', () => {
  const job = createJobOpening({
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    title: 'AI 产品经理',
    sourceUrl: 'https://jobs.example.com/1',
    publishedAt: null,
  }, { now: NOW });

  assert.equal(job.publishedAt, null);
  assert.equal(isRecentOpening(job, {
    freshnessDays: 90,
    now: Date.parse('2026-07-24T00:00:00.000Z'),
  }), false);
});

test('VerificationEvidence and DiscoveryLog use machine-readable enums', () => {
  const evidence = createVerificationEvidence({
    code: 'official_domain_match',
    direction: 'POSITIVE',
    weight: 35,
    sourceUrl: 'https://example.com/careers',
  }, { observedAt: NOW });
  const log = createDiscoveryLog({
    id: 'log-1',
    runId: 'run-1',
    searchIntentId: 'intent-1',
    query: '"AI 产品经理" 招聘',
    searchSource: 'manual',
    searchedAt: NOW,
    resultUrl: 'https://example.com/careers',
    outcome: 'DISCOVERED',
  });

  assert.equal(evidence.code, 'official_domain_match');
  assert.equal(evidence.observedAt, NOW);
  assert.equal(log.outcome, 'DISCOVERED');
  assert.throws(() => createDiscoveryLog({
    id: 'log-2',
    runId: 'run-1',
    searchIntentId: 'intent-1',
    outcome: 'MADE_UP',
  }), /outcome/);
});
