import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFullFlowQueue,
  isDomesticChinaCompany,
} from '../scripts/prepare-full-database-maintenance.mjs';

test('full-flow queue includes unverified companies and verified portals without formal jobs', () => {
  const queue = buildFullFlowQueue({
    companies: [
      { id: 'missing', canonicalName: '待发现', aliases: [], officialDomains: [] },
      { id: 'extract', canonicalName: '待提取', aliases: [], officialDomains: [] },
      { id: 'complete', canonicalName: '已完成', aliases: [], officialDomains: [] },
    ],
    portals: [
      { companyId: 'extract', verificationStatus: 'VERIFIED', lastCheckedAt: '2026-07-27T00:00:00.000Z' },
      { companyId: 'complete', verificationStatus: 'VERIFIED', lastCheckedAt: '2026-07-27T00:00:00.000Z' },
    ],
    jobs: [
      { companyId: 'complete', title: '产品经理' },
    ],
  });

  assert.deepEqual(queue.map((item) => [item.company, item.maintenanceReasons]), [
    ['待发现', ['OFFICIAL_PORTAL_NOT_VERIFIED']],
    ['待提取', ['NO_FORMAL_JOB_OPENING_RECORDED']],
  ]);
});

test('domestic China scope excludes Global and US companies mislabeled as CN market', () => {
  assert.equal(isDomesticChinaCompany({ market: 'CN', countryRegion: 'China' }), true);
  assert.equal(isDomesticChinaCompany({ market: 'CN', countryRegion: '中国大陆' }), true);
  assert.equal(isDomesticChinaCompany({ market: 'CN', countryRegion: 'Global' }), false);
  assert.equal(isDomesticChinaCompany({ market: 'CN', countryRegion: 'US' }), false);
});
