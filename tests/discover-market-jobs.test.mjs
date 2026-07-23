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

async function createHarness({ publishedAt = '2026-07-20T00:00:00.000Z' } = {}) {
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
          items: [
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
      finalUrl: url,
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
        return {
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
          title: 'AI 产品经理',
          normalizedTitle: 'AI 产品经理',
          roleFamily: 'PRODUCT_MANAGEMENT',
          locations: ['上海'],
          publishedAt,
          jobDetailUrl: 'https://jobs.example.com/positions/ai-pm',
          status: 'ACTIVE',
          sourceUrl: 'https://jobs.example.com/positions/ai-pm',
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
  assert.equal(repository.listJobOpenings()[0].title, 'AI 产品经理');
  assert.ok(repository.listDiscoveryLogs().some((item) => item.outcome === 'VERIFIED_PORTAL'));
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
