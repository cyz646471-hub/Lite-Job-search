import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonitoringNetworkPlan } from '../src/application/build-monitoring-network-plan.mjs';

const NOW = '2026-07-29T00:00:00.000Z';

function company(id, name) {
  return {
    id,
    canonicalName: name,
    market: 'CN',
    countryRegion: '中国',
    officialDomains: [],
  };
}

test('search circuit isolates market discovery but not known portal monitoring', () => {
  const plan = buildMonitoringNetworkPlan({
    companies: [
      company('company-known', '已知入口公司'),
      company('company-missing', '待发现公司'),
    ],
    portals: [{
      id: 'portal-1',
      companyId: 'company-known',
      verificationStatus: 'VERIFIED',
      sourceTier: 'OFFICIAL_ATS',
      hiringAvailability: 'OPENINGS_FOUND',
      canonicalUrl: 'https://known.example/jobs',
    }],
    sourceEndpoints: [{
      id: 'endpoint-1',
      companyId: 'company-known',
      careerPortalId: 'portal-1',
      canonicalUrl: 'https://known.example/jobs',
      state: 'ACTIVE',
      transport: 'ATS_ADAPTER',
      nextCheckAt: '2026-07-28T00:00:00.000Z',
      consecutiveFailures: 0,
    }],
    monitorPolicies: [{
      enabled: true,
      targetType: 'SOURCE_ENDPOINT',
      targetId: 'endpoint-1',
      queueLane: 'PORTAL_MONITOR',
      priority: 90,
      nextDueAt: '2026-08-10T00:00:00.000Z',
      searchAllowed: false,
      browserAllowed: false,
    }],
    providerCircuits: [{ provider: 'google', state: 'OPEN' }],
    searchEngine: 'google',
    targetCount: 20,
    now: NOW,
  });

  const [monitor] = plan.queues.PORTAL_MONITOR;
  const [discovery] = plan.queues.MARKET_DISCOVERY;
  assert.equal(monitor.companyId, 'company-known');
  assert.equal(monitor.runnable, true);
  assert.equal(monitor.nextDueAt, '2026-07-28T00:00:00.000Z');
  assert.equal(discovery.companyId, 'company-missing');
  assert.equal(discovery.runnable, false);
  assert.equal(discovery.deferReason, 'PROVIDER_CIRCUIT_OPEN');
});
