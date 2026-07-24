import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adaptBrowserCompanyResult,
  createBrowserObservationFetcher,
} from '../src/adapters/browser/browser-page-observation-adapter.mjs';

test('browser candidates remain candidates until deterministic verification', () => {
  const adapted = adaptBrowserCompanyResult({
    company: '示例科技',
    aliases: ['Example Tech'],
    officialDomain: 'example.com',
    query: '示例科技 招聘',
    officialCandidates: [{
      classification: 'OFFICIAL_CANDIDATE',
      url: 'https://jobs.example.com/openings',
      title: '示例科技招聘',
      recruitmentType: 'SOCIAL',
    }],
  });

  assert.equal(adapted.query, '示例科技 招聘');
  assert.equal(adapted.items.length, 1);
  assert.equal(adapted.items[0].company, '示例科技');
  assert.deepEqual(adapted.items[0].aliases, ['Example Tech']);
  assert.equal(adapted.items[0].officialDomainSource, 'registry');
  assert.equal(adapted.items[0].confirmedOfficialDomain, 'example.com');
  assert.equal(adapted.items[0].verifiedTenant, false);
  assert.deepEqual(adapted.items[0].recruitmentTypes, ['experienced']);
  assert.equal('verificationStatus' in adapted.items[0], false);
});

test('browser observation fetcher returns explicit values without inference', async () => {
  const fetchPage = createBrowserObservationFetcher([{
    requestedUrl: 'https://jobs.example.com/openings',
    finalUrl: 'https://jobs.example.com/openings',
    status: 200,
    title: '招聘职位',
    html: '<h1>招聘职位</h1>',
    text: '招聘职位',
    links: [],
    observedAt: '2026-07-25T00:00:00.000Z',
  }]);

  const page = await fetchPage('https://jobs.example.com/openings#top');

  assert.equal(page.finalUrl, 'https://jobs.example.com/openings');
  assert.equal(page.publishedAt, undefined);
  assert.equal(page.closesAt, undefined);
  assert.equal(page.location, undefined);
  assert.equal(page.observedAt, '2026-07-25T00:00:00.000Z');
});

test('browser observation fetcher resolves requested and redirected URLs', async () => {
  const fetchPage = createBrowserObservationFetcher([{
    requestedUrl: 'https://example.com/careers',
    finalUrl: 'https://jobs.example.com/openings',
    status: 200,
    html: '<h1>Jobs</h1>',
    links: [],
  }]);

  assert.equal(
    (await fetchPage('https://example.com/careers')).finalUrl,
    'https://jobs.example.com/openings',
  );
  assert.equal(
    (await fetchPage('https://jobs.example.com/openings')).finalUrl,
    'https://jobs.example.com/openings',
  );
});

test('browser observation adapter rejects invalid URLs and reports missing observations', async () => {
  assert.throws(
    () => adaptBrowserCompanyResult({
      company: '示例科技',
      query: '示例科技 招聘',
      officialCandidates: [{ url: 'javascript:alert(1)' }],
    }),
    /invalid browser candidate URL/,
  );

  const fetchPage = createBrowserObservationFetcher([]);
  await assert.rejects(
    fetchPage('https://jobs.example.com/missing'),
    /missing browser observation/,
  );
});
