import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
