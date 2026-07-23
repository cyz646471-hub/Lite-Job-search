import assert from 'node:assert/strict';
import test from 'node:test';

import { SearchRouter, describeSearchMode } from '../src/search/router.mjs';
import { MemorySearchCache } from '../src/runtime/cache.mjs';

test('describeSearchMode distinguishes no, single and fallback providers', () => {
  assert.equal(describeSearchMode([]).mode, 'no_provider');
  assert.deepEqual(
    describeSearchMode([{ name: 'tavily', configured: true }]),
    { mode: 'single_provider', primary: 'tavily', fallback: 'none' },
  );
  assert.deepEqual(
    describeSearchMode([
      { name: 'brave', configured: true },
      { name: 'tavily', configured: true },
    ]),
    { mode: 'primary_fallback', primary: 'brave', fallback: 'tavily' },
  );
});

test('SearchRouter falls back after a retryable provider failure', async () => {
  const router = new SearchRouter([
    {
      name: 'primary',
      configured: true,
      search: async () => ({ status: 'timeout', items: [] }),
    },
    {
      name: 'fallback',
      configured: true,
      search: async () => ({
        status: 'ok',
        items: [{ title: 'Acme Careers', url: 'https://acme.example/jobs' }],
      }),
    },
  ]);
  const result = await router.search({ query: 'Acme careers' });
  assert.equal(result.provider, 'fallback');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.attempts.map(({ provider, status }) => [provider, status]), [
    ['primary', 'timeout'],
    ['fallback', 'ok'],
  ]);
});

test('SearchRouter reports not_configured without calling the network', async () => {
  const router = new SearchRouter([]);
  assert.deepEqual(await router.search({ query: 'Acme careers' }), {
    status: 'not_configured',
    provider: 'none',
    items: [],
    attempts: [],
    liveSearchExecuted: false,
  });
});

test('SearchRouter does not claim live search for manual providers', async () => {
  const router = new SearchRouter([{
    name: 'manual',
    configured: true,
    search: async () => ({ status: 'ok', items: [], networkRequests: 0 }),
  }]);
  const result = await router.search({ query: 'Acme careers' });
  assert.equal(result.liveSearchExecuted, false);
});

test('SearchRouter isolates cache entries by provider route', async () => {
  const cache = new MemorySearchCache();
  const manual = new SearchRouter([{
    name: 'manual',
    configured: true,
    search: async () => ({ status: 'ok', items: [{ url: 'https://manual.example' }], networkRequests: 0 }),
  }], { cache });
  await manual.search({ query: 'Acme', cacheKey: 'NA|Acme' });

  const api = new SearchRouter([{
    name: 'tavily',
    configured: true,
    search: async () => ({ status: 'ok', items: [{ url: 'https://api.example' }], networkRequests: 1 }),
  }], { cache });
  const result = await api.search({ query: 'Acme', cacheKey: 'NA|Acme' });
  assert.equal(result.items[0].url, 'https://api.example');
  assert.equal(result.cacheHit, undefined);
});
