import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNewCompanyWatchPlan } from '../src/application/build-new-company-watch-plan.mjs';

test('new company watch prioritizes new and unverified companies before stale confirmed portals', () => {
  const plan = buildNewCompanyWatchPlan({
    watchlist: [
      { company: 'New Company', market: 'CN' },
      { company: 'Unverified Company', market: 'CN', officialDomain: 'unverified.example' },
      { company: 'Confirmed Company', market: 'CN' },
      { company: 'Confirmed Company', market: 'CN' },
    ],
    companies: [
      { id: 'unverified', canonicalName: 'Unverified Company', market: 'CN', officialDomains: ['unverified.example'], updatedAt: '2026-07-01T00:00:00.000Z' },
      { id: 'confirmed', canonicalName: 'Confirmed Company', market: 'CN', officialDomains: ['confirmed.example'], updatedAt: '2026-07-01T00:00:00.000Z' },
    ],
    portals: [{
      companyId: 'confirmed', canonicalUrl: 'https://jobs.confirmed.example/', verificationStatus: 'VERIFIED', officialIdentityConfirmed: true, sourceTier: 'OFFICIAL_SITE', confidenceScore: 90, lastCheckedAt: '2026-07-01T00:00:00.000Z',
    }],
    staleDays: 3,
    now: '2026-07-10T00:00:00.000Z',
  });
  assert.equal(plan.mode, 'NEW_COMPANY_DISCOVERY_AND_MONITOR');
  assert.deepEqual(plan.companies.map((company) => company.watchState), [
    'NEW_COMPANY', 'UNVERIFIED_ENTRY', 'STALE_CONFIRMED_ENTRY',
  ]);
  assert.equal(plan.companies[2].fixedPool, true);
  assert.equal(plan.companies[1].fixedPool, false);
  assert.equal(plan.skipped.duplicateWatchlist, 1);
});

test('new company watch skips fresh existing entries unless explicitly included', () => {
  const base = {
    watchlist: [{ company: 'Fresh Company', market: 'CN' }],
    companies: [{ id: 'fresh', canonicalName: 'Fresh Company', market: 'CN', officialDomains: [], updatedAt: '2026-07-09T00:00:00.000Z' }],
    portals: [], staleDays: 3, now: '2026-07-10T00:00:00.000Z',
  };
  assert.equal(buildNewCompanyWatchPlan(base).selectedCount, 0);
  assert.equal(buildNewCompanyWatchPlan({ ...base, includeFresh: true }).companies[0].watchState, 'UNVERIFIED_FRESH');
});
