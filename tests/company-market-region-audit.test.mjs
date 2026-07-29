import assert from 'node:assert/strict';
import test from 'node:test';

import { chinaRecruitmentDisposition } from '../scripts/audit-company-market-regions.mjs';

test('region audit keeps market semantics and requires China evidence for foreign headquarters', () => {
  assert.equal(chinaRecruitmentDisposition('China'), 'DOMESTIC_COMPANY_PRIORITY');
  assert.equal(chinaRecruitmentDisposition('US'), 'REQUIRE_CHINA_RECRUITMENT_EVIDENCE');
  assert.equal(chinaRecruitmentDisposition('Global'), 'REQUIRE_CHINA_RECRUITMENT_EVIDENCE');
});
