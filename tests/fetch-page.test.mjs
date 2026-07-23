import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPublicHttpUrl, createPageFetcher } from '../src/runtime/fetch-page.mjs';

test('page fetcher rejects local and private network targets', () => {
  assert.throws(() => assertPublicHttpUrl('file:///etc/passwd'), /http/i);
  assert.throws(() => assertPublicHttpUrl('http://localhost/admin'), /public/i);
  assert.throws(() => assertPublicHttpUrl('http://127.0.0.1/admin'), /public/i);
  assert.throws(() => assertPublicHttpUrl('http://10.0.0.1/admin'), /public/i);
  assert.throws(() => assertPublicHttpUrl('http://[::1]/admin'), /public/i);
});

test('page fetcher validates every redirect target and strips credentials', async () => {
  const calls = [];
  const fetchPage = createPageFetcher({
    resolver: async () => [{ address: '93.184.216.34' }],
    fetcher: async (url, options) => {
      calls.push({ url: String(url), headers: [...new Headers(options.headers).keys()] });
      return new Response('', {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
      });
    },
  });

  await assert.rejects(fetchPage('https://example.com/jobs'), /public/i);
  assert.deepEqual(calls[0].headers, ['user-agent']);
});

test('page fetcher enforces declared and streamed response size', async () => {
  const base = {
    maxBytes: 16,
    resolver: async () => [{ address: '93.184.216.34' }],
  };
  const declared = createPageFetcher({
    ...base,
    fetcher: async () => new Response('x'.repeat(17), {
      status: 200,
      headers: { 'content-length': '17' },
    }),
  });
  await assert.rejects(declared('https://example.com/jobs'), /response too large/);

  const streamed = createPageFetcher({
    ...base,
    fetcher: async () => new Response('x'.repeat(17), { status: 200 }),
  });
  await assert.rejects(streamed('https://example.com/jobs'), /response too large/);
});
