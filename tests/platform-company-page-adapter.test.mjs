import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectPlatformCompanyPage,
} from '../src/adapters/platform/company-platform-page-adapter.mjs';

test('exact Liepin company page yields isolated public jobs without official verification', () => {
  const result = inspectPlatformCompanyPage({
    company: '希奥端',
    platform: 'LIEPIN',
    page: {
      status: 200,
      finalUrl: 'https://www.liepin.com/company-jobs/13296749/',
      title: '希奥端招聘',
      h1: '希奥端',
      jobs: [{
        title: '产品经理',
        location: '南京',
        detailUrl: 'https://www.liepin.com/job/123/',
      }],
    },
  });

  assert.equal(result.sourceTier, 'PLATFORM_ONLY');
  assert.equal(result.verificationStatus, 'REVIEW');
  assert.equal(result.officialIdentityConfirmed, false);
  assert.equal(result.platformIdentityConfirmed, true);
  assert.equal(result.confidenceScore, 49);
  assert.equal(result.hiringAvailability, 'OPENINGS_FOUND');
  assert.deepEqual(result.jobs, [{
    title: '产品经理',
    locations: ['南京'],
    publishedAt: null,
    closesAt: null,
    jobDetailUrl: 'https://www.liepin.com/job/123/',
    sourceUrl: 'https://www.liepin.com/job/123/',
  }]);
  assert.ok(Object.isFrozen(result.jobs));
});

test('platform identity mismatch or blocked page emits no jobs', () => {
  const mismatch = inspectPlatformCompanyPage({
    company: '希奥端',
    platform: 'LIEPIN',
    page: {
      status: 200,
      finalUrl: 'https://www.liepin.com/company-jobs/13296749/',
      title: '南京希奥端分公司招聘',
      h1: '南京希奥端分公司',
      jobs: [{ title: '产品经理' }],
    },
  });
  const blocked = inspectPlatformCompanyPage({
    company: '希奥端',
    platform: 'LIEPIN',
    page: {
      status: 403,
      finalUrl: 'https://www.liepin.com/company-jobs/13296749/',
      title: '希奥端招聘',
      jobs: [{ title: '产品经理' }],
    },
  });

  for (const result of [mismatch, blocked]) {
    assert.equal(result.verificationStatus, 'REVIEW');
    assert.equal(result.platformIdentityConfirmed, false);
    assert.equal(result.confidenceScore, 0);
    assert.equal(result.hiringAvailability, 'UNKNOWN');
    assert.deepEqual(result.jobs, []);
  }
});
