import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileSearchCache, MemorySearchCache } from '../src/runtime/cache.mjs';
import { DailyBudget } from '../src/runtime/budget.mjs';
import { loadRuntimeConfig } from '../src/runtime/config.mjs';

test('MemorySearchCache returns live entries and expires stale entries', () => {
  let now = 1_000;
  const cache = new MemorySearchCache({ now: () => now });
  cache.set('company:acme', { url: 'https://acme.example/jobs' }, { ttlMs: 100 });
  assert.equal(cache.get('company:acme').url, 'https://acme.example/jobs');
  now = 1_101;
  assert.equal(cache.get('company:acme'), null);
});

test('DailyBudget defers searches after the configured limit', () => {
  const budget = new DailyBudget({ limit: 2, date: () => '2026-07-23' });
  assert.equal(budget.tryConsume('tavily'), true);
  assert.equal(budget.tryConsume('tavily'), true);
  assert.equal(budget.tryConsume('tavily'), false);
  assert.deepEqual(budget.snapshot(), {
    date: '2026-07-23',
    limit: 2,
    used: 2,
    remaining: 0,
    usedByProvider: { tavily: 2 },
  });
});

test('FileSearchCache persists values across processes without storing secrets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-search-cache-'));
  const file = path.join(directory, 'search-cache.json');
  const first = new FileSearchCache({ file, now: () => 1_000 });
  first.set('acme', { items: [{ url: 'https://acme.example/jobs' }] }, { ttlMs: 500 });
  const second = new FileSearchCache({ file, now: () => 1_100 });
  assert.equal(second.get('acme').items[0].url, 'https://acme.example/jobs');
});

test('runtime config bounds market discovery and reports LLM readiness', () => {
  const config = loadRuntimeConfig({
    LITE_JOB_LLM_ENDPOINT: 'https://llm.example.test/v1/chat/completions',
    LITE_JOB_LLM_MODEL: 'fixture-model',
    LITE_JOB_LLM_TIMEOUT_MS: '1234',
    LITE_JOB_DATABASE_FILE: './data/test.sqlite',
    LITE_JOB_DISCOVERY_MAX_QUERIES: '999',
    LITE_JOB_DISCOVERY_MAX_RESULTS: '5000',
  });

  assert.deepEqual(config.llm, {
    endpoint: 'https://llm.example.test/v1/chat/completions',
    model: 'fixture-model',
    configured: true,
    timeoutMs: 1234,
  });
  assert.deepEqual(config.database, { file: './data/test.sqlite' });
  assert.deepEqual(config.discovery, { maxQueries: 20, maxResults: 1000 });
});
