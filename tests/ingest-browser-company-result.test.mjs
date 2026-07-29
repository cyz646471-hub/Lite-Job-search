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
  assert.equal(repository.listRecruitmentEvents().length, 1);
  assert.equal(repository.listJobOpenings()[0].title, 'AI 产品经理');
  assert.equal(repository.listJobOpenings()[0].publishedAt, null);
  assert.equal(repository.listJobOpenings()[0].closesAt, null);
  assert.deepEqual(repository.listJobOpenings()[0].locations, ['上海']);
  assert.equal(
    repository.listJobOpenings()[0].applyUrl,
    'https://jobs.example.com/openings/ai-pm/apply',
  );
});

test('browser result bootstraps and persists an empty-domain first-party career site', async (t) => {
  const repository = await createRepository(t);
  const portalUrl = 'https://jobs.mihoyo.com/';
  const result = await ingestBrowserCompanyResult({
    companyResult: {
      company: '米哈游',
      aliases: [],
      officialDomain: '',
      query: '米哈游 招聘',
      status: 'COMPLETED',
      officialCandidates: [{
        classification: 'VERIFICATION_CANDIDATE',
        title: '米哈游招聘',
        url: portalUrl,
        recruitmentType: 'SOCIAL',
      }],
      observations: [{
        requestedUrl: portalUrl,
        finalUrl: portalUrl,
        status: 200,
        title: '米哈游招聘',
        html: '<main><h1>加入米哈游</h1><p>米哈游招聘职位</p><a href="/jobs/pm">产品经理 立即申请</a></main>',
        text: '加入米哈游 米哈游招聘职位 产品经理 立即申请',
        links: [{
          text: '产品经理 立即申请',
          href: 'https://jobs.mihoyo.com/jobs/pm',
        }],
        parsed: { pageRole: 'CAREER_HOME' },
        observedAt: NOW,
        jobs: [{
          sourceJobId: 'pm',
          title: '产品经理',
          employmentType: 'experienced',
          jobDetailUrl: 'https://jobs.mihoyo.com/jobs/pm',
          status: 'ACTIVE',
        }],
      }],
      failures: [],
    },
    role: '公开招聘岗位',
  }, {
    repository,
    now: () => NOW,
  });

  assert.equal(result.jobsStored, 1);
  assert.equal(repository.listCompanies()[0].primaryOfficialDomain, 'mihoyo.com');
  assert.deepEqual(repository.listCompanies()[0].officialDomains, ['mihoyo.com']);
  assert.equal(repository.listCareerPortals()[0].verificationStatus, 'VERIFIED');
  assert.ok(repository.listCareerPortals()[0].evidence.some(
    (item) => item.code === 'domain_bootstrap_confirmed',
  ));
  assert.equal(repository.listJobOpenings().length, 1);
});

test('verified first-party parent authorizes and persists an explicit ATS tenant', async (t) => {
  const repository = await createRepository(t);
  const parentUrl = 'https://www.example.com/careers';
  const atsUrl = 'https://app.mokahr.com/campus-recruitment/example/123';
  const result = await ingestBrowserCompanyResult({
    companyResult: {
      company: '示例科技',
      aliases: [],
      officialDomain: '',
      query: '示例科技 招聘',
      status: 'COMPLETED',
      officialCandidates: [{
        classification: 'VERIFICATION_CANDIDATE',
        title: '示例科技招聘',
        url: parentUrl,
      }],
      observations: [{
        requestedUrl: parentUrl,
        finalUrl: parentUrl,
        status: 200,
        title: '示例科技招聘',
        html: `<main><h1>加入示例科技</h1><a href="${atsUrl}">查看招聘职位</a></main>`,
        text: '加入示例科技 查看招聘职位',
        links: [{
          text: '查看招聘职位',
          href: atsUrl,
        }],
        parsed: { pageRole: 'CAREER_HOME' },
        observedAt: NOW,
        jobs: [],
      }, {
        requestedUrl: atsUrl,
        finalUrl: atsUrl,
        status: 200,
        title: '示例科技招聘职位',
        html: '<main><h1>示例科技招聘职位</h1><a href="/jobs/pm">产品经理 立即申请</a></main>',
        text: '示例科技招聘职位 产品经理 立即申请',
        links: [{
          text: '产品经理 立即申请',
          href: 'https://app.mokahr.com/jobs/pm',
        }],
        parsed: { pageRole: 'JOB_LIST' },
        observedAt: NOW,
        jobs: [{
          sourceJobId: 'ats-pm',
          title: '产品经理',
          employmentType: 'experienced',
          jobDetailUrl: 'https://app.mokahr.com/jobs/pm',
          status: 'ACTIVE',
        }],
      }],
      failures: [],
    },
    role: '公开招聘岗位',
  }, {
    repository,
    now: () => NOW,
  });

  const atsPortal = repository.listCareerPortals()
    .find((portal) => portal.atsType === 'MOKA');
  assert.equal(result.jobsStored, 1);
  assert.ok(atsPortal);
  assert.equal(atsPortal.verificationStatus, 'VERIFIED');
  assert.ok(atsPortal.evidence.some(
    (item) => item.code === 'official_site_confirms_ats_tenant',
  ));
  assert.equal(repository.listJobOpenings()[0].careerPortalId, atsPortal.id);
});

test('direct ATS result without a verified parent remains unverified', async (t) => {
  const repository = await createRepository(t);
  const atsUrl = 'https://app.mokahr.com/campus-recruitment/example/123';
  const result = await ingestBrowserCompanyResult({
    companyResult: {
      company: '示例科技',
      aliases: [],
      officialDomain: '',
      query: '示例科技 招聘',
      status: 'COMPLETED',
      officialCandidates: [{
        classification: 'VERIFICATION_CANDIDATE',
        title: '示例科技招聘',
        url: atsUrl,
      }],
      observations: [{
        requestedUrl: atsUrl,
        finalUrl: atsUrl,
        status: 200,
        title: '示例科技招聘',
        html: '<main><h1>示例科技招聘职位</h1><a href="/jobs/pm">产品经理 立即申请</a></main>',
        text: '示例科技招聘职位 产品经理 立即申请',
        links: [],
        parsed: { pageRole: 'JOB_LIST' },
        observedAt: NOW,
        jobs: [{
          sourceJobId: 'direct-ats-pm',
          title: '产品经理',
          jobDetailUrl: 'https://app.mokahr.com/jobs/pm',
          status: 'ACTIVE',
        }],
      }],
      failures: [],
    },
    role: '公开招聘岗位',
  }, {
    repository,
    now: () => NOW,
  });

  assert.equal(result.jobsStored, 0);
  assert.equal(repository.listJobOpenings().length, 0);
  assert.equal(repository.listCareerPortals()[0].verificationStatus, 'REJECTED');
  assert.ok(repository.listCareerPortals()[0].evidence.some(
    (item) => item.code === 'ats_fingerprint_only',
  ));
  assert.ok(!repository.listCareerPortals()[0].evidence.some(
    (item) => item.code === 'official_site_confirms_ats_tenant',
  ));
});

test('re-evaluates a direct ATS result after a later verified parent attributes it', async (t) => {
  const repository = await createRepository(t);
  const parentUrl = 'https://www.example.com/careers';
  const atsUrl = 'https://app.mokahr.com/campus-recruitment/example/123';
  const result = await ingestBrowserCompanyResult({
    companyResult: {
      company: '示例科技',
      aliases: [],
      officialDomain: '',
      query: '示例科技 招聘',
      status: 'COMPLETED',
      officialCandidates: [{
        classification: 'VERIFICATION_CANDIDATE',
        title: '示例科技 ATS 招聘',
        url: atsUrl,
      }, {
        classification: 'VERIFICATION_CANDIDATE',
        title: '示例科技官网招聘',
        url: parentUrl,
      }],
      observations: [{
        requestedUrl: atsUrl,
        finalUrl: atsUrl,
        status: 200,
        title: '示例科技招聘职位',
        html: '<main><h1>示例科技招聘职位</h1><a href="/jobs/pm">产品经理 立即申请</a></main>',
        text: '示例科技招聘职位 产品经理 立即申请',
        links: [],
        parsed: { pageRole: 'JOB_LIST' },
        observedAt: NOW,
        jobs: [{
          sourceJobId: 'retry-ats-pm',
          title: '产品经理',
          jobDetailUrl: 'https://app.mokahr.com/jobs/pm',
          status: 'ACTIVE',
        }],
      }, {
        requestedUrl: parentUrl,
        finalUrl: parentUrl,
        status: 200,
        title: '示例科技官网招聘',
        html: `<main><h1>加入示例科技</h1><a href="${atsUrl}">查看招聘职位</a></main>`,
        text: '加入示例科技 查看招聘职位',
        links: [{
          text: '查看招聘职位',
          href: atsUrl,
        }],
        parsed: { pageRole: 'CAREER_HOME' },
        observedAt: NOW,
        jobs: [],
      }],
      failures: [],
    },
    role: '公开招聘岗位',
  }, {
    repository,
    now: () => NOW,
  });

  const atsPortal = repository.listCareerPortals()
    .find((portal) => portal.atsType === 'MOKA');
  assert.equal(result.jobsStored, 1);
  assert.equal(atsPortal.verificationStatus, 'VERIFIED');
  assert.ok(atsPortal.evidence.some(
    (item) => item.code === 'official_site_confirms_ats_tenant',
  ));
});

test('rerunning one browser company does not duplicate event or jobs', async (t) => {
  const repository = await createRepository(t);
  const input = {
    companyResult: verifiedCompanyResult(),
    role: '公开招聘岗位',
    industry: ['AI'],
    targetCount: 1000,
  };

  const first = await ingestBrowserCompanyResult(input, {
    repository,
    now: () => NOW,
  });
  const second = await ingestBrowserCompanyResult(input, {
    repository,
    now: () => NOW,
  });

  assert.equal(repository.listRecruitmentEvents().length, 1);
  assert.equal(repository.listJobOpenings().length, 1);
  assert.equal(first.report.extractedJobCount, second.report.extractedJobCount);
});

test('failed browser snapshot leaves no partial formal recruitment chain', async (t) => {
  const repository = await createRepository(t);
  const failingRepository = {
    ...repository,
    persistCompanySnapshot() {
      throw new Error('fixture snapshot failure');
    },
  };

  const result = await ingestBrowserCompanyResult({
    companyResult: verifiedCompanyResult(),
    role: '公开招聘岗位',
    industry: ['AI'],
  }, {
    repository: failingRepository,
    now: () => NOW,
  });

  assert.equal(result.status, 'FAILED');
  assert.equal(result.jobsStored, 0);
  assert.deepEqual(result.report.recruitmentEvents, []);
  assert.deepEqual(result.report.extractedJobs, []);
  assert.ok(result.report.failures.some((failure) => (
    failure.stage === 'company_snapshot_persistence'
      && failure.message.includes('fixture snapshot failure')
  )));
  assert.equal(repository.listCompanies().length, 0);
  assert.equal(repository.listCareerPortals().length, 0);
  assert.equal(repository.listRecruitmentEvents().length, 0);
  assert.equal(repository.listJobOpenings().length, 0);
});

test('rolls back every portal when the second company snapshot fails', async (t) => {
  const repository = await createRepository(t);
  let snapshots = 0;
  const failingRepository = {
    ...repository,
    persistCompanySnapshot(snapshot) {
      snapshots += 1;
      if (snapshots === 2) throw new Error('second portal snapshot failure');
      return repository.persistCompanySnapshot(snapshot);
    },
  };
  const companyResult = verifiedCompanyResult();
  const secondPortalUrl = 'https://jobs.example.com/campus';
  companyResult.officialCandidates.push({
    classification: 'OFFICIAL_CANDIDATE',
    title: '示例科技校园招聘',
    url: secondPortalUrl,
    recruitmentType: 'GRADUATE',
  });
  companyResult.observations.push({
    requestedUrl: secondPortalUrl,
    finalUrl: secondPortalUrl,
    status: 200,
    title: '示例科技校园招聘',
    html: '<h1>校园招聘职位</h1>',
    text: '2027 届校园招聘职位 产品经理',
    links: [],
    officialSiteLinked: true,
    observedAt: NOW,
    vacancyStatus: 'ACTIVE',
    jobs: [{
      sourceJobId: 'campus-pm',
      title: '产品经理（应届）',
      employmentType: 'campus',
      jobDetailUrl: 'https://jobs.example.com/campus/campus-pm',
      status: 'ACTIVE',
    }],
  });

  const result = await ingestBrowserCompanyResult({
    companyResult,
    role: '公开招聘岗位',
  }, {
    repository: failingRepository,
    now: () => NOW,
  });

  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.report.recruitmentEvents, []);
  assert.deepEqual(result.report.extractedJobs, []);
  assert.equal(repository.listCompanies().length, 0);
  assert.equal(repository.listCareerPortals().length, 0);
  assert.equal(repository.listRecruitmentEvents().length, 0);
  assert.equal(repository.listJobOpenings().length, 0);
});

test('extracts an explicit visible job link from a generic official page', async (t) => {
  const repository = await createRepository(t);
  const companyResult = verifiedCompanyResult();
  companyResult.observations[0].jobs = undefined;
  companyResult.observations[0].links = [
    {
      text: 'AI 产品经理',
      href: 'https://jobs.example.com/openings/ai-product-manager',
    },
    {
      text: '社会招聘',
      href: 'https://jobs.example.com/social',
    },
  ];

  const result = await ingestBrowserCompanyResult({
    companyResult,
    role: '公开招聘岗位',
  }, {
    repository,
    now: () => NOW,
  });

  assert.equal(result.jobsStored, 1);
  assert.equal(repository.listJobOpenings()[0].title, 'AI 产品经理');
  assert.equal(
    repository.listJobOpenings()[0].jobDetailUrl,
    'https://jobs.example.com/openings/ai-product-manager',
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

test('persists an isolated platform fallback when no official portal is usable', async (t) => {
  const repository = await createRepository(t);
  const platformUrl = 'https://www.liepin.com/company-jobs/13296749/';
  const jobUrl = 'https://www.liepin.com/job/123/';
  const result = await ingestBrowserCompanyResult({
    companyResult: {
      company: '希奥端',
      query: '希奥端 招聘',
      status: 'COMPLETED',
      officialCandidates: [],
      platformCandidates: [{
        company: '希奥端',
        title: '希奥端招聘',
        url: platformUrl,
        sourceUrl: platformUrl,
        sourceTier: 'PLATFORM_ONLY',
        platform: 'LIEPIN',
        verificationStatus: 'REVIEW',
        officialIdentityConfirmed: false,
        platformIdentityConfirmed: true,
        confidenceScore: 49,
        hiringAvailability: 'OPENINGS_FOUND',
        jobs: [{
          title: '产品经理',
          locations: ['南京'],
          publishedAt: null,
          closesAt: null,
          jobDetailUrl: jobUrl,
          sourceUrl: jobUrl,
        }],
      }],
      observations: [],
      failures: [],
    },
    role: '公开招聘岗位',
  }, {
    repository,
    now: () => NOW,
  });

  assert.equal(result.jobsStored, 1);
  assert.equal(repository.listCompanies().length, 1);
  assert.equal(repository.listCareerPortals().length, 1);
  assert.equal(repository.listCareerPortals()[0].sourceTier, 'PLATFORM_ONLY');
  assert.equal(repository.listCareerPortals()[0].verificationStatus, 'REVIEW');
  assert.equal(repository.listCareerPortals()[0].fallbackReason, 'NO_OFFICIAL_FOUND');
  assert.equal(repository.listRecruitmentEvents()[0].sourceTier, 'PLATFORM_ONLY');
  assert.equal(repository.listRecruitmentEvents()[0].publicationClass, 'PLATFORM_ONLY');
  assert.equal(repository.listJobOpenings()[0].sourceTier, 'PLATFORM_ONLY');
  assert.equal(repository.listJobOpenings()[0].title, '产品经理');
  assert.equal(result.report.quality.platformOnlyAcceptanceCount, 1);
});

test('rolls back official and platform snapshots together when fallback persistence fails', async (t) => {
  const repository = await createRepository(t);
  let snapshotCount = 0;
  const failingRepository = {
    ...repository,
    persistCompanySnapshot(snapshot) {
      snapshotCount += 1;
      if (snapshotCount === 2) throw new Error('platform snapshot failure');
      return repository.persistCompanySnapshot(snapshot);
    },
  };
  const officialUrl = 'https://jobs.example.com/campus';
  const platformUrl = 'https://www.liepin.com/company-jobs/13296749/';
  const result = await ingestBrowserCompanyResult({
    companyResult: {
      company: '希奥端',
      officialDomain: 'example.com',
      query: '希奥端 招聘',
      status: 'COMPLETED',
      officialCandidates: [{
        classification: 'OFFICIAL_CANDIDATE',
        title: '希奥端校园招聘',
        url: officialUrl,
      }],
      platformCandidates: [{
        title: '希奥端招聘',
        url: platformUrl,
        platform: 'LIEPIN',
        platformIdentityConfirmed: true,
        confidenceScore: 49,
        jobs: [{
          title: '产品经理',
          jobDetailUrl: 'https://www.liepin.com/job/123/',
          sourceUrl: 'https://www.liepin.com/job/123/',
        }],
      }],
      observations: [{
        requestedUrl: officialUrl,
        finalUrl: officialUrl,
        status: 200,
        title: '希奥端校园招聘',
        text: '校园招聘 暂无职位',
        html: '<main>校园招聘 暂无职位</main>',
        links: [],
        vacancyStatus: 'NO_OPENINGS',
        observedAt: NOW,
      }],
      failures: [],
    },
    role: '公开招聘岗位',
  }, {
    repository: failingRepository,
    now: () => NOW,
  });

  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.report.recruitmentEvents, []);
  assert.deepEqual(result.report.extractedJobs, []);
  assert.equal(repository.listCompanies().length, 0);
  assert.equal(repository.listCareerPortals().length, 0);
  assert.equal(repository.listRecruitmentEvents().length, 0);
  assert.equal(repository.listJobOpenings().length, 0);
});
