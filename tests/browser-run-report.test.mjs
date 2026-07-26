import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBrowserRunReport } from '../scripts/company-browser-discovery.mjs';

test('browser run report separates discovery, verification, extraction and missing fields', () => {
  const report = buildBrowserRunReport({
    batch: {
      batchId: 'browser-report',
      status: 'COMPLETE_WITH_ERRORS',
      total: 2,
      succeeded: 1,
      failed: 1,
      pending: 0,
    },
    companyResults: [{
      company: '示例科技',
      query: '示例科技 招聘',
      status: 'COMPLETED',
      officialCandidates: [{ url: 'https://jobs.example.com/openings' }],
      leads: [{ url: 'https://www.liepin.com/company-jobs/1/' }],
      rejected: [{ url: 'https://www.jobui.com/company/1/jobs/' }],
      failures: [],
    }, {
      company: '失败公司',
      query: '失败公司 招聘',
      status: 'FAILED',
      officialCandidates: [],
      leads: [],
      rejected: [],
      failures: [{
        stage: 'search',
        reasonCode: 'search_navigation_failed',
        url: 'https://www.baidu.com/',
        error: 'network failed',
      }],
    }],
    discoveryRuns: [{
      report: {
        portalDecisions: [
          { companyId: 'company-1', sourceTier: 'OFFICIAL_SITE', verificationStatus: 'VERIFIED', confidenceScore: 90, hiringAvailability: 'OPENINGS_FOUND' },
          { companyId: 'company-2', sourceTier: 'PLATFORM_ONLY', verificationStatus: 'REVIEW', confidenceScore: 40, hiringAvailability: 'OPENINGS_FOUND' },
        ],
        extractedJobs: [
          {
            companyId: 'company-1',
            title: 'AI 产品经理',
            locations: ['上海'],
            publishedAt: '2026-07-20T00:00:00.000Z',
            closesAt: null,
            employmentType: 'experienced',
            applyUrl: 'https://jobs.example.com/openings/ai-pm/apply',
          },
          {
            companyId: 'company-1',
            title: '后端开发工程师',
            locations: [],
            publishedAt: null,
            closesAt: null,
            employmentType: null,
            applyUrl: null,
          },
        ],
        failures: [{
          stage: 'page_fetch',
          code: 'FETCH_FAILED',
          url: 'https://jobs.example.com/blocked',
          message: 'page fetch failed',
        }],
      },
    }],
  });

  assert.equal(report.discovery.provider, 'chrome_baidu_visible_search');
  assert.deepEqual(report.discovery.searchQueries, ['示例科技 招聘', '失败公司 招聘']);
  assert.equal(report.discovery.searchResultCount, 3);
  assert.equal(report.discovery.candidateUrlCount, 1);
  assert.equal(report.discovery.candidateCompanyCount, 1);
  assert.equal(report.verification.verified, 1);
  assert.equal(report.verification.pendingReview, 1);
  assert.equal(report.verification.rejected, 0);
  assert.equal(report.quality.platformOnlyAcceptanceCount, 1);
  assert.equal(report.quality.averageOfficialConfidenceScore.value, 90);
  assert.equal(report.quality.officialVerificationRate.denominator, 1);
  assert.equal(report.extraction.companiesWithJobs, 1);
  assert.equal(report.extraction.jobsStored, 2);
  assert.deepEqual(report.fieldCoverage.publishedAt, { present: 1, missing: 1 });
  assert.deepEqual(report.fieldCoverage.closesAt, { present: 0, missing: 2 });
  assert.deepEqual(report.fieldCoverage.location, { present: 1, missing: 1 });
  assert.ok(report.failures.some((item) => item.code === 'FETCH_FAILED'));
  assert.ok(report.failures.some((item) => item.code === 'search_navigation_failed'));
});

test('browser run report does not turn blocked or failed work into an empty success', () => {
  const report = buildBrowserRunReport({
    batch: {
      batchId: 'blocked',
      status: 'COMPLETE_WITH_ERRORS',
      total: 1,
      succeeded: 0,
      failed: 1,
      pending: 0,
    },
    companyResults: [{
      company: '受限公司',
      query: '受限公司 招聘',
      status: 'BLOCKED',
      reasonCode: 'search_challenge_or_access_blocked',
      officialCandidates: [],
      leads: [],
      rejected: [],
      failures: [],
    }],
    discoveryRuns: [],
  });

  assert.equal(report.status, 'COMPLETE_WITH_ERRORS');
  assert.equal(report.discovery.blockedCompanies, 1);
  assert.ok(report.failures.some((item) => item.code === 'search_challenge_or_access_blocked'));
});

test('browser run report explains a zero-query pause caused by an open circuit', () => {
  const report = buildBrowserRunReport({
    batch: {
      batchId: 'circuit-open',
      status: 'PAUSED',
      total: 50,
      succeeded: 0,
      failed: 0,
      deferred: 1,
      pending: 49,
      providerCircuit: {
        provider: 'baidu',
        state: 'OPEN',
        reasonCode: 'search_challenge_or_access_blocked',
        openedAt: '2026-07-26T00:00:00.000Z',
      },
    },
    companyResults: [],
    discoveryRuns: [],
  });

  assert.equal(report.providerCircuit.state, 'OPEN');
  assert.equal(report.batch.deferred, 1);
  assert.equal(report.discovery.searchQueries.length, 0);
  assert.ok(report.failures.some((item) => (
    item.stage === 'circuit_breaker'
      && item.code === 'search_challenge_or_access_blocked'
  )));
});
