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
    location: null,
    freshnessDays: 90,
    targetCount: 20,
    locale: 'zh-CN',
    createdAt: NOW,
  });
});

test('SearchIntent preserves an optional location filter', () => {
  const intent = createSearchIntent({
    market: 'CN',
    roleType: 'Backend Engineer',
    industryTags: [],
    location: ' 上海 ',
    freshnessDays: 90,
    targetCount: 10,
  }, { id: 'intent-location' });

  assert.equal(intent.location, '上海');
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

test('Company carries bilingual identity and country region', () => {
  const company = createCompany({
    id: 'company-bilingual',
    canonicalName: 'ByteDance',
    chineseName: '字节跳动',
    englishName: 'ByteDance',
    aliases: ['抖音集团'],
    officialDomains: ['bytedance.com'],
    industryTags: ['互联网'],
    countryRegion: '中国大陆',
    market: 'CN',
  });

  assert.equal(company.chineseName, '字节跳动');
  assert.equal(company.englishName, 'ByteDance');
  assert.equal(company.countryRegion, '中国大陆');
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

test('CareerPortal preserves recruitment types', () => {
  const portal = createCareerPortal({
    id: 'portal-types',
    companyId: 'company-1',
    canonicalUrl: 'https://jobs.example.com/',
    registrableDomain: 'example.com',
    atsType: 'MOKA',
    pageType: 'CAREER_HOME',
    verificationStatus: 'VERIFIED',
    confidenceScore: 90,
    recruitmentTypes: ['campus', 'internship', 'experienced', 'campus'],
  });

  assert.deepEqual(portal.recruitmentTypes, ['campus', 'internship', 'experienced']);
});

test('CareerPortal defaults verified official portals to confirmed official identity', () => {
  const portal = createCareerPortal({
    id: 'portal-official',
    companyId: 'company-1',
    canonicalUrl: 'https://example.com/careers',
    registrableDomain: 'example.com',
    pageType: 'CAREER_HOME',
    verificationStatus: 'VERIFIED',
    confidenceScore: 80,
  });

  assert.equal(portal.sourceTier, 'OFFICIAL_SITE');
  assert.equal(portal.officialIdentityConfirmed, true);
  assert.equal(portal.platformIdentityConfirmed, false);
  assert.equal(portal.hiringAvailability, 'UNKNOWN');
  assert.equal(portal.searchCoverage, 'PARTIAL');
});

test('CareerPortal keeps platform-only sources isolated from official verification', () => {
  assert.throws(() => createCareerPortal({
    id: 'portal-platform-verified',
    companyId: 'company-1',
    canonicalUrl: 'https://www.liepin.com/company-jobs/123/',
    registrableDomain: 'liepin.com',
    pageType: 'JOB_LIST',
    sourceTier: 'PLATFORM_ONLY',
    platformIdentityConfirmed: true,
    verificationStatus: 'VERIFIED',
    confidenceScore: 49,
  }), /PLATFORM_ONLY.*VERIFIED/);

  assert.throws(() => createCareerPortal({
    id: 'portal-platform-score',
    companyId: 'company-1',
    canonicalUrl: 'https://www.liepin.com/company-jobs/123/',
    registrableDomain: 'liepin.com',
    pageType: 'JOB_LIST',
    sourceTier: 'PLATFORM_ONLY',
    platformIdentityConfirmed: true,
    verificationStatus: 'REVIEW',
    confidenceScore: 50,
  }), /PLATFORM_ONLY.*49/);

  assert.throws(() => createCareerPortal({
    id: 'portal-platform-openings',
    companyId: 'company-1',
    canonicalUrl: 'https://www.liepin.com/company-jobs/123/',
    registrableDomain: 'liepin.com',
    pageType: 'JOB_LIST',
    sourceTier: 'PLATFORM_ONLY',
    verificationStatus: 'REVIEW',
    confidenceScore: 30,
    hiringAvailability: 'OPENINGS_FOUND',
  }), /platformIdentityConfirmed/);
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

test('JobOpening URL identity is stable across event and location enrichment', () => {
  const first = stableOpeningId({
    companyId: 'company-1',
    recruitmentEventId: 'event-before-enrichment',
    sourceUrl: 'https://jobs.example.com/42',
    title: 'AI 产品经理',
    locations: [],
  });
  const second = stableOpeningId({
    companyId: 'company-1',
    recruitmentEventId: 'event-after-enrichment',
    sourceUrl: 'https://jobs.example.com/42',
    title: 'AI 产品经理',
    locations: ['北京'],
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
  assert.equal(job.recruitmentEventId, null);
  assert.equal(job.sourceTier, 'OFFICIAL_SITE');
  assert.equal(isRecentOpening(job, {
    freshnessDays: 90,
    now: Date.parse('2026-07-24T00:00:00.000Z'),
  }), false);
});

test('JobOpening preserves recruitment event and source tier', () => {
  const job = createJobOpening({
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    recruitmentEventId: 'event-1',
    sourceTier: 'OFFICIAL_ATS',
    title: 'AI Product Manager',
    sourceUrl: 'https://jobs.example.com/1',
  }, { now: NOW });

  assert.equal(job.recruitmentEventId, 'event-1');
  assert.equal(job.sourceTier, 'OFFICIAL_ATS');
  assert.throws(() => createJobOpening({
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    sourceTier: 'AGGREGATOR',
    title: 'AI Product Manager',
    sourceUrl: 'https://jobs.example.com/2',
  }), /sourceTier/);
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
