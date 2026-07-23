import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadProviders } from '../engine/upstream/providers/_registry.mjs';
import { loadDetailProviders } from '../engine/upstream/planner/detail-providers/_registry.mjs';
import { loadPageProviders } from '../engine/upstream/planner/page-providers/_registry.mjs';
import {
  ApifyGoogleSearchProvider,
  apifyConfig,
} from '../engine/upstream/planner/cn-apify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('extracted engine retains the broad job provider registry', async () => {
  const providers = await loadProviders(path.join(root, 'engine', 'upstream', 'providers'));
  assert.ok(providers.size >= 60, `expected at least 60 providers, got ${providers.size}`);
  for (const id of ['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters']) {
    assert.equal(providers.has(id), true, `missing North America provider: ${id}`);
  }
  for (const id of ['gank-interview', 'nowcoder-schedule', 'niuqizhipin', 'tencent', 'bytedance']) {
    assert.equal(providers.has(id), true, `missing China provider: ${id}`);
  }
  assert.equal(providers.has('langlang-wangshen'), false);
});

test('extracted engine retains ATS page and detail provider registries', async () => {
  const pageProviders = await loadPageProviders();
  const detailProviders = await loadDetailProviders();
  assert.ok(pageProviders.length >= 6);
  assert.ok(detailProviders.length >= 5);
  for (const id of ['moka', 'feishu-jobs', 'hotjob']) {
    assert.equal(pageProviders.some((provider) => provider.id === id), true);
  }
  for (const id of ['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters']) {
    assert.equal(detailProviders.some((provider) => provider.id === id), true);
  }
});

test('extracted engine retains Apify budgeted Google search support', () => {
  const config = apifyConfig({
    APIFY_TOKEN: 'fixture-token',
    APIFY_DAILY_BUDGET_USD: '1.00',
  });
  assert.equal(config.dailyBudgetUsd, 1);
  assert.equal(typeof ApifyGoogleSearchProvider, 'function');
});

