import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRecruitmentEvent,
  stableRecruitmentEventId,
} from '../src/domain/recruitment-event.mjs';

const NOW = '2026-07-26T00:00:00.000Z';

test('RecruitmentEvent identity is stable across campaign-name changes', () => {
  const first = stableRecruitmentEventId({
    companyId: 'company-1',
    recruitmentType: 'CAMPUS_FULL_TIME',
    cohort: '2027',
    directoryUrl: 'https://jobs.example.com/campus/2027#jobs',
    campaignName: '2027 Campus Hiring',
  });
  const second = stableRecruitmentEventId({
    companyId: 'company-1',
    recruitmentType: 'CAMPUS_FULL_TIME',
    cohort: '2027',
    directoryUrl: 'https://jobs.example.com/campus/2027',
    campaignName: 'Graduate Programme 2027',
  });
  const otherCohort = stableRecruitmentEventId({
    companyId: 'company-1',
    recruitmentType: 'CAMPUS_FULL_TIME',
    cohort: '2026',
    directoryUrl: 'https://jobs.example.com/campus/2027',
  });

  assert.equal(first, second);
  assert.notEqual(first, otherCohort);
});

test('RecruitmentEvent normalizes auditable event fields', () => {
  const event = createRecruitmentEvent({
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    sourceTier: 'OFFICIAL_ATS',
    recruitmentType: 'CAMPUS_INTERNSHIP',
    cohort: ' 2027 ',
    campaignName: '  2027 暑期实习 ',
    status: 'OPEN',
    startAt: '2026-07-01',
    closesAt: null,
    directoryUrl: 'https://jobs.example.com/campus/internship#positions',
    locations: [' 上海 ', '深圳', '上海'],
    publicationClass: 'EXPLICIT',
  }, { now: NOW });

  assert.equal(event.cohort, '2027');
  assert.equal(event.campaignName, '2027 暑期实习');
  assert.equal(event.directoryUrl, 'https://jobs.example.com/campus/internship');
  assert.deepEqual(event.locations, ['上海', '深圳']);
  assert.equal(event.firstSeenAt, NOW);
  assert.equal(event.lastSeenAt, NOW);
  assert.equal(event.lastVerifiedAt, null);
  assert.ok(Object.isFrozen(event));
});

test('RecruitmentEvent rejects unsupported types and invalid directory URLs', () => {
  assert.throws(() => createRecruitmentEvent({
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    sourceTier: 'OFFICIAL_SITE',
    recruitmentType: 'CONTRACTOR',
    directoryUrl: 'https://jobs.example.com/',
  }), /recruitmentType/);

  assert.throws(() => createRecruitmentEvent({
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    sourceTier: 'OFFICIAL_SITE',
    recruitmentType: 'EXPERIENCED',
    directoryUrl: 'not-a-url',
  }), /directoryUrl/);
});
