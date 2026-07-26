import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adaptBrowserCompanyResult,
  createBrowserObservationFetcher,
} from '../src/adapters/browser/browser-page-observation-adapter.mjs';
import {
  createPlaywrightBrowserSession,
} from '../src/adapters/browser/playwright-browser-session.mjs';
import {
  observeRenderedRecruitmentPage,
} from '../src/adapters/browser/recruitment-page-observer.mjs';
import {
  assertBrowserPage,
  assertBrowserSession,
} from '../src/ports/browser-session.mjs';
import {
  createChromeExtensionBrowser,
} from '../scripts/chrome-extension-browser-adapter.mjs';

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

test('browser candidate preserves directed official ATS attribution', () => {
  const adapted = adaptBrowserCompanyResult({
    company: 'Example Tech',
    officialDomain: 'example.com',
    officialCandidates: [{
      url: 'https://example.mokahr.com/jobs',
      title: '查看职位',
      verifiedTenant: true,
      parentOfficialVerified: true,
      officialAttributionUrl: 'https://example.com/careers',
      discoveryReason: 'verified_official_outbound_ats_link',
    }],
  });

  assert.equal(adapted.items[0].parentOfficialVerified, true);
  assert.equal(adapted.items[0].officialAttributionUrl, 'https://example.com/careers');
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

test('BrowserSession port rejects incomplete browser pages', () => {
  assert.throws(() => assertBrowserSession({}), /browser\.newPage/);
  assert.throws(() => assertBrowserPage({
    goto() {},
    waitForTimeout() {},
    url() {},
    title() {},
  }), /page\.snapshot/);
  assert.throws(() => createChromeExtensionBrowser(null), (error) => (
    error.code === 'NOT_CONFIGURED'
  ));
});

test('rendered recruitment observer waits for explicit job structure', async () => {
  const snapshots = [
    { text: 'Loading', html: '<main>Loading</main>', title: 'Jobs', links: [] },
    {
      text: '招聘职位 Product Manager',
      html: '<main>招聘职位 Product Manager</main>',
      title: 'Jobs',
      links: [{ text: 'Product Manager', href: 'https://jobs.example.com/1' }],
    },
  ];
  let index = 0;
  const page = {
    async snapshot() {
      return snapshots[Math.min(index++, snapshots.length - 1)];
    },
    async waitForTimeout() {},
    async url() {
      return 'https://jobs.example.com/';
    },
  };
  const observed = await observeRenderedRecruitmentPage(page, {
    requestedUrl: 'https://example.com/careers',
    response: { status: () => 200 },
    renderWaitMs: 1_000,
    pollIntervalMs: 100,
    now: () => '2026-07-26T00:00:00.000Z',
  });

  assert.equal(observed.fetchStatus, 'COMPLETED');
  assert.equal(observed.vacancyStatus, 'UNKNOWN');
  assert.equal(observed.finalUrl, 'https://jobs.example.com/');
  assert.equal(index, 2);
});

test('generic recruitment navigation is not promoted to an active opening', async () => {
  const page = {
    async snapshot() {
      return {
        text: '招聘 产品经理岗位分类与职业介绍',
        html: '<main>招聘 产品经理岗位分类与职业介绍</main>',
        title: '招聘',
        links: [{
          text: '产品经理岗位介绍',
          href: 'https://jobs.example.com/positions/product-manager',
        }],
      };
    },
    async waitForTimeout() {},
    async url() {
      return 'https://jobs.example.com/careers';
    },
  };

  const observed = await observeRenderedRecruitmentPage(page, {
    requestedUrl: 'https://jobs.example.com/careers',
    response: { status: () => 200 },
    renderWaitMs: 0,
  });

  assert.deepEqual(observed.jobs, []);
});

test('Playwright wrapper implements the BrowserSession port', async () => {
  const rawPage = {
    goto: async () => ({ status: () => 200 }),
    waitForTimeout: async () => {},
    url: () => 'https://jobs.example.com/',
    title: async () => 'Jobs',
    locator: (selector) => ({
      innerText: async () => '招聘职位',
      evaluate: async () => '<html>招聘职位</html>',
      evaluateAll: async () => (selector === 'a[href]' ? [] : []),
    }),
    close: async () => {},
  };
  const context = {
    newPage: async () => rawPage,
    close: async () => {},
  };
  const session = createPlaywrightBrowserSession(context);
  const page = await session.newPage();

  assert.equal(assertBrowserSession(session), session);
  assert.equal(assertBrowserPage(page), page);
  assert.equal((await page.snapshot()).text, '招聘职位');
});
