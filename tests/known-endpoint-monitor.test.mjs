import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runKnownEndpointMonitor } from '../src/application/run-known-endpoint-monitor.mjs';
import { createJobOpening } from '../src/domain/job-opening.mjs';
import { MONITORING_NETWORK_REPOSITORY_METHODS } from '../src/ports/job-repository.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const FIRST_CHECK = '2026-07-29T00:00:00.000Z';

test('known endpoint monitor fetches once, persists jobs, and skips unchanged parsing', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ljs-endpoint-monitor-'));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  t.after(() => repository.close());
  repository.migrate();
  repository.upsertCompany({
    id: 'company-1',
    canonicalName: '示例科技',
    chineseName: '示例科技',
    aliases: [],
    primaryOfficialDomain: 'example.com',
    officialDomains: ['example.com'],
    industryTags: ['AI'],
    countryRegion: '中国',
    market: 'CN',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  repository.upsertCareerPortal({
    id: 'portal-1',
    companyId: 'company-1',
    canonicalUrl: 'https://jobs.example.com/campus',
    url: 'https://jobs.example.com/campus',
    registrableDomain: 'example.com',
    atsType: 'Moka',
    pageType: 'JOB_LIST',
    verificationStatus: 'VERIFIED',
    confidenceScore: 90,
    sourceTier: 'OFFICIAL_ATS',
    officialIdentityConfirmed: true,
    hiringAvailability: 'UNKNOWN',
    searchCoverage: 'COMPLETE',
    evidence: [],
    firstSeenAt: '2026-07-01T00:00:00.000Z',
    lastVerifiedAt: '2026-07-01T00:00:00.000Z',
    lastCheckedAt: '2026-07-01T00:00:00.000Z',
  });

  const page = {
    status: 200,
    finalUrl: 'https://jobs.example.com/campus',
    html: '<html><title>2027校园招聘</title><a href="/jobs/1">AI 产品经理</a></html>',
    headers: { etag: '"v1"', lastModified: '' },
  };
  let fetchCount = 0;
  let extractionCount = 0;
  const fetchPage = async () => {
    fetchCount += 1;
    return page;
  };
  const jobExtractor = {
    async extract() {
      extractionCount += 1;
      return [createJobOpening({
        companyId: 'company-1',
        careerPortalId: 'portal-1',
        sourceTier: 'OFFICIAL_ATS',
        sourceJobId: 'job-1',
        title: 'AI 产品经理',
        roleFamily: 'PRODUCT_MANAGEMENT',
        locations: ['上海'],
        employmentType: 'full_time',
        publishedAt: '2026-07-28T00:00:00.000Z',
        jobDetailUrl: 'https://jobs.example.com/jobs/1',
        sourceUrl: 'https://jobs.example.com/jobs/1',
        status: 'ACTIVE',
      }, { now: FIRST_CHECK })];
    },
  };
  const now = () => FIRST_CHECK;

  const first = await runKnownEndpointMonitor({
    repository,
    fetchPage,
    jobExtractor,
    outputDir: path.join(directory, 'output'),
    targetCount: 10,
    includeNotDue: true,
    now,
  });
  const second = await runKnownEndpointMonitor({
    repository,
    fetchPage,
    jobExtractor,
    outputDir: path.join(directory, 'output'),
    targetCount: 10,
    includeNotDue: true,
    now,
  });

  assert.equal(first.counts.SUCCESS, 1);
  assert.equal(first.jobCount, 1);
  assert.equal(second.counts.NOT_MODIFIED, 1);
  assert.equal(fetchCount, 2);
  assert.equal(extractionCount, 1);
  assert.equal(repository.listJobOpenings().length, 1);
  assert.equal(repository.listRecruitmentEvents().length, 1);
  assert.equal(repository.listFetchObservations().length, 2);
  assert.equal(repository.listPageSnapshots().length, 1);
  assert.ok(repository.listJobRevisions().some((revision) => (
    revision.changeType === 'DISCOVERED'
  )));
  const [endpoint] = repository.listSourceEndpoints();
  assert.equal(endpoint.contentHash.length, 64);
  let [policy] = repository.listMonitorPolicies();
  assert.equal(policy.nextDueAt, endpoint.nextCheckAt);
  assert.equal(policy.queueLane, 'PORTAL_MONITOR');

  repository.appendFetchObservation({
    sourceEndpointId: endpoint.id,
    fetchedAt: FIRST_CHECK,
    outcome: 'BLOCKED',
    pageRole: 'JOB_LIST',
    reasonCode: 'HTTP_403_ACCESS_BLOCKED',
  });
  [policy] = repository.listMonitorPolicies();
  assert.equal(policy.queueLane, 'PORTAL_RECOVERY');
  assert.equal(policy.browserAllowed, true);

  repository.appendFetchObservation({
    sourceEndpointId: endpoint.id,
    fetchedAt: FIRST_CHECK,
    outcome: 'SUCCESS',
    pageRole: 'JOB_LIST',
  });
  [policy] = repository.listMonitorPolicies();
  assert.equal(policy.queueLane, 'PORTAL_MONITOR');
  assert.equal(policy.browserAllowed, false);

  const [storedJob] = repository.listJobOpenings();
  const failedReconciliation = repository.reconcileEndpointOpenings({
    sourceEndpointId: endpoint.id,
    seenJobIds: [],
    successful: false,
    observedAt: FIRST_CHECK,
  });
  assert.equal(failedReconciliation.skipped, true);
  assert.equal(repository.listJobOpenings()[0].consecutiveMissingCount, 0);

  for (const observedAt of [
    '2026-07-30T00:00:00.000Z',
    '2026-07-31T00:00:00.000Z',
    '2026-08-01T00:00:00.000Z',
  ]) {
    repository.reconcileEndpointOpenings({
      sourceEndpointId: endpoint.id,
      observationId: repository.listFetchObservations()[0].id,
      seenJobIds: [],
      successful: true,
      missingThreshold: 3,
      observedAt,
    });
  }
  const closedJob = repository.listJobOpenings().find((job) => job.id === storedJob.id);
  assert.equal(closedJob.status, 'CLOSED');
  assert.equal(closedJob.consecutiveMissingCount, 3);
  assert.equal(closedJob.closedEvidence[0].code, 'MISSING_FROM_CONSECUTIVE_SUCCESSFUL_SNAPSHOTS');
});

test('one endpoint failure does not stop later known endpoints', async () => {
  const companies = [
    { id: 'bad-company', canonicalName: '失败公司', market: 'CN' },
    { id: 'good-company', canonicalName: '正常公司', market: 'CN' },
  ];
  const portals = companies.map((company) => ({
    id: `portal-${company.id}`,
    companyId: company.id,
    canonicalUrl: `https://${company.id}.example/jobs`,
    sourceTier: 'OFFICIAL_SITE',
    pageType: 'JOB_LIST',
    verificationStatus: 'VERIFIED',
    hiringAvailability: 'UNKNOWN',
  }));
  const endpoints = companies.map((company) => ({
    id: `endpoint-${company.id}`,
    companyId: company.id,
    careerPortalId: `portal-${company.id}`,
    canonicalUrl: `https://${company.id}.example/jobs`,
    state: 'ACTIVE',
    transport: 'HTTP',
    nextCheckAt: '2026-07-01T00:00:00.000Z',
    consecutiveFailures: 0,
  }));
  const observations = [];
  const repository = Object.fromEntries(
    MONITORING_NETWORK_REPOSITORY_METHODS.map((method) => [method, () => null]),
  );
  Object.assign(repository, {
    listCompanies: () => companies,
    listCareerPortals: () => portals,
    listSourceEndpoints: ({ companyId, careerPortalId } = {}) => endpoints.filter((endpoint) => (
      (!companyId || endpoint.companyId === companyId)
      && (!careerPortalId || endpoint.careerPortalId === careerPortalId)
    )),
    listMonitorPolicies: () => [],
    listReviewTasks: () => [],
    listUserActions: () => [],
    listJobOpenings: () => [],
    listProviderCircuitStates: () => [],
    appendFetchObservation: (observation) => {
      observations.push(observation);
      return { id: `observation-${observations.length}`, ...observation };
    },
    persistCompanySnapshot: () => null,
    listFetchObservations: () => observations,
    listJobRevisions: () => [],
  });

  const report = await runKnownEndpointMonitor({
    repository,
    fetchPage: async (url) => {
      if (url.includes('bad-company')) throw new Error('NETWORK_FAILED');
      return {
        status: 200,
        finalUrl: url,
        html: '<html><title>招聘</title><p>当前暂无开放岗位</p></html>',
      };
    },
    jobExtractor: { extract: async () => [] },
    targetCount: 10,
    includeNotDue: true,
    now: () => FIRST_CHECK,
  });

  assert.equal(report.processedCount, 2);
  assert.equal(report.counts.FAILED, 1);
  assert.equal(report.counts.NO_OPENINGS, 1);
  assert.equal(observations.length, 2);
});
