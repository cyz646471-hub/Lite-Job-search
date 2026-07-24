import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ingestBrowserCompanyResult } from '../src/application/ingest-browser-company-result.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const NOW = '2026-07-25T00:00:00.000Z';

async function createRepository(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-browser-ingest-'));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  repository.migrate();
  t.after(() => repository.close());
  return repository;
}

function verifiedCompanyResult() {
  const portalUrl = 'https://jobs.example.com/openings';
  return {
    company: '示例科技',
    aliases: ['Example Tech'],
    officialDomain: 'example.com',
    query: '示例科技 招聘',
    status: 'COMPLETED',
    officialCandidates: [{
      classification: 'OFFICIAL_CANDIDATE',
      title: '示例科技招聘',
      url: portalUrl,
      recruitmentType: 'SOCIAL',
    }],
    observations: [{
      requestedUrl: portalUrl,
      finalUrl: portalUrl,
      status: 200,
      title: '示例科技招聘',
      html: '<h1>招聘职位</h1><a href="/openings/ai-pm/apply">立即申请</a>',
      text: '招聘职位 AI 产品经理 立即申请',
      links: [{
        text: '立即申请',
        href: 'https://jobs.example.com/openings/ai-pm/apply',
      }],
      officialSiteLinked: true,
      observedAt: NOW,
      vacancyStatus: 'ACTIVE',
      jobs: [{
        sourceJobId: 'ai-pm',
        title: 'AI 产品经理',
        location: '上海',
        publishedAt: null,
        closesAt: null,
        employmentType: 'experienced',
        jobDetailUrl: 'https://jobs.example.com/openings/ai-pm',
        applyUrl: 'https://jobs.example.com/openings/ai-pm/apply',
        status: 'ACTIVE',
      }],
    }],
    failures: [],
  };
}

test('browser result verifies portal, extracts explicit jobs and writes SQLite', async (t) => {
  const repository = await createRepository(t);

  const result = await ingestBrowserCompanyResult({
    companyResult: verifiedCompanyResult(),
    role: '公开招聘岗位',
    industry: ['AI'],
    freshnessDays: 90,
    targetCount: 1000,
  }, {
    repository,
    now: () => NOW,
  });

  assert.deepEqual(result.report.searchQueries, ['示例科技 招聘']);
  assert.equal(result.liveSearchExecuted, true);
  assert.equal(repository.listCompanies().length, 1);
  assert.equal(repository.listCareerPortals().length, 1);
  assert.equal(repository.listCareerPortals()[0].verificationStatus, 'VERIFIED');
  assert.deepEqual(repository.listCareerPortals()[0].recruitmentTypes, ['experienced']);
  assert.equal(repository.listJobOpenings().length, 1);
  assert.equal(repository.listJobOpenings()[0].title, 'AI 产品经理');
  assert.equal(repository.listJobOpenings()[0].publishedAt, null);
  assert.equal(repository.listJobOpenings()[0].closesAt, null);
  assert.deepEqual(repository.listJobOpenings()[0].locations, ['上海']);
  assert.equal(
    repository.listJobOpenings()[0].applyUrl,
    'https://jobs.example.com/openings/ai-pm/apply',
  );
});

test('unverified browser candidates never create formal openings', async (t) => {
  const repository = await createRepository(t);
  const portalUrl = 'https://unknown.example/jobs';
  const companyResult = {
    company: '待审核公司',
    officialDomain: '',
    query: '待审核公司 招聘',
    status: 'COMPLETED',
    officialCandidates: [{
      classification: 'VERIFICATION_CANDIDATE',
      title: '待审核公司招聘',
      url: portalUrl,
    }],
    observations: [{
      requestedUrl: portalUrl,
      finalUrl: portalUrl,
      status: 200,
      title: 'Jobs',
      html: '<h1>Open positions</h1><a href="/apply">Apply now</a>',
      text: 'Open positions Apply now',
      links: [{ text: 'Apply now', href: 'https://unknown.example/apply' }],
      observedAt: NOW,
      jobs: [{
        sourceJobId: '1',
        title: 'AI Product Manager',
        status: 'ACTIVE',
        jobDetailUrl: 'https://unknown.example/jobs/1',
      }],
    }],
  };

  const result = await ingestBrowserCompanyResult({
    companyResult,
    role: '公开招聘岗位',
  }, {
    repository,
    now: () => NOW,
  });

  assert.equal(result.jobsStored, 0);
  assert.equal(repository.listJobOpenings().length, 0);
  assert.ok(repository.listCareerPortals().every((portal) => (
    portal.verificationStatus !== 'VERIFIED'
  )));
});
