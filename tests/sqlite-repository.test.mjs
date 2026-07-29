import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { assertMarketDiscoveryRepository } from '../src/ports/job-repository.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const NOW = '2026-07-24T00:00:00.000Z';

function createCompany(overrides = {}) {
  return {
    id: 'company-1',
    canonicalName: '示例科技',
    aliases: ['示例'],
    primaryOfficialDomain: 'example.com',
    officialDomains: ['example.com'],
    industryTags: ['AI'],
    market: 'CN',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createPortal(overrides = {}) {
  return {
    id: 'portal-1',
    companyId: 'company-1',
    canonicalUrl: 'https://jobs.example.com/',
    url: 'https://jobs.example.com/',
    registrableDomain: 'example.com',
    atsType: '',
    pageType: 'JOB_LIST',
    verificationStatus: 'VERIFIED',
    confidenceScore: 80,
    evidence: [],
    firstSeenAt: NOW,
    lastVerifiedAt: NOW,
    ...overrides,
  };
}

function createOpening(overrides = {}) {
  return {
    id: 'job-1',
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    sourceJobId: '1',
    title: 'AI 产品经理',
    normalizedTitle: 'ai 产品经理',
    roleFamily: 'PRODUCT_MANAGEMENT',
    locations: ['上海'],
    employmentType: 'full_time',
    publishedAt: '2026-07-20T00:00:00.000Z',
    closesAt: null,
    jobDetailUrl: 'https://jobs.example.com/1',
    applyUrl: null,
    status: 'ACTIVE',
    sourceUrl: 'https://jobs.example.com/1',
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    ...overrides,
  };
}

function createEvent(overrides = {}) {
  return {
    id: 'event-1',
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    sourceTier: 'OFFICIAL_SITE',
    recruitmentType: 'CAMPUS_FULL_TIME',
    cohort: '2027',
    campaignName: '2027 Campus Hiring',
    status: 'OPEN',
    startAt: '2026-07-01',
    closesAt: null,
    directoryUrl: 'https://jobs.example.com/campus/2027',
    locations: ['上海'],
    publicationClass: 'EXPLICIT',
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    lastVerifiedAt: NOW,
    ...overrides,
  };
}

async function createRepository(prefix = 'lite-job-market-') {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  assertMarketDiscoveryRepository(repository);
  repository.migrate();
  return repository;
}

test('additive database migrations are idempotent', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());
  assert.doesNotThrow(() => repository.migrate());
});

test('migration upgrades a database created by the original schema', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-legacy-schema-'));
  const file = path.join(directory, 'jobs.sqlite');
  const legacy = new Database(file);
  legacy.exec(await readFile(new URL('../src/storage/migrations/001-market-discovery.sql', import.meta.url), 'utf8'));
  legacy.close();

  const repository = openSqliteMarketDiscoveryRepository({ file });
  t.after(() => repository.close());
  assert.doesNotThrow(() => repository.migrate());
  repository.upsertCompany(createCompany());
  assert.equal(repository.listCompanies()[0].chineseName, null);
  assert.deepEqual(repository.listBatchItems('missing-batch'), []);
  assert.deepEqual(repository.listRecruitmentEvents(), []);
});

test('repository persists an official recruitment event snapshot atomically', async (t) => {
  const repository = await createRepository('lite-job-market-event-');
  t.after(() => repository.close());

  repository.persistCompanySnapshot({
    company: createCompany(),
    portal: createPortal({
      sourceTier: 'OFFICIAL_SITE',
      officialIdentityConfirmed: true,
      hiringAvailability: 'OPENINGS_FOUND',
      searchCoverage: 'COMPLETE',
      lastCheckedAt: NOW,
    }),
    evidence: [],
    events: [createEvent()],
    openings: [createOpening({
      recruitmentEventId: 'event-1',
      sourceTier: 'OFFICIAL_SITE',
    })],
  });

  assert.equal(repository.listCompanies().length, 1);
  assert.equal(repository.listCareerPortals()[0].sourceTier, 'OFFICIAL_SITE');
  assert.equal(repository.listRecruitmentEvents().length, 1);
  const [opening] = repository.listJobOpenings();
  assert.equal(opening.recruitmentEventId, 'event-1');
  assert.equal(opening.qualityGrade, 'A');
  assert.equal(opening.publicationStatus, 'PUBLISHED');
});

test('repository persists official WeChat recruitment channel metadata and formal records', async (t) => {
  const repository = await createRepository('lite-job-social-');
  t.after(() => repository.close());
  repository.upsertCompany(createCompany());
  const portal = createPortal({
    id: 'portal-social',
    canonicalUrl: 'https://mp.weixin.qq.com/s/example',
    url: 'https://mp.weixin.qq.com/s/example',
    registrableDomain: 'weixin.qq.com',
    pageType: 'CAMPAIGN',
    sourceTier: 'OFFICIAL_SOCIAL',
    channelType: 'WECHAT_OFFICIAL_ACCOUNT',
    officialIdentityConfirmed: true,
    officialAccountName: '示例科技招聘',
    officialAccountId: 'example-careers',
    verifiedSubject: '示例科技有限公司',
  });
  repository.upsertCareerPortal(portal);
  const event = createEvent({
    id: 'event-social',
    careerPortalId: portal.id,
    sourceTier: 'OFFICIAL_SOCIAL',
    directoryUrl: portal.canonicalUrl,
  });
  repository.upsertRecruitmentEvent(event);
  repository.upsertJobOpening(createOpening({
    id: 'job-social',
    careerPortalId: portal.id,
    recruitmentEventId: event.id,
    sourceTier: 'OFFICIAL_SOCIAL',
    sourceUrl: portal.canonicalUrl,
    jobDetailUrl: portal.canonicalUrl,
  }));

  const stored = repository.listCareerPortals()[0];
  assert.equal(stored.channelType, 'WECHAT_OFFICIAL_ACCOUNT');
  assert.equal(stored.officialAccountId, 'example-careers');
  assert.equal(stored.verifiedSubject, '示例科技有限公司');
  assert.equal(repository.listRecruitmentEvents()[0].sourceTier, 'OFFICIAL_SOCIAL');
  assert.equal(repository.listJobOpenings()[0].sourceTier, 'OFFICIAL_SOCIAL');
});

test('repository isolates platform-only events and openings', async (t) => {
  const repository = await createRepository('lite-job-market-platform-');
  t.after(() => repository.close());
  repository.upsertCompany(createCompany());
  repository.upsertCareerPortal(createPortal({
    id: 'portal-platform',
    canonicalUrl: 'https://www.liepin.com/company-jobs/123/',
    url: 'https://www.liepin.com/company-jobs/123/',
    registrableDomain: 'liepin.com',
    sourceTier: 'PLATFORM_ONLY',
    officialIdentityConfirmed: false,
    platformIdentityConfirmed: true,
    hiringAvailability: 'OPENINGS_FOUND',
    fallbackReason: 'NO_OFFICIAL_FOUND',
    searchCoverage: 'COMPLETE',
    verificationStatus: 'REVIEW',
    confidenceScore: 40,
  }));
  repository.upsertRecruitmentEvent(createEvent({
    id: 'event-platform',
    careerPortalId: 'portal-platform',
    sourceTier: 'PLATFORM_ONLY',
    recruitmentType: 'EXPERIENCED',
    cohort: null,
    campaignName: '',
    directoryUrl: 'https://www.liepin.com/company-jobs/123/',
    publicationClass: 'PLATFORM_ONLY',
  }));
  repository.upsertPlatformJobOpening(createOpening({
    id: 'job-platform',
    careerPortalId: 'portal-platform',
    recruitmentEventId: 'event-platform',
    sourceTier: 'PLATFORM_ONLY',
    sourceUrl: 'https://www.liepin.com/company-jobs/123/',
    jobDetailUrl: null,
  }));

  assert.equal(repository.listRecruitmentEvents()[0].sourceTier, 'PLATFORM_ONLY');
  const [platformOpening] = repository.listJobOpenings();
  assert.equal(platformOpening.sourceTier, 'PLATFORM_ONLY');
  assert.equal(platformOpening.qualityGrade, 'C');
  assert.equal(platformOpening.publicationStatus, 'REVIEW_REQUIRED');
  assert.deepEqual(repository.listReviewTasks({
    targetType: 'JOB_OPENING',
    targetId: 'job-platform',
  }).map((task) => task.reasonCodes), [['PLATFORM_ONLY_SOURCE']]);
  assert.throws(() => repository.upsertCareerPortal(createPortal({
    id: 'portal-platform-invalid',
    canonicalUrl: 'https://www.liepin.com/company-jobs/456/',
    url: 'https://www.liepin.com/company-jobs/456/',
    registrableDomain: 'liepin.com',
    sourceTier: 'PLATFORM_ONLY',
    platformIdentityConfirmed: true,
    verificationStatus: 'VERIFIED',
    confidenceScore: 49,
  })), /PLATFORM_ONLY.*VERIFIED/);
  assert.throws(() => repository.upsertPlatformJobOpening(createOpening({
    id: 'job-platform-invalid',
    careerPortalId: 'portal-platform',
    recruitmentEventId: 'event-platform',
    sourceTier: 'OFFICIAL_SITE',
  })), /PLATFORM_ONLY/);
});

test('repository persists job assignments and user actions with re-verification review', async (t) => {
  const repository = await createRepository('lite-job-product-loop-');
  t.after(() => repository.close());
  repository.persistCompanySnapshot({
    company: createCompany(),
    portal: createPortal({
      sourceTier: 'OFFICIAL_SITE',
      officialIdentityConfirmed: true,
      hiringAvailability: 'OPENINGS_FOUND',
      searchCoverage: 'COMPLETE',
      lastCheckedAt: NOW,
    }),
    evidence: [],
    events: [createEvent()],
    openings: [createOpening({
      recruitmentEventId: 'event-1',
      sourceTier: 'OFFICIAL_SITE',
    })],
  });

  const assignment = repository.upsertJobAssignment({
    id: 'assignment-1',
    jobId: 'job-1',
    assigneeType: 'STUDENT',
    assigneeId: 'student-1',
    assignedBy: 'planner-1',
    note: '重点跟进',
    assignedAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(assignment.assigneeId, 'student-1');
  assert.equal(repository.listJobAssignments({ assigneeId: 'student-1' }).length, 1);

  repository.appendUserAction({
    id: 'action-1',
    actorId: 'student-1',
    studentId: 'student-1',
    jobId: 'job-1',
    actionType: 'REPORT_INVALID',
    note: '链接已失效',
    createdAt: NOW,
  });
  assert.equal(repository.listUserActions({ jobId: 'job-1' })[0].triggersReverification, true);
  assert.deepEqual(repository.listReviewTasks({
    targetType: 'JOB_OPENING',
    targetId: 'job-1',
  }).map((task) => task.reviewType), ['DATA_COMPLETENESS']);
});

test('publication re-evaluation closes review and student assignment requires A grade', async (t) => {
  const repository = await createRepository('lite-job-publication-review-');
  t.after(() => repository.close());
  repository.persistCompanySnapshot({
    company: createCompany(),
    portal: createPortal({
      sourceTier: 'OFFICIAL_SITE',
      officialIdentityConfirmed: true,
      hiringAvailability: 'OPENINGS_FOUND',
      lastCheckedAt: NOW,
    }),
    events: [createEvent({ locations: [] })],
    openings: [createOpening({
      recruitmentEventId: 'event-1',
      sourceTier: 'OFFICIAL_SITE',
      locations: [],
    })],
  });
  assert.equal(repository.listJobOpenings()[0].qualityGrade, 'B');
  assert.throws(() => repository.upsertJobAssignment({
    jobId: 'job-1',
    assigneeType: 'STUDENT',
    assigneeId: 'student-1',
    assignedBy: 'planner-1',
  }), /A-grade/);

  repository.persistCompanySnapshot({
    company: createCompany(),
    portal: createPortal({
      sourceTier: 'OFFICIAL_SITE',
      officialIdentityConfirmed: true,
      hiringAvailability: 'OPENINGS_FOUND',
      lastCheckedAt: NOW,
    }),
    events: [createEvent({ locations: ['上海'] })],
    openings: [createOpening({
      recruitmentEventId: 'event-1',
      sourceTier: 'OFFICIAL_SITE',
      locations: ['上海'],
    })],
  });
  assert.equal(repository.listJobOpenings()[0].qualityGrade, 'A');
  assert.equal(repository.listReviewTasks({
    targetType: 'JOB_OPENING',
    targetId: 'job-1',
  })[0].status, 'RESOLVED');
  assert.doesNotThrow(() => repository.upsertJobAssignment({
    jobId: 'job-1',
    assigneeType: 'STUDENT',
    assigneeId: 'student-1',
    assignedBy: 'planner-1',
  }));
});

test('company snapshot rolls back every row when an opening violates its event', async (t) => {
  const repository = await createRepository('lite-job-market-rollback-');
  t.after(() => repository.close());

  assert.throws(() => repository.persistCompanySnapshot({
    company: createCompany(),
    portal: createPortal({
      sourceTier: 'OFFICIAL_SITE',
      officialIdentityConfirmed: true,
    }),
    evidence: [],
    events: [createEvent()],
    openings: [createOpening({
      id: 'job-invalid-event',
      recruitmentEventId: 'missing-event',
      sourceTier: 'OFFICIAL_SITE',
    })],
  }), /RecruitmentEvent/);

  assert.equal(repository.listCompanies().length, 0);
  assert.equal(repository.listCareerPortals().length, 0);
  assert.equal(repository.listRecruitmentEvents().length, 0);
  assert.equal(repository.listJobOpenings().length, 0);
});

test('company snapshot rejects mismatched input identities before remapping merges', async (t) => {
  const repository = await createRepository('lite-job-market-mismatch-');
  t.after(() => repository.close());

  assert.throws(() => repository.persistCompanySnapshot({
    company: createCompany(),
    portal: createPortal(),
    evidence: [],
    events: [createEvent()],
    openings: [createOpening({ companyId: 'wrong-company' })],
  }), /snapshot.*company/i);

  assert.equal(repository.listCompanies().length, 0);
  assert.equal(repository.listCareerPortals().length, 0);
  assert.equal(repository.listRecruitmentEvents().length, 0);
  assert.equal(repository.listJobOpenings().length, 0);
});

test('official event supersedes but does not delete platform history', async (t) => {
  const repository = await createRepository('lite-job-market-supersede-');
  t.after(() => repository.close());
  repository.persistCompanySnapshot({
    company: createCompany(),
    portal: createPortal({
      id: 'portal-platform-history',
      canonicalUrl: 'https://www.liepin.com/company-jobs/123/',
      url: 'https://www.liepin.com/company-jobs/123/',
      registrableDomain: 'liepin.com',
      sourceTier: 'PLATFORM_ONLY',
      verificationStatus: 'REVIEW',
      confidenceScore: 40,
      officialIdentityConfirmed: false,
      platformIdentityConfirmed: true,
      hiringAvailability: 'OPENINGS_FOUND',
    }),
    evidence: [],
    events: [createEvent({
      id: 'event-platform-history',
      careerPortalId: 'portal-platform-history',
      sourceTier: 'PLATFORM_ONLY',
      publicationClass: 'PLATFORM_ONLY',
      directoryUrl: 'https://www.liepin.com/company-jobs/123/',
    })],
    openings: [createOpening({
      id: 'job-platform-history',
      careerPortalId: 'portal-platform-history',
      recruitmentEventId: 'event-platform-history',
      sourceTier: 'PLATFORM_ONLY',
      sourceUrl: 'https://www.liepin.com/company-jobs/123/',
      jobDetailUrl: null,
    })],
  });
  repository.persistCompanySnapshot({
    company: createCompany(),
    portal: createPortal({
      hiringAvailability: 'OPENINGS_FOUND',
      sourceTier: 'OFFICIAL_SITE',
      officialIdentityConfirmed: true,
    }),
    evidence: [],
    events: [createEvent()],
    openings: [createOpening({
      recruitmentEventId: 'event-1',
      sourceTier: 'OFFICIAL_SITE',
    })],
  });

  const platformPortal = repository.listCareerPortals()
    .find((portal) => portal.id === 'portal-platform-history');
  assert.equal(platformPortal.supersededByPortalId, 'portal-1');
  assert.equal(repository.listRecruitmentEvents().length, 2);
});

test('SQLite repositories upsert a complete verified chain idempotently', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());

  repository.upsertCompany(createCompany());
  repository.upsertCompany(createCompany({ aliases: ['示例', 'Example Tech'] }));
  repository.upsertCompany(createCompany({
    aliases: [],
    primaryOfficialDomain: null,
    officialDomains: [],
    industryTags: [],
  }));
  repository.upsertCareerPortal(createPortal());
  repository.upsertJobOpening(createOpening());
  repository.upsertJobOpening(createOpening({ lastSeenAt: '2026-07-24T01:00:00.000Z' }));

  assert.equal(repository.listCompanies().length, 1);
  assert.deepEqual(repository.listCompanies()[0].aliases, ['Example Tech', '示例']);
  assert.deepEqual(repository.listCompanies()[0].officialDomains, ['example.com']);
  assert.equal(repository.listCompanies()[0].primaryOfficialDomain, 'example.com');
  assert.deepEqual(repository.listCompanies()[0].industryTags, ['AI']);
  assert.equal(repository.listCareerPortals().length, 1);
  assert.equal(repository.listJobOpenings().length, 1);
  assert.equal(repository.listJobOpenings()[0].lastSeenAt, '2026-07-24T01:00:00.000Z');
});

test('repository rejects jobs under an unverified portal', async (t) => {
  const repository = await createRepository('lite-job-market-review-');
  t.after(() => repository.close());

  repository.upsertCompany(createCompany({
    id: 'company-2',
    canonicalName: '待复核公司',
    aliases: [],
    primaryOfficialDomain: null,
    officialDomains: [],
  }));
  repository.upsertCareerPortal(createPortal({
    id: 'portal-2',
    companyId: 'company-2',
    canonicalUrl: 'https://tenant.example/jobs',
    url: 'https://tenant.example/jobs',
    registrableDomain: 'tenant.example',
    atsType: 'MOKA',
    verificationStatus: 'REVIEW',
    confidenceScore: 50,
  }));

  assert.throws(() => repository.upsertJobOpening(createOpening({
    id: 'job-2',
    companyId: 'company-2',
    careerPortalId: 'portal-2',
    sourceJobId: '2',
    locations: [],
    employmentType: null,
    jobDetailUrl: 'https://tenant.example/jobs/2',
    sourceUrl: 'https://tenant.example/jobs/2',
  })), /verified CareerPortal/);
});

test('runs, logs and evidence round-trip structured fields', async (t) => {
  const repository = await createRepository('lite-job-market-audit-');
  t.after(() => repository.close());

  repository.beginRun({
    id: 'run-1',
    intent: { id: 'intent-1', roleType: 'AI 产品经理' },
    startedAt: NOW,
  });
  repository.upsertCompany(createCompany());
  repository.upsertCareerPortal(createPortal());
  repository.replaceVerificationEvidence('portal-1', [{
    code: 'official_domain_match',
    direction: 'POSITIVE',
    weight: 35,
    observedValue: 'example.com',
    sourceUrl: 'https://jobs.example.com/',
    observedAt: NOW,
  }]);
  repository.appendDiscoveryLog({
    id: 'log-1',
    runId: 'run-1',
    searchIntentId: 'intent-1',
    query: '"AI 产品经理" 招聘',
    expandedKeywords: ['AI PM'],
    searchSource: 'manual',
    searchedAt: NOW,
    resultUrl: 'https://jobs.example.com/',
    resultRank: 1,
    outcome: 'VERIFIED_PORTAL',
    metadata: { score: 80 },
  });
  repository.completeRun({ id: 'run-1', status: 'COMPLETED', completedAt: NOW });

  assert.deepEqual(repository.listCareerPortals()[0].evidence, [{
    code: 'official_domain_match',
    direction: 'POSITIVE',
    weight: 35,
    observedValue: 'example.com',
    sourceUrl: 'https://jobs.example.com/',
    observedAt: NOW,
  }]);
  assert.deepEqual(repository.listDiscoveryLogs()[0].expandedKeywords, ['AI PM']);
  assert.deepEqual(repository.listDiscoveryLogs()[0].metadata, { score: 80 });
});

test('company knowledge base merges aliases and bilingual names by official domain', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());

  const first = repository.upsertCompany(createCompany({
    id: 'company-byte-cn',
    canonicalName: '字节跳动',
    chineseName: '字节跳动',
    aliases: ['今日头条'],
    primaryOfficialDomain: 'bytedance.com',
    officialDomains: ['bytedance.com'],
    industryTags: ['互联网'],
    countryRegion: '中国大陆',
    market: 'CN',
  }));
  const merged = repository.upsertCompany(createCompany({
    id: 'company-byte-en',
    canonicalName: 'ByteDance',
    englishName: 'ByteDance',
    aliases: ['TikTok parent'],
    primaryOfficialDomain: 'bytedance.com',
    officialDomains: ['bytedance.com'],
    industryTags: ['AI'],
    countryRegion: 'China',
    market: 'CN',
  }));

  assert.equal(merged.id, first.id);
  assert.equal(repository.listCompanies().length, 1);
  const stored = repository.listCompanies()[0];
  assert.equal(stored.id, 'company-byte-cn');
  assert.equal(stored.canonicalName, '字节跳动');
  assert.equal(stored.chineseName, '字节跳动');
  assert.equal(stored.englishName, 'ByteDance');
  assert.deepEqual(stored.aliases, ['ByteDance', 'TikTok parent', '今日头条']);
  assert.equal(stored.primaryOfficialDomain, 'bytedance.com');
  assert.deepEqual(stored.officialDomains, ['bytedance.com']);
  assert.deepEqual(new Set(stored.industryTags), new Set(['AI', '互联网']));
  assert.equal(stored.market, 'CN');
  assert.equal(stored.countryRegion, '中国大陆');
});

test('company knowledge base matches an incoming alias to an existing formal name', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());
  const first = repository.upsertCompany(createCompany({
    id: 'company-byte',
    canonicalName: 'ByteDance',
    aliases: [],
    primaryOfficialDomain: null,
    officialDomains: [],
    market: 'CN',
  }));
  const merged = repository.upsertCompany(createCompany({
    id: 'company-alias-claim',
    canonicalName: '字节跳动',
    chineseName: '字节跳动',
    aliases: ['ByteDance'],
    primaryOfficialDomain: null,
    officialDomains: [],
    market: 'CN',
  }));

  assert.equal(merged.id, first.id);
  assert.equal(repository.listCompanies().length, 1);
});

test('reviewed rejected domains are hidden from the current company read model', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());
  const company = repository.upsertCompany(createCompany({
    id: 'company-domain-correction',
    canonicalName: 'Example Company',
    primaryOfficialDomain: 'correct.example',
    officialDomains: ['correct.example', 'typo.example'],
    market: 'CN',
  }));
  repository.upsertCompanyWebKnowledge({
    id: 'knowledge-rejected-domain',
    companyId: company.id,
    knowledgeType: 'REJECTED_DOMAIN',
    value: 'typo.example',
    verificationStatus: 'REJECTED',
    evidenceSource: 'reviewed_correction',
    firstSeenAt: NOW,
    lastVerifiedAt: NOW,
    rejectionReason: 'typographical_error',
  });

  assert.deepEqual(repository.listCompanies()[0].officialDomains, ['correct.example']);
});

test('career portal knowledge retains recruitment types and evidence', async (t) => {
  const repository = await createRepository();
  const company = createCompany();
  t.after(() => repository.close());
  repository.upsertCompany(company);
  const portal = createPortal({
    id: 'portal-recruitment-types',
    companyId: company.id,
    canonicalUrl: 'https://jobs.example.com/',
    registrableDomain: 'example.com',
    atsType: 'MOKA',
    pageType: 'CAREER_HOME',
    verificationStatus: 'VERIFIED',
    confidenceScore: 90,
    recruitmentTypes: ['campus', 'internship'],
  });
  repository.upsertCareerPortal(portal);
  repository.replaceVerificationEvidence(portal.id, [{
    code: 'official_domain_match',
    direction: 'POSITIVE',
    weight: 35,
    observedValue: 'example.com',
    sourceUrl: portal.canonicalUrl,
    observedAt: NOW,
  }]);

  const stored = repository.listCareerPortals()[0];
  assert.deepEqual(stored.recruitmentTypes, ['campus', 'internship']);
  assert.equal(stored.evidence[0].code, 'official_domain_match');
});

test('repository records auditable LLM usage without credentials', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());
  repository.recordLlmUsage({
    id: 'llm-1',
    runId: 'run-optional',
    task: 'expand_keywords',
    provider: 'openai-compatible',
    model: 'fixture-model',
    promptHash: 'abc123',
    cacheHit: false,
    inputTokens: 100,
    outputTokens: 25,
    costUsd: 0.0004,
    status: 'SUCCESS',
    errorMessage: null,
    createdAt: NOW,
  });

  assert.deepEqual(repository.listLlmUsage(), [{
    id: 'llm-1',
    runId: 'run-optional',
    task: 'expand_keywords',
    provider: 'openai-compatible',
    model: 'fixture-model',
    promptHash: 'abc123',
    cacheHit: false,
    inputTokens: 100,
    outputTokens: 25,
    costUsd: 0.0004,
    status: 'SUCCESS',
    errorMessage: null,
    createdAt: NOW,
  }]);
});

test('repository persists batch checkpoints for resume', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());
  repository.beginBatch({
    id: 'batch-1',
    inputHash: 'hash-1',
    startedAt: NOW,
  });
  repository.ensureBatchItem({
    batchId: 'batch-1',
    itemKey: 'item-1',
    position: 0,
    input: { role: 'AI产品经理' },
    createdAt: NOW,
  });
  repository.startBatchItem({
    batchId: 'batch-1',
    itemKey: 'item-1',
    startedAt: NOW,
  });
  repository.completeBatchItem({
    batchId: 'batch-1',
    itemKey: 'item-1',
    status: 'SUCCEEDED',
    resultStatus: 'PARTIAL',
    discoveryRunId: 'run-1',
    errorMessage: null,
    completedAt: NOW,
  });

  assert.deepEqual(repository.listBatchItems('batch-1'), [{
    batchId: 'batch-1',
    itemKey: 'item-1',
    position: 0,
    input: { role: 'AI产品经理' },
    status: 'SUCCEEDED',
    resultStatus: 'PARTIAL',
    attemptCount: 1,
    discoveryRunId: 'run-1',
    errorMessage: null,
    retryClass: null,
    deferredUntil: null,
    queueType: 'LOCAL_OR_DIRECT_VERIFICATION',
    deferReason: null,
    startedAt: NOW,
    completedAt: NOW,
    createdAt: NOW,
  }]);
});

test('blocked batch item is deferred and provider circuit state round-trips', async (t) => {
  const repository = await createRepository('lite-job-market-deferred-');
  t.after(() => repository.close());
  repository.beginBatch({
    id: 'batch-deferred',
    inputHash: 'hash-deferred',
    startedAt: NOW,
  });
  repository.ensureBatchItem({
    batchId: 'batch-deferred',
    itemKey: 'item-1',
    position: 0,
    input: { company: 'Example' },
    createdAt: NOW,
  });
  repository.startBatchItem({
    batchId: 'batch-deferred',
    itemKey: 'item-1',
    startedAt: NOW,
  });
  repository.deferBatchItem({
    batchId: 'batch-deferred',
    itemKey: 'item-1',
    resultStatus: 'BLOCKED',
    retryClass: 'PROVIDER_BLOCKED',
    deferredUntil: '2026-07-26T01:00:00.000Z',
    errorMessage: 'search_challenge_or_access_blocked',
    completedAt: NOW,
  });
  repository.saveProviderCircuitState({
    provider: 'baidu-browser',
    state: 'OPEN',
    reasonCode: 'SEARCH_CHALLENGE',
    openedReason: 'SEARCH_CHALLENGE',
    openedAt: NOW,
    openUntil: null,
    nextProbeAt: '2026-07-26T01:00:00.000Z',
    lastHealthyAt: null,
    manualActionRequired: false,
    manualAcknowledgedAt: null,
    probeOwnerId: null,
    probeLeaseUntil: null,
    lastProbeAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    version: 0,
    updatedAt: NOW,
  });

  const [item] = repository.listBatchItems('batch-deferred');
  assert.equal(item.status, 'DEFERRED');
  assert.equal(item.retryClass, 'PROVIDER_BLOCKED');
  assert.equal(item.deferredUntil, '2026-07-26T01:00:00.000Z');
  assert.deepEqual(repository.getProviderCircuitState('baidu-browser'), {
    provider: 'baidu-browser',
    state: 'OPEN',
    reasonCode: 'SEARCH_CHALLENGE',
    openedReason: 'SEARCH_CHALLENGE',
    openedAt: NOW,
    openUntil: null,
    nextProbeAt: '2026-07-26T01:00:00.000Z',
    lastHealthyAt: null,
    manualActionRequired: false,
    manualAcknowledgedAt: null,
    probeOwnerId: null,
    probeLeaseUntil: null,
    lastProbeAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    version: 0,
    updatedAt: NOW,
  });
  const requeued = repository.requeueDeferredBatchItems({
    batchId: 'batch-deferred',
  });
  assert.equal(requeued.requeued, 1);
  const [pending] = repository.listBatchItems('batch-deferred');
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.retryClass, null);
  assert.equal(pending.deferReason, null);
  assert.equal(pending.errorMessage, null);
});

test('batch id cannot be silently reused with different inputs', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());
  repository.beginBatch({ id: 'batch-stable', inputHash: 'hash-a', startedAt: NOW });
  assert.throws(
    () => repository.beginBatch({ id: 'batch-stable', inputHash: 'hash-b', startedAt: NOW }),
    /input hash mismatch/,
  );
});

test('company merge rejects conflicting domain and alias identities', async (t) => {
  const repository = await createRepository();
  t.after(() => repository.close());
  repository.upsertCompany(createCompany({
    id: 'company-a',
    canonicalName: 'Company A',
    aliases: ['Shared Alias'],
    primaryOfficialDomain: 'a.example',
    officialDomains: ['a.example'],
  }));
  repository.upsertCompany(createCompany({
    id: 'company-b',
    canonicalName: 'Company B',
    aliases: [],
    primaryOfficialDomain: 'b.example',
    officialDomains: ['b.example'],
  }));

  assert.throws(() => repository.upsertCompany(createCompany({
    id: 'company-new',
    canonicalName: 'New Claim',
    aliases: ['Shared Alias'],
    primaryOfficialDomain: 'b.example',
    officialDomains: ['b.example'],
  })), /merge conflict/);
});

test('downgrading a portal removes its openings from the formal result set', async (t) => {
  const repository = await createRepository('lite-job-market-downgrade-');
  t.after(() => repository.close());

  repository.upsertCompany(createCompany());
  repository.upsertCareerPortal(createPortal());
  repository.upsertJobOpening(createOpening());
  assert.equal(repository.listJobOpenings().length, 1);

  repository.upsertCareerPortal(createPortal({
    verificationStatus: 'REVIEW',
    confidenceScore: 50,
  }));

  assert.equal(repository.listJobOpenings().length, 0);
});
