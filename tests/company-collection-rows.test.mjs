import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCompanyCollectionRows } from '../src/application/build-company-collection-rows.mjs';
import { buildCurrentTaskCompanySnapshot } from '../src/application/generate-control-plane-exports.mjs';

test('company collection rows include every company without promoting weak portals', () => {
  const companies = [
    {
      id: 'company-1',
      canonicalName: '示例公司',
      officialDomains: ['example.com'],
      countryRegion: '中国大陆',
    },
    {
      id: 'company-2',
      canonicalName: '待发现公司',
      officialDomains: [],
      countryRegion: '中国大陆',
    },
  ];
  const rows = buildCompanyCollectionRows({
    companies,
    portals: [{
      id: 'portal-1',
      companyId: 'company-1',
      canonicalUrl: 'https://example.com/',
      channelType: 'WEB_PORTAL',
      sourceTier: 'OFFICIAL_SITE',
      pageType: 'CAREER_HOME',
      verificationStatus: 'REVIEW',
      confidenceScore: 35,
      hiringAvailability: 'UNKNOWN',
      lastCheckedAt: '2026-07-28T00:00:00.000Z',
    }],
    events: [],
    jobs: [],
  });

  assert.equal(rows.length, 2);
  const reviewed = rows.find((row) => row.公司名称 === '示例公司');
  assert.equal(reviewed.公司官网域名, 'example.com');
  assert.equal(reviewed.招聘入口, 'https://example.com/');
  assert.equal(reviewed.核验状态, 'REVIEW');
  assert.equal(reviewed.活跃岗位数, 0);
  const missing = rows.find((row) => row.公司名称 === '待发现公司');
  assert.equal(missing.核验状态, '未发现');
  assert.equal(missing.招聘入口, '');
});

test('dashboard company export is scoped to the current domestic task queue', () => {
  const snapshot = buildCurrentTaskCompanySnapshot({
    listCompanies: () => [
      { id: 'cn-1', canonicalName: '国内公司', aliases: [] },
      { id: 'global-1', canonicalName: 'Global Company', aliases: [] },
    ],
    listCareerPortals: () => [
      { id: 'portal-cn', companyId: 'cn-1' },
      { id: 'portal-global', companyId: 'global-1' },
    ],
    listRecruitmentEvents: () => [],
    listJobOpenings: () => [],
    listControlTasks: () => [{ batchId: 'batch-cn' }],
    listBatchItems: () => [{
      input: { company: '国内公司', companyId: 'cn-1' },
    }],
  });

  assert.deepEqual(snapshot.companies.map((company) => company.id), ['cn-1']);
  assert.deepEqual(snapshot.portals.map((portal) => portal.id), ['portal-cn']);
});
