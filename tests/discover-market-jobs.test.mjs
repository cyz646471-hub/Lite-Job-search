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

const OFFICIAL_SEARCH_ITEM = Object.freeze({
  company: '示例智能科技',
  url: 'https://jobs.example.com/openings',
  confirmedOfficialDomain: 'example.com',
  officialDomainSource: 'manual_verified',
  rank: 1,
});

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
            OFFICIAL_SEARCH_ITEM,
            {
              company: '聚合站转载公司',
              url: 'https://aggregator.example/jobs/1',
              rank: 2,
            },
            {
              company: '已验证 ATS 公司',
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
  assert.equal(result.portalsVerified, 2);
  assert.equal(result.jobsStored, 2);
  assert.equal(result.reviewRequired, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.liveSearchExecuted, false);
  assert.deepEqual(result.report.searchQueries, ['"AI 产品经理" 招聘']);
  assert.equal(result.report.candidateUrlCount, 3);
  assert.equal(result.report.candidateCompanyCount, 3);
  assert.equal(result.report.officialVerifiedCount, 2);
  assert.equal(result.report.reviewCount, 0);
  assert.equal(result.report.rejectedCount, 1);
  assert.equal(result.report.extractedJobCount, 2);
  assert.deepEqual(result.report.failures, []);
  assert.equal(result.report.quality.officialVerificationRate.numerator, 2);
  assert.equal(result.report.quality.officialVerificationRate.denominator, 3);
  assert.equal(result.report.quality.jobExtractionSuccessRate.value, 1);
  assert.equal(result.report.quality.falsePositiveRate.value, null);
  assert.equal(result.report.quality.averageConfidenceScore.sampleSize, 3);
  assert.equal(result.report.candidateUrls.length, 3);
  assert.equal(result.report.candidateCompanies.length, 3);
  assert.equal(result.report.portalDecisions.length, 3);
  assert.equal(result.report.extractedJobs.length, 2);
  assert.ok(result.report.extractedJobs.every((job) => job.title === 'AI 产品经理'));
  assert.ok(repository.listJobOpenings().every((job) => job.title === 'AI 产品经理'));
  assert.equal(repository.listRecruitmentEvents().length, 2);
  assert.ok(repository.listJobOpenings().every((job) => job.recruitmentEventId));
  assert.ok(repository.listDiscoveryLogs().some((item) => item.outcome === 'VERIFIED_PORTAL'));
});

test('groups campus full-time and internship jobs into explicit 2027 events', async (t) => {
  const directoryUrl = 'https://jobs.example.com/campus/2027';
  const { repository, dependencies } = await createHarness({
    searchItems: [{
      ...OFFICIAL_SEARCH_ITEM,
      url: directoryUrl,
    }],
  });
  t.after(() => repository.close());
  dependencies.openingRetention = 'all_observed_active';
  dependencies.fetchPage = async (url) => ({
    status: 200,
    finalUrl: url,
    title: '2027 届校园招聘',
    text: '招聘于 2026年7月1日开放，投递于 2026年9月30日截止。',
    html: '<h1>2027 届校园招聘</h1>',
    links: [],
  });
  dependencies.jobExtractor.extract = async ({ company, portal }) => [
    createJobOpening({
      companyId: company.id,
      careerPortalId: portal.id,
      sourceJobId: 'graduate-ai-pm',
      title: 'AI 产品经理（应届生）',
      employmentType: 'full_time',
      locations: ['上海'],
      status: 'ACTIVE',
      sourceUrl: `${directoryUrl}/positions/graduate-ai-pm`,
      jobDetailUrl: `${directoryUrl}/positions/graduate-ai-pm`,
    }, { now: NOW }),
    createJobOpening({
      companyId: company.id,
      careerPortalId: portal.id,
      sourceJobId: 'intern-ai-pm',
      title: 'AI 产品经理实习生',
      employmentType: 'internship',
      locations: ['深圳'],
      status: 'ACTIVE',
      sourceUrl: `${directoryUrl}/positions/intern-ai-pm`,
      jobDetailUrl: `${directoryUrl}/positions/intern-ai-pm`,
    }, { now: NOW }),
  ];

  await discoverMarketJobs(INTENT, dependencies);

  const events = repository.listRecruitmentEvents();
  assert.equal(events.length, 2);
  assert.deepEqual(
    new Set(events.map((event) => event.recruitmentType)),
    new Set(['CAMPUS_FULL_TIME', 'CAMPUS_INTERNSHIP']),
  );
  assert.ok(events.every((event) => event.cohort === '2027'));
  assert.ok(events.every((event) => event.startAt === '2026-07-01'));
  assert.ok(events.every((event) => event.closesAt === '2026-09-30'));
  assert.ok(events.every((event) => event.directoryUrl === directoryUrl));
  assert.ok(repository.listJobOpenings().every((job) => job.recruitmentEventId));
});

test('inspects sibling recruitment entries and stores their verified jobs', async (t) => {
  const socialUrl = 'https://jobs.example.com/social';
  const campusUrl = 'https://jobs.example.com/campus';
  const internshipUrl = 'https://jobs.example.com/internship';
  const { repository, dependencies } = await createHarness({
    searchItems: [{
      company: '示例智能科技',
      url: socialUrl,
      confirmedOfficialDomain: 'example.com',
      officialDomainSource: 'manual_verified',
      rank: 1,
    }],
  });
  t.after(() => repository.close());
  dependencies.ids.portal = (candidate) => (
    `portal-${new URL(candidate.url).pathname.replace(/\W+/g, '-')}`
  );
  dependencies.fetchPage = async (url) => ({
    status: 200,
    finalUrl: url,
    html: url === socialUrl
      ? `<a href="${campusUrl}">校园招聘</a><a href="${internshipUrl}">实习生招聘</a>`
      : '<h1>招聘职位</h1>',
    links: url === socialUrl
      ? [
        { text: '校园招聘', href: campusUrl },
        { text: '实习生招聘', href: internshipUrl },
      ]
      : [],
  });
  dependencies.jobExtractor.extract = async ({ company, portal }) => {
    if (portal.canonicalUrl === campusUrl) return [];
    return [createJobOpening({
      companyId: company.id,
      careerPortalId: portal.id,
      sourceJobId: portal.canonicalUrl,
      title: INTENT.roleType,
      normalizedTitle: INTENT.roleType,
      roleFamily: 'PRODUCT_MANAGEMENT',
      locations: ['上海'],
      publishedAt: '2026-07-20T00:00:00.000Z',
      jobDetailUrl: `${portal.canonicalUrl}/positions/ai-pm`,
      status: 'ACTIVE',
      sourceUrl: `${portal.canonicalUrl}/positions/ai-pm`,
    }, { now: NOW })];
  };

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.portalsVerified, 3);
  assert.equal(result.jobsStored, 2);
  assert.equal(repository.listCareerPortals().length, 3);
  assert.equal(repository.listJobOpenings().length, 2);
  assert.equal(repository.listRecruitmentEvents().length, 2);
  assert.ok(repository.listDiscoveryLogs().some((item) => (
    item.metadata.parentUrl === socialUrl
  )));
  assert.equal(result.report.recruitmentEntryInspectionCount, 3);
});

test('reports explicit no-opening recruitment entries without fabricating jobs', async (t) => {
  const socialUrl = 'https://jobs.example.com/social';
  const campusUrl = 'https://jobs.example.com/campus';
  const { repository, dependencies } = await createHarness({
    searchItems: [{
      company: '示例智能科技',
      url: socialUrl,
      confirmedOfficialDomain: 'example.com',
      officialDomainSource: 'manual_verified',
      rank: 1,
    }],
  });
  t.after(() => repository.close());
  dependencies.ids.portal = (candidate) => (
    `portal-${new URL(candidate.url).pathname.replace(/\W+/g, '-')}`
  );
  dependencies.fetchPage = async (url) => ({
    status: 200,
    finalUrl: url,
    html: url === socialUrl
      ? `<a href="${campusUrl}">校园招聘</a>`
      : '<p>暂无职位</p>',
    links: url === socialUrl
      ? [{ text: '校园招聘', href: campusUrl }]
      : [],
  });
  dependencies.verificationAdapter.inspect = async ({ candidate }) => ({
    pageType: 'JOB_LIST',
    atsType: '',
    registrableDomain: 'example.com',
    vacancyStatus: candidate.url === campusUrl ? 'NO_OPENINGS' : 'UNKNOWN',
    evidence: [
      { code: 'official_domain_match' },
      { code: 'recruitment_structure' },
      { code: 'apply_action' },
      { code: 'official_site_backlink' },
    ],
  });
  const extractionUrls = [];
  dependencies.jobExtractor.extract = async ({ portal }) => {
    extractionUrls.push(portal.canonicalUrl);
    return [];
  };

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.jobsStored, 0);
  assert.equal(result.report.noOpeningRecruitmentEntryCount, 1);
  assert.equal(result.report.unknownRecruitmentEntryCount, 1);
  assert.equal(repository.listRecruitmentEvents().length, 0);
  assert.equal(
    repository.listCareerPortals()
      .find((portal) => portal.canonicalUrl === campusUrl)
      .hiringAvailability,
    'NO_OPENINGS',
  );
  assert.deepEqual(extractionUrls, [socialUrl]);
  assert.ok(repository.listDiscoveryLogs().some((item) => (
    item.resultUrl === campusUrl
    && item.metadata.vacancyStatus === 'NO_OPENINGS'
  )));
});

test('reports active recruiting even when openings do not match the requested role', async (t) => {
  const { repository, dependencies } = await createHarness({
    title: '财务总监',
    searchItems: [OFFICIAL_SEARCH_ITEM],
  });
  t.after(() => repository.close());

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.jobsStored, 0);
  assert.equal(result.report.activeRecruitmentEntryCount, 1);
  assert.ok(repository.listDiscoveryLogs().some((item) => (
    item.metadata.vacancyStatus === 'ACTIVE'
    && item.metadata.reason === 'no_requested_role_jobs'
  )));
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

test('direct API returns a structured NOT_CONFIGURED report for a missing planner', async (t) => {
  const { repository, dependencies } = await createHarness();
  t.after(() => repository.close());
  dependencies.planningModel = { configured: false };
  dependencies.searchSource.search = async () => {
    throw new Error('search must not run');
  };

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.status, 'NOT_CONFIGURED');
  assert.equal(result.liveSearchExecuted, false);
  assert.equal(result.report.candidateUrlCount, 0);
  assert.equal(result.report.extractedJobCount, 0);
  assert.equal(result.report.failures[0].stage, 'configuration');
  assert.equal(result.report.failures[0].code, 'NOT_CONFIGURED');
});

test('rerunning the same fixture is idempotent', async (t) => {
  const { repository, dependencies } = await createHarness();
  t.after(() => repository.close());

  await discoverMarketJobs(INTENT, dependencies);
  await discoverMarketJobs(INTENT, dependencies);

  assert.equal(repository.listCompanies().length, 3);
  assert.equal(repository.listJobOpenings().length, 2);
});

test('unknown publication dates do not satisfy a recent-only result', async (t) => {
  const { repository, dependencies } = await createHarness({ publishedAt: null });
  t.after(() => repository.close());

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.jobsStored, 0);
  assert.ok(repository.listDiscoveryLogs().some((item) => item.outcome === 'NO_RECENT_JOBS'));
});

test('browser production retains active openings with blank optional fields', async (t) => {
  const { repository, dependencies } = await createHarness({
    publishedAt: null,
    title: 'Backend Engineer',
    searchItems: [OFFICIAL_SEARCH_ITEM],
  });
  t.after(() => repository.close());
  dependencies.openingRetention = 'all_observed_active';

  const result = await discoverMarketJobs(INTENT, dependencies);
  const [opening] = repository.listJobOpenings();

  assert.equal(result.jobsStored, 1);
  assert.equal(opening.title, 'Backend Engineer');
  assert.equal(opening.publishedAt, null);
  assert.equal(opening.closesAt, null);
  assert.equal(opening.locations.length, 1);
  const logs = repository.listDiscoveryLogs();
  assert.ok(logs.some((log) => (
    log.metadata.missingFields?.includes('publishedAt')
    && log.metadata.missingFields?.includes('closesAt')
    && log.metadata.missingFields?.includes('recruitmentType')
    && log.metadata.missingFields?.includes('applyUrl')
  )), JSON.stringify(logs));
});

test('default discovery still rejects unknown-date and role-mismatch openings', async (t) => {
  const { repository, dependencies } = await createHarness({
    publishedAt: null,
    title: 'Backend Engineer',
  });
  t.after(() => repository.close());

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.jobsStored, 0);
  assert.equal(repository.listJobOpenings().length, 0);
});

test('location filter excludes openings outside the requested region', async (t) => {
  const { repository, dependencies } = await createHarness();
  t.after(() => repository.close());
  const result = await discoverMarketJobs({
    ...INTENT,
    location: '北京',
  }, dependencies);

  assert.equal(result.jobsStored, 0);
  assert.ok(repository.listDiscoveryLogs().some((item) => (
    item.metadata.reason === 'location_mismatch'
  )));
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
  const { repository, dependencies } = await createHarness({
    blockedOfficial: true,
    searchItems: [OFFICIAL_SEARCH_ITEM],
  });
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
  assert.equal(result.portalsVerified, 1);
  assert.equal(result.jobsStored, 1);
  assert.equal(result.report.quality.officialVerificationRate.denominator, 1);
});

test('later rejection of a canonical portal reconciles report counters with storage', async (t) => {
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
  dependencies.verificationAdapter.inspect = async ({ candidate }) => (
    candidate.url === second
      ? {
        pageType: 'JOB_LIST',
        atsType: '',
        registrableDomain: 'example.com',
        evidence: [{ code: 'aggregator_domain' }],
      }
      : {
        pageType: 'JOB_LIST',
        atsType: '',
        registrableDomain: 'example.com',
        evidence: [
          { code: 'official_domain_match' },
          { code: 'recruitment_structure' },
          { code: 'apply_action' },
          { code: 'official_site_backlink' },
        ],
      }
  );

  const result = await discoverMarketJobs(INTENT, dependencies);

  assert.equal(result.portalsVerified, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.jobsStored, 0);
  assert.equal(repository.listCareerPortals()[0].verificationStatus, 'REJECTED');
  assert.equal(repository.listJobOpenings().length, 0);
  assert.equal(result.report.portalDecisions.length, 1);
  assert.equal(result.report.portalDecisions[0].verificationStatus, 'REJECTED');
  assert.deepEqual(result.report.extractedJobs, []);
  assert.equal(result.report.quality.officialVerificationRate.value, 0);
  assert.equal(result.report.quality.jobExtractionSuccessRate.denominator, 0);
  assert.equal(result.report.quality.jobExtractionSuccessRate.value, null);
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
  const result = await discoverMarketJobs(INTENT, dependencies);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.liveSearchExecuted, true);
  assert.equal(result.report.candidateUrls.length, 1);
  assert.equal(result.report.candidateCompanies.length, 1);
  assert.equal(result.report.providerAttempts.length, 1);
  assert.equal(result.report.failures.at(-1).code, 'FAILED');
});
