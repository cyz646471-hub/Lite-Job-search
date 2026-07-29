import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCnAtsCoverageReport } from '../src/application/build-cn-ats-coverage-report.mjs';

test('China ATS priorities are derived from current verified and open coverage', () => {
  const report = buildCnAtsCoverageReport({
    companies: [
      { id: 'cn-1', market: 'CN' },
      { id: 'cn-2', market: 'CN' },
      { id: 'na-1', market: 'NA' },
    ],
    portals: [
      {
        id: 'moka-1',
        companyId: 'cn-1',
        atsType: 'Moka',
        registrableDomain: 'mokahr.com',
        sourceTier: 'OFFICIAL_ATS',
        verificationStatus: 'VERIFIED',
        hiringAvailability: 'OPENINGS_FOUND',
      },
      {
        id: 'zhiye-1',
        companyId: 'cn-2',
        atsType: 'Beisen',
        registrableDomain: 'zhiye.com',
        sourceTier: 'OFFICIAL_ATS',
        verificationStatus: 'REVIEW',
        hiringAvailability: 'UNKNOWN',
      },
      {
        id: 'workday-na',
        companyId: 'na-1',
        atsType: 'Workday',
        registrableDomain: 'myworkdayjobs.com',
        sourceTier: 'OFFICIAL_ATS',
        verificationStatus: 'VERIFIED',
        hiringAvailability: 'OPENINGS_FOUND',
      },
      {
        id: 'ordinary-site',
        companyId: 'cn-2',
        atsType: '',
        registrableDomain: 'example.cn',
        sourceTier: 'OFFICIAL_SITE',
        verificationStatus: 'VERIFIED',
        hiringAvailability: 'OPENINGS_FOUND',
      },
    ],
    sourceEndpoints: [{ id: 'endpoint-1', careerPortalId: 'moka-1' }],
  });

  assert.deepEqual(report.rows.map((row) => row.family), [
    'MOKA',
    'BEISEN_ZHIYE_ITALENT',
  ]);
  assert.equal(report.rows[0].verifiedCompanies, 1);
  assert.equal(report.rows[0].openCompanies, 1);
  assert.equal(report.rows[0].monitoredCompanies, 1);
});
