import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discoverMarketJobs } from '../src/application/discover-market-jobs.mjs';
import { createJobOpening } from '../src/domain/job-opening.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const NOW = '2026-07-24T00:00:00.000Z';
const INTENT = {
  market: 'CN',
  roleType: 'AI 产品经理',
  industryTags: ['AI', '互联网'],
  freshnessDays: 90,
  targetCount: 20,
};

async function createHarness({
  publishedAt = '2026-07-20T00:00:00.000Z',
  title = 'AI 产品经理',
  status = 'ACTIVE',
  jobDetailUrl = 'https://jobs.example.com/positions/ai-pm',
  blockedOfficial = false,
  searchItems = null,
  finalUrls = {},
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-discovery-'));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  repository.migrate();
  let runSequence = 0;
  let logSequence = 0;
  const dependencies = {
    repository,
    now: () => NOW,
    ids: {
      intent: () => 'intent-ai-pm',
      run: () => `run-${++runSequence}`,
      company: (candidate) => `company-${candidate.company}`,
      portal: (candidate) => `portal-${new URL(candidate.url).hostname}`,
      log: () => `log-${++logSequence}`,
    },
    planningModel: {
      configured: true,
      async generate({ task }) {
        if (task === 'expand_keywords') {
          return {
            primaryRole: 'AI 产品经理',
            terms: ['AI 产品经理'],
            englishTerms: ['AI Product Manager'],
          };
        }
        return {
          queries: [{
            text: '"AI 产品经理" 招聘',
            preferredSources: ['manual'],
            topK: 10,
          }],
        };
      },
    },
    searchSource: {
      async search() {
        return {
          status: 'ok',
          provider: 'manual',
          attempts: [{ provider: 'manual', status: 'ok', networkRequest: false }],
          liveSearchExecuted: false,
          items: searchItems || [
            {
              company: '示例智能科技',
              url: 'https://jobs.example.com/openings',
              confirmedOfficialDomain: 'example.com',
              officialDomainSource: 'manual_verified',
              rank: 1,
            },
            {
              company: '聚合站转载公司',
              url: 'https://aggregator.example/jobs/1',
              rank: 2,
            },
            {
              company: '待复核 ATS 公司',
              url: 'https://tenant.mokahr.example/jobs',
              rank: 3,
            },
          ],
        };
      },
    },
    fetchPage: async (url) => ({
      status: 200,
      finalUrl: finalUrls[url] || url,
      html: '<h1>招聘职位</h1>',
    }),
    verificationAdapter: {
      async inspect({ candidate }) {
        if (candidate.url.includes('aggregator')) {
          return {
            pageType: 'JOB_LIST',
            atsType: '',
            registrableDomain: 'aggregator.example',
            evidence: [{ code: 'aggregator_domain' }],
          };
        }
        if (candidate.url.includes('mokahr')) {
          return {
            pageType: 'JOB_LIST',
            atsType: 'MOKA',
            registrableDomain: 'mokahr.example',
            evidence: [
              { code: 'verified_ats_tenant' },
              { code: 'recruitment_structure' },
              { code: 'apply_action' },
            ],
          };
        }
        return blockedOfficial ? {
          pageType: 'UNKNOWN',
          atsType: '',
          registrableDomain: 'example.com',
          evidence: [
            { code: 'official_domain_match' },
            { code: 'blocked_page' },
          ],
        } : {
          pageType: 'JOB_LIST',
          atsType: '',
          registrableDomain: 'example.com',
          evidence: [
            { code: 'official_domain_match' },
            { code: 'recruitment_structure' },
            { code: 'apply_action' },
            { code: 'official_site_backlink' },
          ],
        };
      },
    },
    jobExtractor: {
      async extract({ company, portal }) {
        return [createJobOpening({
          companyId: company.id,
          careerPortalId: portal.id,
          sourceJobId: 'ai-pm',
          title,
          normalizedTitle: title,
          roleFamily: 'PRODUCT_MANAGEMENT',
          locations: ['上海'],
          publishedAt,
          jobDetailUrl,
          status,
          sourceUrl: jobDetailUrl || 'https://jobs.example.com/openings',
        }, { now: NOW })];
      },
    },
  };
  return { repository, dependencies };
}

test('AI 产品经理 intent stores only jobs from verified portals', async (t) => {
  const { repository, dependencies } = await createHarness();
  t.after(() => repository.close());

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.companiesDiscovered, 3);
  assert.equal(result.portalsVerified, 1);
  assert.equal(result.jobsStored, 1);
  assert.equal(result.reviewRequired, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.liveSearchExecuted, false);
  assert.deepEqual(result.report.searchQueries, ['"AI 产品经理" 招聘']);
  assert.equal(result.report.candidateUrlCount, 3);
  assert.equal(result.report.candidateCompanyCount, 3);
  assert.equal(result.report.officialVerifiedCount, 1);
  assert.equal(result.report.reviewCount, 1);
  assert.equal(result.report.rejectedCount, 1);
  assert.equal(result.report.extractedJobCount, 1);
  assert.deepEqual(result.report.failures, []);
  assert.equal(result.report.quality.officialVerificationRate.numerator, 1);
  assert.equal(result.report.quality.officialVerificationRate.denominator, 3);
  assert.equal(result.report.quality.jobExtractionSuccessRate.value, 1);
  assert.equal(result.report.quality.falsePositiveRate.numerator, 1);
  assert.equal(result.report.quality.averageConfidenceScore.sampleSize, 3);
  assert.equal(repository.listJobOpenings()[0].title, 'AI 产品经理');
  assert.ok(repository.listDiscoveryLogs().some((item) => item.outcome === 'VERIFIED_PORTAL'));
});

test('run report retains provider failure reasons without claiming success', async (t) => {
  const { repository, dependencies } = await createHarness();
  t.after(() => repository.close());
  dependencies.searchSource.search = async () => ({
    status: 'provider_error',
    provider: 'fixture-live',
    attempts: [{
      provider: 'fixture-live',
      status: 'provider_error',
      networkRequest: true,
      error: 'upstream unavailable',
    }],
    error: 'upstream unavailable',
    liveSearchExecuted: true,
    items: [],
  });

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.status, 'FAILED');
  assert.equal(result.liveSearchExecuted, true);
  assert.deepEqual(result.report.failures, [{
    stage: 'search',
    code: 'provider_error',
    provider: 'fixture-live',
    query: '"AI 产品经理" 招聘',
    message: 'upstream unavailable',
  }]);
});

test('rerunning the same fixture is idempotent', async (t) => {
  const { repository, dependencies } = await createHarness();
  t.after(() => repository.close());

  await discoverMarketJobs(INTENT, dependencies);
  await discoverMarketJobs(INTENT, dependencies);

  assert.equal(repository.listCompanies().length, 3);
  assert.equal(repository.listJobOpenings().length, 1);
});

test('unknown publication dates do not satisfy a recent-only result', async (t) => {
  const { repository, dependencies } = await createHarness({ publishedAt: null });
  t.after(() => repository.close());

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.jobsStored, 0);
  assert.ok(repository.listDiscoveryLogs().some((item) => item.outcome === 'NO_RECENT_JOBS'));
});

test('formal results require role relevance, ACTIVE status and a usable job entry', async (t) => {
  const cases = [
    { title: '财务总监' },
    { title: '产品经理' },
    { status: 'CLOSED' },
    { status: 'UNKNOWN' },
    { jobDetailUrl: null },
  ];
  for (const options of cases) {
    const { repository, dependencies } = await createHarness(options);
    t.after(() => repository.close());
    const result = await discoverMarketJobs(INTENT, dependencies);
    assert.equal(result.jobsStored, 0, JSON.stringify(options));
    assert.equal(repository.listJobOpenings().length, 0, JSON.stringify(options));
  }
});

test('access-controlled candidates remain BLOCKED instead of ordinary partial results', async (t) => {
  const { repository, dependencies } = await createHarness({ blockedOfficial: true });
  t.after(() => repository.close());
  const result = await discoverMarketJobs(INTENT, dependencies);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocked, 1);
  assert.equal(result.jobsStored, 0);
});

test('redirect aliases converge on one canonical portal without failing the run', async (t) => {
  const first = 'https://redirect.example/jobs-a';
  const second = 'https://redirect.example/jobs-b';
  const finalUrl = 'https://jobs.example.com/openings';
  const { repository, dependencies } = await createHarness({
    searchItems: [
      {
        company: '示例智能科技',
        url: first,
        confirmedOfficialDomain: 'example.com',
        officialDomainSource: 'manual_verified',
        rank: 1,
      },
      {
        company: '示例智能科技',
        url: second,
        confirmedOfficialDomain: 'example.com',
        officialDomainSource: 'manual_verified',
        rank: 2,
      },
    ],
    finalUrls: { [first]: finalUrl, [second]: finalUrl },
  });
  t.after(() => repository.close());
  const result = await discoverMarketJobs(INTENT, dependencies);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(repository.listCareerPortals().length, 1);
  assert.equal(repository.listJobOpenings().length, 1);
});

test('failures after search preserve whether live search actually executed', async (t) => {
  const { repository, dependencies } = await createHarness();
  t.after(() => repository.close());
  dependencies.searchSource.search = async () => ({
    status: 'ok',
    provider: 'fixture-live',
    attempts: [{ provider: 'fixture-live', status: 'ok', networkRequest: true }],
    liveSearchExecuted: true,
    items: [{
      company: '示例智能科技',
      url: 'https://jobs.example.com/openings',
      confirmedOfficialDomain: 'example.com',
      officialDomainSource: 'manual_verified',
    }],
  });
  dependencies.repository.withTransaction = () => {
    throw new Error('fixture database failure');
  };
  await assert.rejects(
    discoverMarketJobs(INTENT, dependencies),
    (error) => error.liveSearchExecuted === true,
  );
});
