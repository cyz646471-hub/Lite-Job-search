import assert from 'node:assert/strict';
import test from 'node:test';

import { buildControlCompanyList } from '../src/application/build-control-company-list.mjs';

const items = [
  {
    itemKey: 'a',
    position: 0,
    input: {
      company: '阿里巴巴',
      market: 'CN',
      countryRegion: 'China',
      officialDomain: 'alibabagroup.com',
    },
    status: 'PENDING',
    attemptCount: 0,
  },
  {
    itemKey: 'b',
    position: 1,
    input: {
      company: '百度',
      market: 'CN',
      countryRegion: '中国大陆',
      officialDomain: 'baidu.com',
    },
    status: 'FAILED',
    attemptCount: 2,
    errorMessage: 'candidate_page_blocked',
  },
  {
    itemKey: 'c',
    position: 2,
    input: { company: '腾讯', market: 'CN', countryRegion: 'China' },
    status: 'SUCCEEDED',
    attemptCount: 1,
  },
];

test('remaining company list is searchable, paginated, and excludes succeeded items', () => {
  const repository = { listBatchItems: () => items };
  const remaining = buildControlCompanyList({
    repository,
    batchId: 'batch-cn',
    scope: 'REMAINING',
    limit: 1,
  });
  assert.equal(remaining.total, 2);
  assert.equal(remaining.items.length, 1);
  assert.equal(remaining.items[0].company, '阿里巴巴');
  assert.equal(remaining.counts.SUCCEEDED, 1);

  const searched = buildControlCompanyList({
    repository,
    batchId: 'batch-cn',
    scope: 'REMAINING',
    query: 'baidu.com',
  });
  assert.equal(searched.total, 1);
  assert.equal(searched.items[0].company, '百度');
  assert.equal(searched.items[0].reason, 'candidate_page_blocked');
});

test('company list separates verified portals with no open campus hiring', () => {
  const repository = {
    listBatchItems: () => [{
      itemKey: 'shrcb',
      position: 0,
      input: { company: '上海农商银行', market: 'CN', countryRegion: '中国大陆' },
      status: 'SUCCEEDED',
      attemptCount: 1,
    }],
    listCompanies: () => [{
      id: 'company-shrcb',
      canonicalName: '上海农商银行',
      aliases: ['沪农商行'],
      officialDomains: ['shrcb.com'],
    }],
    listCareerPortals: () => [{
      id: 'portal-shrcb',
      companyId: 'company-shrcb',
      canonicalUrl: 'https://shrcb.zhiye.com/campus',
      verificationStatus: 'VERIFIED',
      hiringAvailability: 'NO_OPENINGS',
      confidenceScore: 75,
    }],
    listRecruitmentEvents: () => [],
    listJobOpenings: () => [],
  };

  const result = buildControlCompanyList({
    repository,
    batchId: 'batch-cn',
    scope: 'ALL',
    recruitmentState: 'CAMPUS_NOT_OPEN',
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].company, '上海农商银行');
  assert.equal(result.items[0].campusHiringStatus, 'NOT_OPEN');
  assert.equal(result.items[0].openCampusEventCount, 0);
});

test('company list exposes positive low-confidence candidates without verifying them', () => {
  const repository = {
    listBatchItems: () => [{
      itemKey: 'candidate',
      position: 0,
      input: { company: '候选企业' },
      status: 'SUCCEEDED',
      attemptCount: 1,
    }],
    listCompanies: () => [{ id: 'company-c', canonicalName: '候选企业' }],
    listCareerPortals: () => [{
      id: 'portal-c',
      companyId: 'company-c',
      canonicalUrl: 'https://candidate.example/jobs',
      verificationStatus: 'REVIEW',
      confidenceScore: 15,
    }],
    listRecruitmentEvents: () => [],
    listJobOpenings: () => [],
  };

  const result = buildControlCompanyList({
    repository,
    batchId: 'batch-cn',
    scope: 'ALL',
    confidenceScope: 'C_POSITIVE',
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].portalStatus, 'REVIEW');
  assert.equal(result.items[0].confidenceScore, 15);
});
