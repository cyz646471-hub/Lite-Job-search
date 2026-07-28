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

test('extracts a concise job title from a verbose iQiyi-style position card', async () => {
  const jobUrl = 'https://careers.iqiyi.com/campus/position/764000000000000001/detail';
  const page = {
    async snapshot() {
      return {
        text: '招聘职位 C++研发工程师-26届校招',
        html: '<main>招聘职位</main>',
        title: '爱奇艺校园招聘',
        links: [{
          text: 'C++研发工程师-26届校招 北京 正式 技术研发 职位 ID 764000000000000001',
          href: jobUrl,
        }],
      };
    },
    async waitForTimeout() {},
    async url() {
      return 'https://careers.iqiyi.com/campus/';
    },
  };

  const observed = await observeRenderedRecruitmentPage(page, {
    requestedUrl: 'https://careers.iqiyi.com/campus/',
    response: { status: () => 200 },
    renderWaitMs: 0,
  });

  assert.deepEqual(observed.jobs, [{
    title: 'C++研发工程师-26届校招',
    jobDetailUrl: jobUrl,
    sourceUrl: jobUrl,
    status: 'ACTIVE',
    sourceJobId: '764000000000000001',
    locations: ['北京'],
    employmentType: 'full_time',
  }]);
});

test('recognizes iQiyi rendered listing text and compact location metadata', async () => {
  const jobUrl = 'https://careers.iqiyi.com/campus/position/7644394087927728447/detail';
  const page = {
    async snapshot() {
      return {
        text: '2026应届生项目 开启新的工作（7） C++研发工程师-26届校招',
        html: '<main>开启新的工作（7）</main>',
        title: '爱奇艺校园招聘',
        links: [{
          text: 'C++研发工程师-26届校招 北京正式技术 - 研发2026应届生项目职位 ID：A84965 - 支持推荐业务在线推理平台的构建和迭代优化',
          href: jobUrl,
        }],
      };
    },
    async waitForTimeout() {},
    async url() {
      return 'https://careers.iqiyi.com/campus';
    },
  };

  const observed = await observeRenderedRecruitmentPage(page, {
    requestedUrl: 'https://careers.iqiyi.com/campus',
    response: { status: () => 200 },
    renderWaitMs: 0,
  });

  assert.equal(observed.vacancyStatus, 'UNKNOWN');
  assert.deepEqual(observed.jobs.map((job) => job.title), [
    'C++研发工程师-26届校招',
  ]);
});

test('extracts explicit Workday dynamic job anchors with adapter evidence', async () => {
  const jobUrl = 'https://example.wd5.myworkdayjobs.com/en-US/jobs/job/Shanghai/Product-Manager_R123';
  const page = {
    async snapshot() {
      return {
        text: 'Open positions Product Manager',
        html: '<main>Open positions</main>',
        title: 'Example Careers',
        links: [{
          text: 'Product Manager - Shanghai',
          href: jobUrl,
        }],
      };
    },
    async waitForTimeout() {},
    async url() {
      return 'https://example.wd5.myworkdayjobs.com/en-US/jobs';
    },
  };

  const observed = await observeRenderedRecruitmentPage(page, {
    requestedUrl: 'https://example.wd5.myworkdayjobs.com/en-US/jobs',
    response: { status: () => 200 },
    renderWaitMs: 0,
  });

  assert.equal(observed.jobs.length, 1);
  assert.equal(observed.jobs[0].title, 'Product Manager - Shanghai');
  assert.equal(observed.jobs[0].extractionAdapter, 'WORKDAY');
  assert.deepEqual(observed.extractionAdapters, ['WORKDAY']);
});

test('does not confuse search-engineering and director job titles with navigation', async () => {
  const page = {
    async snapshot() {
      return {
        text: '开启新的工作（2）',
        html: '<main>开启新的工作（2）</main>',
        title: '爱奇艺校园招聘',
        links: [{
          text: '搜索算法工程师-26年校招 北京正式技术 - 算法2026应届生项目职位 ID：A63513 - 利用深度学习算法优化视频排序模型',
          href: 'https://careers.iqiyi.com/campus/position/7628553236739655974/detail',
        }, {
          text: 'AIGC导演-26年校招（需上传AI短片作品） 北京正式内容制作 - 导演2026应届生项目职位 ID：A36952 - 审核与统筹剧本创作流程',
          href: 'https://careers.iqiyi.com/campus/position/7616214185181104435/detail',
        }],
      };
    },
    async waitForTimeout() {},
    async url() {
      return 'https://careers.iqiyi.com/campus';
    },
  };

  const observed = await observeRenderedRecruitmentPage(page, {
    requestedUrl: 'https://careers.iqiyi.com/campus',
    response: { status: () => 200 },
    renderWaitMs: 0,
  });

  assert.deepEqual(observed.jobs.map((job) => job.title), [
    '搜索算法工程师-26年校招',
    'AIGC导演-26年校招（需上传AI短片作品）',
  ]);
});

test('does not classify the word internal as an internship signal', async () => {
  const jobUrl = 'https://careers.iqiyi.com/campushire/position/7554335474921670939/detail';
  const page = {
    async snapshot() {
      return {
        text: 'Find Your New Job (1)',
        html: '<main>Find Your New Job (1)</main>',
        title: 'Graduates',
        links: [{
          text: 'Social Media Operation Specialist SingaporeRegular运营 Use internal AI tools to improve efficiency',
          href: jobUrl,
        }],
      };
    },
    async waitForTimeout() {},
    async url() {
      return 'https://careers.iqiyi.com/campushire/';
    },
  };

  const observed = await observeRenderedRecruitmentPage(page, {
    requestedUrl: 'https://careers.iqiyi.com/campushire/',
    response: { status: () => 200 },
    renderWaitMs: 0,
  });

  assert.equal(observed.jobs[0].employmentType, 'full_time');
});

test('Playwright wrapper implements the BrowserSession port', async () => {
  let configuredTimeout = null;
  const rawPage = {
    setDefaultTimeout: (timeoutMs) => {
      configuredTimeout = timeoutMs;
    },
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
  assert.equal(configuredTimeout, 5_000);
  assert.equal((await page.snapshot()).text, '招聘职位');
});
