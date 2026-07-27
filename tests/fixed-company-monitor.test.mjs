import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFixedCompanyMonitorPlan } from '../src/application/build-fixed-company-monitor-plan.mjs';

const registry = [
  { name_cn: '知名公司', aliases: ['Famous'], industry: ['AI'] },
  { name_cn: '普通公司', aliases: [] },
];
const companies = [
  { id: 'company-famous', canonicalName: '知名公司', aliases: [], market: 'CN' },
  { id: 'company-normal', canonicalName: '普通公司', aliases: [], market: 'CN' },
  { id: 'company-outside', canonicalName: '名单外公司', aliases: [], market: 'CN' },
];
const portals = [
  {
    id: 'portal-famous',
    companyId: 'company-famous',
    canonicalUrl: 'https://jobs.famous.example/',
    sourceTier: 'OFFICIAL_SITE',
    verificationStatus: 'VERIFIED',
    officialIdentityConfirmed: true,
    confidenceScore: 90,
    lastCheckedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'portal-normal',
    companyId: 'company-normal',
    canonicalUrl: 'https://normal.example/jobs',
    sourceTier: 'OFFICIAL_ATS',
    verificationStatus: 'VERIFIED',
    officialIdentityConfirmed: true,
    confidenceScore: 80,
    lastCheckedAt: null,
  },
  {
    id: 'platform-outside',
    companyId: 'company-outside',
    canonicalUrl: 'https://platform.example/company/1',
    sourceTier: 'PLATFORM_ONLY',
    verificationStatus: 'REVIEW',
    officialIdentityConfirmed: false,
    confidenceScore: 40,
  },
];

test('fixed monitor uses only confirmed official entries and prioritizes curated companies', () => {
  const plan = buildFixedCompanyMonitorPlan({
    registry,
    priorityNames: ['知名公司'],
    companies,
    portals,
    staleDays: 7,
    now: '2026-07-28T00:00:00.000Z',
  });

  assert.equal(plan.searchFallbackAllowed, false);
  assert.deepEqual(plan.companies.map((company) => company.id), [
    'company-famous',
    'company-normal',
  ]);
  assert.deepEqual(plan.companies[0].confirmedCareerPortals.map((item) => item.url), [
    'https://jobs.famous.example/',
  ]);
  assert.equal(plan.skipped.notInRegistry, 1);
});

test('fixed monitor skips recently checked portals during incremental runs', () => {
  const plan = buildFixedCompanyMonitorPlan({
    registry,
    priorityNames: [],
    companies,
    portals: portals.map((portal) => (
      portal.id === 'portal-normal'
        ? { ...portal, lastCheckedAt: '2026-07-27T00:00:00.000Z' }
        : portal
    )),
    staleDays: 7,
    now: '2026-07-28T00:00:00.000Z',
  });

  assert.deepEqual(plan.companies.map((company) => company.id), ['company-famous']);
  assert.equal(plan.skipped.fresh, 1);
});
