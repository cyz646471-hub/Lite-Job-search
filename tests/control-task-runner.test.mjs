import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createControlPlaneService } from '../src/application/control-plane-service.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';
import {
  runControlTask,
  selectCompanies,
  targetProgress,
} from '../scripts/run-control-task.mjs';

function task(overrides = {}) {
  return {
    batchId: 'batch-1',
    targetCount: 10,
    targetUnit: 'COMPANIES_WITH_VERIFIED_PORTAL',
    selectionMode: 'STALE_OR_UNVERIFIED_ONLY',
    absoluteDateFrom: '2026-04-01',
    absoluteDateTo: '2026-07-01',
    roleKeywords: ['AI Product Manager'],
    ...overrides,
  };
}

test('selectCompanies applies new and stale portal selection modes', () => {
  const companies = [
    { id: 'input-a', company: '甲公司', officialDomain: 'a.example' },
    { id: 'input-b', company: '乙公司', officialDomain: 'b.example' },
    { id: 'input-c', company: '丙公司', officialDomain: 'c.example' },
  ];
  const repository = {
    listCompanies: () => [
      {
        id: 'company-a',
        canonicalName: '甲公司',
        aliases: [],
        officialDomains: ['a.example'],
      },
      {
        id: 'company-b',
        canonicalName: '乙公司',
        aliases: [],
        officialDomains: ['b.example'],
      },
    ],
    listCareerPortals: () => [
      {
        companyId: 'company-a',
        verificationStatus: 'VERIFIED',
        lastCheckedAt: '2026-06-15T00:00:00.000Z',
      },
      {
        companyId: 'company-b',
        verificationStatus: 'VERIFIED',
        lastCheckedAt: '2026-03-01T00:00:00.000Z',
      },
    ],
  };

  assert.deepEqual(
    selectCompanies(task(), companies, repository).map((company) => company.company),
    ['乙公司', '丙公司'],
  );
  assert.deepEqual(
    selectCompanies(task({ selectionMode: 'NEW_COMPANIES_ONLY' }), companies, repository)
      .map((company) => company.company),
    ['丙公司'],
  );
});

test('targetProgress only counts companies materialized in the current batch', () => {
  const repository = {
    listBatchItems: () => [
      {
        status: 'SUCCEEDED',
        input: { company: '甲公司', officialDomain: 'a.example' },
      },
    ],
    listCompanies: () => [
      {
        id: 'company-a',
        canonicalName: '甲公司',
        aliases: [],
        officialDomains: ['a.example'],
      },
      {
        id: 'company-outside',
        canonicalName: '批次外公司',
        aliases: [],
        officialDomains: ['outside.example'],
      },
    ],
    listCareerPortals: () => [
      { companyId: 'company-a', verificationStatus: 'VERIFIED' },
      { companyId: 'company-outside', verificationStatus: 'VERIFIED' },
    ],
    listJobOpenings: () => [],
  };

  assert.equal(targetProgress(task(), repository), 1);
});

test('matching-job progress applies batch, role, and date boundaries', () => {
  const repository = {
    listBatchItems: () => [
      {
        status: 'SUCCEEDED',
        input: { company: '甲公司', officialDomain: 'a.example' },
      },
    ],
    listCompanies: () => [
      {
        id: 'company-a',
        canonicalName: '甲公司',
        aliases: [],
        officialDomains: ['a.example'],
      },
      {
        id: 'company-outside',
        canonicalName: '批次外公司',
        aliases: [],
        officialDomains: ['outside.example'],
      },
    ],
    listCareerPortals: () => [],
    listJobOpenings: () => [
      {
        companyId: 'company-a',
        title: 'AI Product Manager',
        normalizedTitle: 'ai product manager',
        publishedAt: '2026-06-01',
      },
      {
        companyId: 'company-a',
        title: 'AI Product Manager',
        normalizedTitle: 'ai product manager',
        publishedAt: '2026-03-01',
      },
      {
        companyId: 'company-outside',
        title: 'AI Product Manager',
        normalizedTitle: 'ai product manager',
        publishedAt: '2026-06-01',
      },
    ],
  };

  assert.equal(targetProgress(task({
    targetUnit: 'COMPANIES_WITH_MATCHING_JOBS',
  }), repository), 1);
});

test('control task retries transient supervisor failure and pauses with audit evidence', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ljs-control-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = path.join(directory, 'jobs.sqlite');
  const registry = path.join(directory, 'companies.json');
  const outputDir = path.join(directory, 'output');
  await writeFile(registry, JSON.stringify([
    { company: 'Example Company', market: 'CN', officialDomain: 'example.com' },
  ]));
  let repository = openSqliteMarketDiscoveryRepository({ file: database });
  repository.migrate();
  const control = createControlPlaneService({
    repository,
    now: () => '2026-07-28T00:00:00.000Z',
  });
  const controlTask = control.createTask({
    role_keywords: ['公开招聘岗位'],
    absolute_date_from: '2026-04-29',
    absolute_date_to: '2026-07-28',
    target_count: 1,
    selection_mode: 'RECHECK_EXISTING_AND_NEW',
    target_unit: 'COMPANIES_PROCESSED',
    allow_baidu_fallback: false,
  });
  repository.close();

  let attempts = 0;
  const result = await runControlTask({
    task: controlTask.id,
    registry,
    database,
    'output-dir': outputDir,
    'max-supervisor-retries': '1',
    'supervisor-retry-delay-ms': '1',
  }, {
    sleep: async () => {},
    runSupervisor: async () => {
      attempts += 1;
      throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.recovery.code, 'SQLITE_BUSY');
  assert.equal(result.finalOutput, null);

  repository = openSqliteMarketDiscoveryRepository({ file: database });
  repository.migrate();
  assert.equal(repository.getControlTask(controlTask.id).state, 'PARTIAL');
  assert.equal(repository.getBatchRun(controlTask.batchId).status, 'PAUSED');
  const audit = repository.listAuditLogs({
    targetType: 'TASK',
    targetId: controlTask.id,
  }).filter((entry) => entry.action.startsWith('WORKER_ERROR_'));
  assert.equal(audit.length, 2);
  assert.equal(audit[0].details.code, 'SQLITE_BUSY');
  repository.close();
});
