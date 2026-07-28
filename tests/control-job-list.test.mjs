import assert from 'node:assert/strict';
import test from 'node:test';

import { buildControlJobList } from '../src/application/build-control-job-list.mjs';

function repository() {
  return {
    listCompanies: () => [
      { id: 'company-1', canonicalName: '示例科技' },
      { id: 'company-2', canonicalName: '候选公司' },
    ],
    listCareerPortals: () => [
      {
        id: 'portal-1',
        companyId: 'company-1',
        canonicalUrl: 'https://jobs.example.com/',
        verificationStatus: 'VERIFIED',
        officialIdentityConfirmed: true,
        pageType: 'JOB_LIST',
        confidenceScore: 82,
      },
      {
        id: 'portal-2',
        companyId: 'company-2',
        canonicalUrl: 'https://platform.example/company/2',
        verificationStatus: 'REVIEW',
        officialIdentityConfirmed: false,
        pageType: 'JOB_LIST',
        confidenceScore: 30,
      },
    ],
    listRecruitmentEvents: () => [{
      id: 'event-1',
      companyId: 'company-1',
      careerPortalId: 'portal-1',
      recruitmentType: 'CAMPUS_FULL_TIME',
      cohort: '2027',
      campaignName: '校园招聘',
      closesAt: '2026-10-31',
      directoryUrl: 'https://jobs.example.com/campus',
    }],
    listJobOpenings: () => [
      {
        id: 'job-1',
        companyId: 'company-1',
        careerPortalId: 'portal-1',
        recruitmentEventId: 'event-1',
        title: 'AI 产品经理',
        roleFamily: 'Product',
        locations: ['上海'],
        employmentType: 'full_time',
        publishedAt: '2026-07-20',
        closesAt: null,
        status: 'ACTIVE',
        sourceTier: 'OFFICIAL_SITE',
        qualityGrade: 'A',
        publicationStatus: 'PUBLISHED',
        applyUrl: 'javascript:alert(1)',
        jobDetailUrl: 'https://jobs.example.com/jobs/1',
        sourceUrl: 'https://jobs.example.com/jobs/1',
        lastSeenAt: '2026-07-28T00:00:00.000Z',
      },
      {
        id: 'job-2',
        companyId: 'company-2',
        careerPortalId: 'portal-2',
        recruitmentEventId: null,
        title: '产品运营',
        locations: ['北京'],
        status: 'ACTIVE',
        sourceTier: 'PLATFORM_ONLY',
        qualityGrade: 'C',
        publicationStatus: 'CANDIDATE',
        sourceUrl: 'https://platform.example/company/2',
      },
    ],
  };
}

test('control job list exposes only verified official openings as actionable links', () => {
  const result = buildControlJobList({ repository: repository() });
  assert.equal(result.total, 2);
  assert.equal(result.counts.actionable, 1);
  assert.equal(result.items[0].company, '示例科技');
  assert.equal(result.items[0].actionUrl, 'https://jobs.example.com/jobs/1');
  assert.equal(result.items[0].closesAt, '2026-10-31');
  assert.equal(result.items[1].actionUrl, null);
  assert.equal(result.items[1].sourceTier, 'PLATFORM_ONLY');
});

test('control job list filters by query, source and publication status', () => {
  const result = buildControlJobList({
    repository: repository(),
    query: '北京',
    sourceTier: 'PLATFORM_ONLY',
    publicationStatus: 'CANDIDATE',
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].title, '产品运营');
  assert.equal(result.counts.platformOnly, 1);
});

test('verified portal does not turn a B-grade review job into an application action', () => {
  const source = repository();
  const original = source.listJobOpenings;
  source.listJobOpenings = () => original().map((job) => (
    job.id === 'job-1'
      ? { ...job, qualityGrade: 'B', publicationStatus: 'REVIEW_REQUIRED' }
      : job
  ));
  const result = buildControlJobList({ repository: source, query: 'AI 产品经理' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].portalStatus, 'VERIFIED');
  assert.equal(result.items[0].actionUrl, null);
  assert.equal(result.counts.actionable, 0);
});
