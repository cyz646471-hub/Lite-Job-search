import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPreStrategyRecheckPlan,
} from '../scripts/requeue-pre-strategy-unconfirmed.mjs';

const EFFECTIVE_AT = '2026-07-28T17:07:38.213Z';

test('pre-strategy recheck preserves confirmed portals and post-strategy results', () => {
  const plan = buildPreStrategyRecheckPlan({
    effectiveAt: EFFECTIVE_AT,
    companies: [
      { id: 'company-confirmed', canonicalName: '已确认企业', aliases: [], officialDomains: [] },
      { id: 'company-old', canonicalName: '旧逻辑企业', aliases: [], officialDomains: [] },
      { id: 'company-home', canonicalName: '仅官网企业', aliases: [], officialDomains: [] },
      { id: 'company-new', canonicalName: '新逻辑企业', aliases: [], officialDomains: [] },
    ],
    portals: [
      {
        companyId: 'company-confirmed',
        verificationStatus: 'VERIFIED',
        officialIdentityConfirmed: true,
        pageType: 'JOB_LIST',
      },
      {
        companyId: 'company-home',
        verificationStatus: 'VERIFIED',
        officialIdentityConfirmed: true,
        pageType: 'CORPORATE_HOME',
      },
    ],
    items: [
      {
        itemKey: 'confirmed',
        input: { company: '已确认企业' },
        status: 'SUCCEEDED',
        completedAt: '2026-07-28T16:00:00.000Z',
      },
      {
        itemKey: 'old',
        input: { company: '旧逻辑企业' },
        status: 'SUCCEEDED',
        completedAt: '2026-07-28T16:00:00.000Z',
      },
      {
        itemKey: 'home',
        input: { company: '仅官网企业' },
        status: 'SUCCEEDED',
        completedAt: '2026-07-28T16:00:00.000Z',
      },
      {
        itemKey: 'new',
        input: { company: '新逻辑企业' },
        status: 'SUCCEEDED',
        completedAt: '2026-07-28T18:00:00.000Z',
      },
      {
        itemKey: 'pending',
        input: { company: '尚未处理企业' },
        status: 'PENDING',
        completedAt: null,
      },
      {
        itemKey: 'orphaned',
        input: { company: '旧逻辑遗留运行项' },
        status: 'RUNNING',
        startedAt: '2026-07-28T16:30:00.000Z',
        completedAt: null,
      },
      {
        itemKey: 'confirmed-orphaned',
        input: { company: '已确认企业' },
        status: 'RUNNING',
        startedAt: '2026-07-28T16:30:00.000Z',
        completedAt: null,
      },
    ],
  });

  assert.deepEqual(
    plan.selected.map((row) => row.item.itemKey),
    ['old', 'home', 'orphaned'],
  );
  assert.deepEqual(
    plan.confirmedOrphans.map((row) => row.item.itemKey),
    ['confirmed-orphaned'],
  );
});
