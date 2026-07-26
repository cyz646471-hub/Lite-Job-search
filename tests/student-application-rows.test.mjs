import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStudentApplicationRows } from '../src/application/build-student-application-rows.mjs';

const company = {
  id: 'company-1',
  canonicalName: '示例科技',
  industryTags: ['AI', '互联网'],
};
const portal = {
  id: 'portal-1',
  companyId: 'company-1',
  sourceTier: 'OFFICIAL_SITE',
  verificationStatus: 'VERIFIED',
  supersededByPortalId: null,
  lastVerifiedAt: '2026-07-26T00:00:00.000Z',
};
const event = {
  id: 'event-1',
  companyId: 'company-1',
  careerPortalId: 'portal-1',
  sourceTier: 'OFFICIAL_SITE',
  recruitmentType: 'CAMPUS_FULL_TIME',
  cohort: '2027',
  campaignName: null,
  startAt: '2026-07-01T00:00:00.000Z',
  closesAt: null,
  locations: ['上海'],
  directoryUrl: 'https://jobs.example.com/campus/2027',
  status: 'OPEN',
  lastVerifiedAt: '2026-07-26T00:00:00.000Z',
};
const job = {
  id: 'job-1',
  companyId: 'company-1',
  careerPortalId: 'portal-1',
  recruitmentEventId: 'event-1',
  sourceTier: 'OFFICIAL_SITE',
  title: '产品经理',
  locations: ['上海', '北京'],
  status: 'ACTIVE',
};

test('student rows group jobs by event and use the event directory URL', () => {
  const rows = buildStudentApplicationRows({
    companies: [company],
    portals: [portal],
    events: [event],
    jobs: [
      job,
      { ...job, id: 'job-2', title: 'AI 产品经理', locations: ['北京'] },
      { ...job, id: 'job-3', title: '产品经理', locations: ['上海'] },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].开放岗位, 'AI 产品经理；产品经理');
  assert.equal(rows[0].地区, '上海、北京');
  assert.equal(rows[0].投递链接, event.directoryUrl);
  assert.equal(rows[0].招聘批次, '2027 届校园招聘');
  assert.equal(rows[0].公司类型, 'AI、互联网');
  assert.equal(rows[0].公司简介, '');
  assert.equal(rows[0].截止时间, '');
});

test('student rows hide a platform event superseded by an official portal', () => {
  const platformPortal = {
    ...portal,
    id: 'portal-platform',
    sourceTier: 'PLATFORM_ONLY',
    verificationStatus: 'REVIEW',
    supersededByPortalId: 'portal-1',
  };
  const platformEvent = {
    ...event,
    id: 'event-platform',
    careerPortalId: 'portal-platform',
    sourceTier: 'PLATFORM_ONLY',
    directoryUrl: 'https://www.liepin.com/company-jobs/1/',
  };

  const rows = buildStudentApplicationRows({
    companies: [company],
    portals: [platformPortal, portal],
    events: [platformEvent, event],
    jobs: [
      { ...job, id: 'job-platform', careerPortalId: 'portal-platform', recruitmentEventId: 'event-platform', sourceTier: 'PLATFORM_ONLY' },
      job,
    ],
  });

  assert.deepEqual(rows.map((row) => row.来源等级), ['OFFICIAL_SITE']);
});

test('student rows retain events with blank unknown fields', () => {
  const rows = buildStudentApplicationRows({
    companies: [{ ...company, industryTags: [] }],
    portals: [portal],
    events: [{ ...event, startAt: null, closesAt: null, locations: [] }],
    jobs: [],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].开始时间, '');
  assert.equal(rows[0].截止时间, '');
  assert.equal(rows[0].地区, '');
  assert.equal(rows[0].开放岗位, '');
  assert.equal(rows[0].公司类型, '');
});
