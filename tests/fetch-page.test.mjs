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
    fetcher: async (url, options, connection) => {
      calls.push({
        url: String(url),
        headers: [...new Headers(options.headers).keys()],
        pinnedAddress: connection.pinnedAddress.address,
      });
      return new Response('', {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
      });
    },
  });

  await assert.rejects(fetchPage('https://example.com/jobs'), /public/i);
  assert.deepEqual(calls[0].headers, ['user-agent']);
  assert.equal(calls[0].pinnedAddress, '93.184.216.34');
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

test('page fetch timeout also bounds DNS resolution', async () => {
  const fetchPage = createPageFetcher({
    timeoutMs: 5,
    resolver: async () => new Promise(() => {}),
  });
  await assert.rejects(
    fetchPage('https://dns-timeout.example/jobs'),
    /page fetch timeout/,
  );
});

test('page fetcher forwards only supported conditional request headers', async () => {
  let requestHeaders;
  const fetchPage = createPageFetcher({
    resolver: async () => [{ address: '93.184.216.34' }],
    fetcher: async (_url, options) => {
      requestHeaders = new Headers(options.headers);
      return new Response(null, { status: 304 });
    },
  });
  const page = await fetchPage('https://example.com/jobs', {
    headers: {
      'if-none-match': '"v2"',
      'if-modified-since': 'Tue, 28 Jul 2026 00:00:00 GMT',
      authorization: 'must-not-forward',
    },
  });
  assert.equal(page.status, 304);
  assert.equal(requestHeaders.get('if-none-match'), '"v2"');
  assert.equal(requestHeaders.get('if-modified-since'), 'Tue, 28 Jul 2026 00:00:00 GMT');
  assert.equal(requestHeaders.has('authorization'), false);
});

test('page fetcher carries response cookies only across redirects on the same host', async () => {
  const cookies = [];
  let callCount = 0;
  const fetchPage = createPageFetcher({
    resolver: async () => [{ address: '93.184.216.34' }],
    fetcher: async (_url, options) => {
      callCount += 1;
      cookies.push(new Headers(options.headers).get('cookie'));
      if (callCount === 1) {
        return new Response('', {
          status: 302,
          headers: {
            location: '/jobs',
            'set-cookie': 'session=public-ats-session; Path=/; HttpOnly',
          },
        });
      }
      return new Response('<html>jobs</html>', { status: 200 });
    },
  });
  const page = await fetchPage('https://example.com/jobs');
  assert.equal(page.status, 200);
  assert.deepEqual(cookies, [null, 'session=public-ats-session']);
});
