import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBrowserRuntime,
} from '../scripts/chrome-extension-browser-adapter.mjs';
import {
  buildBrowserLaunchOptions,
  browserDiscoveryLimits,
  buildDiscoveryReport,
  classifySearchResult,
  createMinimumSearchIntervalGate,
  discoverCareerLinks,
  discoverCompanyWithBrowser,
  isSearchBlockedPage,
  normalizeBrowserCompanyInput,
  shouldOpenSearchResult,
} from '../scripts/company-browser-discovery.mjs';

function fakeBrowser(pages) {
  const visits = [];
  let currentUrl = '';
  const page = {
    async goto(url) {
      currentUrl = url;
      visits.push(url);
      const current = pages[url] || {};
      if (current.error) throw current.error;
      return { status: () => current.status || 200 };
    },
    async waitForTimeout() {},
    url() {
      return pages[currentUrl]?.finalUrl || currentUrl;
    },
    async title() {
      return pages[currentUrl]?.title || '';
    },
    locator(selector) {
      const current = pages[currentUrl] || {};
      return {
        async innerText() {
          return current.text || '';
        },
        async evaluate() {
          if (selector !== 'html') return '';
          return current.html || `<html><body>${current.text || ''}</body></html>`;
        },
        async evaluateAll() {
          if (current.searchRows) return current.searchRows;
          if (selector === 'a[href]') return current.links || [];
          return [];
        },
      };
    },
    async close() {},
  };
  return {
    visits,
    async newPage() {
      return page;
    },
  };
}

test('visits recruitment sibling entries instead of leaving them discovered', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('示例公司 招聘')}`;
  const socialUrl = 'https://jobs.example.com/social';
  const campusUrl = 'https://jobs.example.com/campus';
  const internshipUrl = 'https://jobs.example.com/internship';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: '示例公司招聘',
      searchRows: [{
        title: '示例公司招聘',
        href: socialUrl,
        snippet: '示例公司社会招聘',
        kind: 'organic',
      }],
    },
    [socialUrl]: {
      text: '示例公司 社会招聘 职位列表',
      links: [
        { text: '校园招聘', href: campusUrl },
        { text: '实习生招聘', href: internshipUrl },
      ],
    },
    [campusUrl]: {
      text: '示例公司 校园招聘 暂无职位',
      links: [{ text: '社会招聘', href: socialUrl }],
    },
    [internshipUrl]: {
      text: '示例公司 实习生招聘 职位列表 后端开发实习生',
      links: [],
    },
  });

  const result = await discoverCompanyWithBrowser({
    company: '示例公司',
    officialDomain: 'example.com',
    browser,
  });

  const byUrl = new Map(result.officialCandidates.map((item) => [item.url, item]));
  assert.equal(byUrl.get(socialUrl).pageStatus, 'COMPLETED');
  assert.equal(byUrl.get(campusUrl).pageStatus, 'COMPLETED');
  assert.equal(byUrl.get(campusUrl).vacancyStatus, 'NO_OPENINGS');
  assert.equal(byUrl.get(internshipUrl).pageStatus, 'COMPLETED');
  assert.ok(result.officialCandidates.every((item) => item.pageStatus !== 'DISCOVERED'));
  assert.equal(browser.visits.filter((url) => url === campusUrl).length, 1);
  assert.equal(browser.visits.filter((url) => url === internshipUrl).length, 1);
});

test('verified official page attributes an outbound ATS tenant link', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('Example Tech 招聘')}`;
  const officialUrl = 'https://example.com/careers';
  const atsUrl = 'https://example.mokahr.com/jobs';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: 'Example Tech 招聘',
      searchRows: [{
        title: 'Example Tech 招聘',
        href: officialUrl,
        snippet: 'Example Tech 招聘职位',
        kind: 'organic',
      }],
    },
    [officialUrl]: {
      title: 'Example Tech 招聘',
      text: 'Example Tech 招聘职位',
      links: [{ text: '查看职位', href: atsUrl }],
    },
    [atsUrl]: {
      title: 'Example Tech Jobs',
      text: 'Example Tech 招聘职位 Product Manager',
      links: [],
    },
  });

  const result = await discoverCompanyWithBrowser({
    company: 'Example Tech',
    officialDomain: 'example.com',
    browser,
  });
  const atsCandidate = result.officialCandidates.find((item) => item.url === atsUrl);

  assert.equal(atsCandidate.verifiedTenant, true);
  assert.equal(atsCandidate.parentOfficialVerified, true);
  assert.equal(atsCandidate.officialAttributionUrl, officialUrl);
  assert.equal(
    atsCandidate.discoveryReason,
    'verified_official_outbound_ats_link',
  );
});

test('unverified recruitment page cannot authorize an outbound ATS tenant', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('Example Tech 招聘')}`;
  const unverifiedUrl = 'https://untrusted.example.net/careers';
  const atsUrl = 'https://example.mokahr.com/jobs';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: 'Example Tech 招聘',
      searchRows: [{
        title: 'Example Tech 招聘',
        href: unverifiedUrl,
        snippet: 'Example Tech 招聘职位',
        kind: 'organic',
      }],
    },
    [unverifiedUrl]: {
      title: 'Example Tech 招聘',
      text: 'Example Tech 招聘职位',
      links: [{ text: '查看职位', href: atsUrl }],
    },
  });

  const result = await discoverCompanyWithBrowser({
    company: 'Example Tech',
    browser,
  });

  assert.equal(result.officialCandidates.some((item) => item.url === atsUrl), false);
  assert.equal(browser.visits.includes(atsUrl), false);
});

test('reports inspected recruitment entry outcomes separately from discovery', () => {
  const report = buildDiscoveryReport([{
    company: '示例公司',
    status: 'COMPLETED',
    leads: [],
    officialCandidates: [
      { url: 'https://jobs.example.com/social', pageStatus: 'COMPLETED', vacancyStatus: 'UNKNOWN' },
      { url: 'https://jobs.example.com/campus', pageStatus: 'COMPLETED', vacancyStatus: 'NO_OPENINGS' },
      { url: 'https://jobs.example.com/internship', pageStatus: 'BLOCKED', vacancyStatus: null },
      { url: 'https://jobs.example.com/graduate', pageStatus: 'FAILED', vacancyStatus: null },
      { url: 'https://jobs.example.com/jobs', pageStatus: 'DISCOVERED', vacancyStatus: null },
    ],
  }]);

  assert.equal(report.summary.entriesInspected, 4);
  assert.equal(report.summary.activeEntries, 0);
  assert.equal(report.summary.noOpeningEntries, 1);
  assert.equal(report.summary.unknownEntries, 1);
  assert.equal(report.summary.blockedEntries, 1);
  assert.equal(report.summary.failedEntries, 1);
});

test('continues sibling inspection after a blocked recruitment entry', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('示例公司 招聘')}`;
  const socialUrl = 'https://jobs.example.com/social';
  const campusUrl = 'https://jobs.example.com/campus';
  const internshipUrl = 'https://jobs.example.com/internship';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: '示例公司招聘',
      searchRows: [{
        title: '示例公司招聘',
        href: socialUrl,
        snippet: '示例公司招聘',
        kind: 'organic',
      }],
    },
    [socialUrl]: {
      text: '示例公司招聘',
      links: [
        { text: '校园招聘', href: campusUrl },
        { text: '实习生招聘', href: internshipUrl },
      ],
    },
    [campusUrl]: { text: 'captcha access denied', status: 403 },
    [internshipUrl]: { text: '实习生招聘 职位列表', links: [] },
  });

  const result = await discoverCompanyWithBrowser({
    company: '示例公司',
    officialDomain: 'example.com',
    browser,
  });

  assert.equal(
    result.officialCandidates.find((item) => item.url === campusUrl).pageStatus,
    'BLOCKED',
  );
  assert.equal(
    result.officialCandidates.find((item) => item.url === internshipUrl).pageStatus,
    'COMPLETED',
  );
  assert.ok(result.failures.some((item) => item.reasonCode === 'challenge_or_access_blocked'));
});

test('classifies a branded recruitment subdomain as an official candidate', () => {
  const result = classifySearchResult({
    company: '小红书',
    officialDomain: 'xiaohongshu.com',
    title: '小红书招聘',
    url: 'https://job.xiaohongshu.com/social/position',
    kind: 'organic',
  });

  assert.equal(result.classification, 'OFFICIAL_CANDIDATE');
  assert.equal(result.reasonCode, 'first_party_recruitment_url');
});

test('rejects advertisements, news, and a main business home page', () => {
  const company = '小红书';
  const officialDomain = 'xiaohongshu.com';

  assert.equal(classifySearchResult({ company, officialDomain, title: '推广 小红书招聘', url: 'https://job.xiaohongshu.com/', kind: 'advertisement' }).classification, 'REJECTED');
  assert.equal(classifySearchResult({ company, officialDomain, title: '小红书招聘新闻', url: 'https://example.com/news/xiaohongshu', kind: 'news' }).classification, 'REJECTED');
  assert.equal(classifySearchResult({ company, officialDomain, title: '小红书', url: 'https://www.xiaohongshu.com/', kind: 'organic' }).classification, 'REJECTED');
});

test('isolates matching Liepin and BOSS company pages as platform-only candidates', () => {
  const liepin = classifySearchResult({
    company: '希奥端', title: '希奥端招聘', url: 'https://www.liepin.com/company-jobs/13296749/', kind: 'organic',
  });
  const boss = classifySearchResult({
    company: '希奥端', title: '希奥端招聘', url: 'https://www.zhipin.com/gongsir/abc.html', kind: 'organic',
  });

  assert.deepEqual([liepin.classification, boss.classification], [
    'PLATFORM_CANDIDATE',
    'PLATFORM_CANDIDATE',
  ]);
  assert.equal(liepin.sourceTier, 'PLATFORM_ONLY');
  assert.equal(liepin.platform, 'LIEPIN');
  assert.equal(boss.platform, 'BOSS');
});

test('drills a campus landing page into internship and graduate recruitment types', () => {
  const links = discoverCareerLinks('https://hr.4399om.com/campus/', [
    { text: '实习生招聘', href: '/campus/internship' },
    { text: '应届生招聘', href: '/campus/graduate/' },
    { text: '公司首页', href: '/' },
  ]);

  assert.deepEqual(links.map(({ recruitmentType, url }) => ({ recruitmentType, url })), [
    { recruitmentType: 'INTERNSHIP', url: 'https://hr.4399om.com/campus/internship' },
    { recruitmentType: 'GRADUATE', url: 'https://hr.4399om.com/campus/graduate/' },
  ]);
});

test('reports completed and blocked companies without treating leads as official candidates', () => {
  const report = buildDiscoveryReport([
    { company: '小红书', status: 'COMPLETED', officialCandidates: [{ url: 'https://job.xiaohongshu.com/' }], leads: [] },
    { company: '希奥端', status: 'BLOCKED', officialCandidates: [], leads: [{ url: 'https://www.liepin.com/company-jobs/13296749/' }] },
  ]);

  assert.deepEqual(report.summary, {
    companies: 2,
    completed: 1,
    blocked: 1,
    failed: 0,
    officialCandidates: 1,
    leadOnly: 1,
    entriesInspected: 0,
    activeEntries: 0,
    noOpeningEntries: 0,
    unknownEntries: 0,
    blockedEntries: 0,
    failedEntries: 0,
  });
});

test('does not open ad or news search results in the browser', () => {
  assert.equal(shouldOpenSearchResult({ kind: 'advertisement' }), false);
  assert.equal(shouldOpenSearchResult({ kind: 'news' }), false);
  assert.equal(shouldOpenSearchResult({ kind: 'organic', url: 'https://jobs.example.com/' }), true);
  assert.equal(shouldOpenSearchResult({ kind: 'organic', url: 'javascript:void(0)' }), false);
  assert.equal(shouldOpenSearchResult({ kind: 'organic', url: 'https://www.baidu.com/link?url=abc' }), true);
  assert.equal(shouldOpenSearchResult({ kind: 'organic', url: 'https://www.baidu.com/s?wd=Example+Tech+jobs' }), false);
  assert.equal(shouldOpenSearchResult({ kind: 'organic', url: 'https://www.baidu.com/other.php?url=ad-target' }), false);
  assert.equal(shouldOpenSearchResult({ kind: 'organic', url: 'https://jobs.51job.com/example' }), false);
  assert.equal(shouldOpenSearchResult({
    company: '希奥端',
    title: '希奥端招聘',
    kind: 'organic',
    url: 'https://www.liepin.com/company-jobs/13296749/',
  }), true);
  assert.equal(shouldOpenSearchResult({
    company: '希奥端',
    title: '南京希奥端分公司招聘',
    kind: 'organic',
    url: 'https://www.liepin.com/company-jobs/13296749/',
  }), false);
});

test('inspects a matching platform company page without adding an official candidate', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('希奥端 招聘')}`;
  const platformUrl = 'https://www.liepin.com/company-jobs/13296749/';
  const jobUrl = 'https://www.liepin.com/job/123/';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: '希奥端 招聘',
      searchRows: [{
        title: '希奥端招聘',
        href: platformUrl,
        snippet: '希奥端招聘职位',
        kind: 'organic',
      }],
    },
    [platformUrl]: {
      title: '希奥端招聘',
      text: '希奥端招聘 职位列表 产品经理 南京',
      links: [{ text: '产品经理', href: jobUrl }],
    },
  });

  const result = await discoverCompanyWithBrowser({
    company: '希奥端',
    browser,
  });

  assert.equal(result.officialCandidates.length, 0);
  assert.equal(result.platformCandidates.length, 1);
  assert.equal(result.platformCandidates[0].sourceTier, 'PLATFORM_ONLY');
  assert.equal(result.platformCandidates[0].verificationStatus, 'REVIEW');
  assert.equal(result.platformCandidates[0].jobs[0].title, '产品经理');
});

test('resolves a Baidu result redirect before classifying the target page', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('Example Tech 招聘')}`;
  const redirectUrl = 'https://www.baidu.com/link?url=example-careers';
  const careerUrl = 'https://jobs.example.com/openings';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: 'Example Tech 招聘',
      searchRows: [{
        title: 'Example Tech careers',
        href: redirectUrl,
        snippet: 'Example Tech careers',
        kind: 'organic',
      }],
    },
    [redirectUrl]: {
      finalUrl: careerUrl,
      title: 'Example Tech careers',
      text: 'Example Tech 招聘职位列表',
      links: [],
    },
  });

  const result = await discoverCompanyWithBrowser({
    company: 'Example Tech',
    officialDomain: 'example.com',
    browser,
  });

  assert.equal(browser.visits.filter((url) => url === redirectUrl).length, 1);
  assert.equal(result.officialCandidates[0].url, careerUrl);
  assert.equal(result.officialCandidates[0].sourceUrl, redirectUrl);
  assert.equal(result.officialCandidates[0].classification, 'OFFICIAL_CANDIDATE');
});

test('opens a recruitment candidate only once and bounds candidate count', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('Example Tech 招聘')}`;
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    title: `Example Tech careers ${index}`,
    href: `https://jobs${index}.example.com/careers`,
    snippet: 'Example Tech careers',
    kind: 'organic',
  }));
  const pages = {
    [searchUrl]: { text: 'Example Tech 招聘', searchRows: candidates },
  };
  for (const row of candidates) {
    pages[row.href] = { title: row.title, text: 'Example Tech 招聘 职位列表', links: [] };
  }
  const browser = fakeBrowser(pages);

  const result = await discoverCompanyWithBrowser({
    company: 'Example Tech',
    browser,
    maxResults: 10,
    maxCandidates: 3,
  });

  assert.equal(result.officialCandidates.length, 3);
  for (const row of candidates.slice(0, 3)) {
    assert.equal(browser.visits.filter((url) => url === row.href).length, 1);
  }
  assert.equal(browser.visits.some((url) => url === candidates[3].href), false);
});

test('limits recruitment entry traversal to the configured page budget', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('Budget Tech 招聘')}`;
  const careerUrl = 'https://jobs.budget.example/careers';
  const children = Array.from({ length: 6 }, (_, index) => ({
    text: `岗位列表 ${index}`,
    href: `https://jobs.budget.example/jobs/${index}`,
  }));
  const pages = {
    [searchUrl]: {
      text: 'Budget Tech 招聘',
      searchRows: [{
        title: 'Budget Tech careers',
        href: careerUrl,
        snippet: 'Budget Tech careers',
        kind: 'organic',
      }],
    },
    [careerUrl]: { title: 'Budget Tech careers', text: 'Budget Tech 招聘 职位列表', links: children },
  };
  for (const child of children) {
    pages[child.href] = { title: child.text, text: 'Budget Tech 招聘 职位列表', links: [] };
  }
  const browser = fakeBrowser(pages);

  const result = await discoverCompanyWithBrowser({
    company: 'Budget Tech',
    officialDomain: 'budget.example',
    browser,
    maxCareerEntries: 3,
    maxDepth: 2,
  });

  assert.equal(result.observations.length, 3);
  assert.equal(browser.visits.filter((url) => url.startsWith('https://jobs.budget.example/')).length, 3);
});

test('detects Baidu safety verification as blocked instead of an empty search', () => {
  assert.equal(isSearchBlockedPage('百度安全验证\n请完成下方验证后继续操作\n拖动左侧滑块'), true);
  assert.equal(isSearchBlockedPage('小红书招聘职位列表'), false);
});

test('treats a blank 403 Baidu response as blocked', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('受限公司 招聘')}`;
  const result = await discoverCompanyWithBrowser({
    company: '受限公司',
    browser: fakeBrowser({
      [searchUrl]: {
        status: 403,
        text: '',
        searchRows: [],
      },
    }),
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reasonCode, 'search_challenge_or_access_blocked');
});

test('does not report an unreadable zero-row search DOM as completed', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('结构变化公司 招聘')}`;
  const result = await discoverCompanyWithBrowser({
    company: '结构变化公司',
    browser: fakeBrowser({
      [searchUrl]: {
        status: 200,
        text: '百度一下 搜索结果页面',
        searchRows: [],
      },
    }),
  });

  assert.equal(result.status, 'FAILED');
  assert.equal(result.reasonCode, 'search_results_unreadable');
  assert.ok(result.failures.some((failure) => (
    failure.stage === 'search'
      && failure.reasonCode === 'search_results_unreadable'
  )));
});

test('accepts an explicit Baidu no-results page as a completed empty search', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('不存在的公司 招聘')}`;
  const result = await discoverCompanyWithBrowser({
    company: '不存在的公司',
    browser: fakeBrowser({
      [searchUrl]: {
        status: 200,
        text: '抱歉，没有找到与“不存在的公司 招聘”相关的结果。',
        searchRows: [],
      },
    }),
  });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.officialCandidates.length, 0);
});
test('rejects Jobui before opening it', () => {
  const decision = classifySearchResult({
    company: '示例科技',
    title: '示例科技招聘',
    url: 'https://www.jobui.com/company/123/jobs/',
    kind: 'organic',
  });

  assert.deepEqual(decision, {
    classification: 'REJECTED',
    reasonCode: 'excluded_jobui_domain',
  });
  assert.equal(shouldOpenSearchResult({
    url: 'https://www.jobui.com/company/123/jobs/',
    kind: 'organic',
  }), false);
});

test('keeps recruitment-shaped ATS URL as an unverified candidate', () => {
  const decision = classifySearchResult({
    company: '示例科技',
    officialDomain: 'example.com',
    title: '示例科技招聘',
    url: 'https://example.jobs.mokahr.com/social-recruitment',
    kind: 'organic',
  });

  assert.equal(decision.classification, 'VERIFICATION_CANDIDATE');
  assert.equal(decision.reasonCode, 'recruitment_url_requires_verification');
});

test('normalizes the current Golden Dataset company schema', () => {
  const [company] = normalizeBrowserCompanyInput([{
    name_cn: '示例科技',
    name_en: 'Example Tech',
    aliases: ['示例'],
    industry: ['AI'],
    country_region: '中国大陆',
    official_domains: ['example.com'],
    sources: ['golden-v4'],
  }]);

  assert.equal(company.company, '示例科技');
  assert.equal(company.chineseName, '示例科技');
  assert.equal(company.englishName, 'Example Tech');
  assert.equal(company.officialDomain, 'example.com');
  assert.deepEqual(company.aliases, ['示例']);
  assert.deepEqual(company.industry, ['AI']);
  assert.equal(company.countryRegion, '中国大陆');
});

test('captures rendered DOM and explicit links for downstream verification', async () => {
  const socialUrl = 'https://jobs.example.com/social';
  const campusUrl = 'https://jobs.example.com/campus';
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('示例科技 招聘')}`;
  const now = '2026-07-25T00:00:00.000Z';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: '示例科技招聘',
      searchRows: [{
        title: '示例科技招聘',
        href: socialUrl,
        snippet: '示例科技社会招聘',
        kind: 'organic',
      }],
    },
    [socialUrl]: {
      title: '示例科技招聘',
      html: '<html><body><h1>招聘职位</h1><a href="/campus">校园招聘</a></body></html>',
      text: '招聘职位 校园招聘',
      links: [{ text: '校园招聘', href: campusUrl }],
    },
    [campusUrl]: {
      title: '校园招聘',
      html: '<html><body><h1>校园招聘</h1></body></html>',
      text: '校园招聘',
      links: [],
    },
  });

  const result = await discoverCompanyWithBrowser({
    company: '示例科技',
    officialDomain: 'example.com',
    browser,
    now: () => now,
  });

  const observation = result.observations.find((item) => item.finalUrl === socialUrl);
  assert.match(observation.html, /招聘职位/);
  assert.equal(observation.status, 200);
  assert.equal(observation.fetchStatus, 'COMPLETED');
  assert.equal(observation.observedAt, now);
  assert.deepEqual(observation.links[0], { text: '校园招聘', href: campusUrl });
});

test('local worker uses visible Google Chrome by default', () => {
  assert.deepEqual(buildBrowserLaunchOptions({}), {
    channel: 'chrome',
    headless: false,
  });
  assert.deepEqual(buildBrowserLaunchOptions({ headless: true }), {
    channel: 'chrome',
    headless: true,
  });
});

test('normal Chrome mode requires an injected extension binding', async () => {
  await assert.rejects(
    createBrowserRuntime({ mode: 'normal-chrome', chrome: null }),
    (error) => error.code === 'NOT_CONFIGURED',
  );
});

test('persistent Chrome mode launches an isolated visible profile explicitly', async () => {
  const launches = [];
  const context = {
    newPage: async () => ({}),
    close: async () => {},
  };
  const runtime = await createBrowserRuntime({
    mode: 'persistent-chrome',
    chromium: {
      async launchPersistentContext(profileDir, options) {
        launches.push({ profileDir, options });
        return context;
      },
    },
    profileDir: 'C:/tmp/lite-job-profile',
  });

  assert.equal(typeof runtime.newPage, 'function');
  assert.deepEqual(launches, [{
    profileDir: 'C:/tmp/lite-job-profile',
    options: { channel: 'chrome', headless: false },
  }]);
});

test('local worker bounds navigation and recursion settings', () => {
  assert.deepEqual(browserDiscoveryLimits({
    'max-results': '50',
    'max-candidates': '50',
    'max-career-entries': '50',
    'max-depth': '9',
    'timeout-ms': '999999',
    'search-delay-ms': '999999',
    'search-jitter-ms': '999999',
    'max-companies-per-run': '999',
  }), {
    maxResults: 20,
    maxCandidates: 5,
    maxCareerEntries: 10,
    maxDepth: 2,
    timeoutMs: 30_000,
    searchDelayMs: 60_000,
    searchJitterMs: 60_000,
    maxCompaniesPerRun: 100,
  });
});

test('local worker defaults to a low-frequency 10-company search run', () => {
  assert.deepEqual(browserDiscoveryLimits({}), {
    maxResults: 10,
    maxCandidates: 3,
    maxCareerEntries: 5,
    maxDepth: 2,
    timeoutMs: 10_000,
    searchDelayMs: 10_000,
    searchJitterMs: 20_000,
    maxCompaniesPerRun: 10,
  });
});

test('minimum search interval gate delays only subsequent searches', async () => {
  let clock = 1_000;
  const waits = [];
  const waitForSearchSlot = createMinimumSearchIntervalGate({
    minimumIntervalMs: 15_000,
    nowMs: () => clock,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
  });

  await waitForSearchSlot();
  clock += 2_500;
  await waitForSearchSlot();

  assert.deepEqual(waits, [12_500]);
});

test('normal Chrome binding supports an asynchronous tab URL with candidates', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('异步公司 招聘')}`;
  const careerUrl = 'https://jobs.example.com/openings';
  let currentUrl = '';
  const chrome = {
    tabs: {
      async new() {
        return {
          async goto(url) {
            currentUrl = url;
            return { status: () => 200 };
          },
          async url() {
            return currentUrl;
          },
          async title() {
            return currentUrl === careerUrl ? '异步公司招聘' : '百度搜索';
          },
          async close() {},
          playwright: {
            async waitForTimeout() {},
            async evaluate(callback, argument) {
              if (typeof argument === 'number') {
                return currentUrl === searchUrl ? [{
                  title: '异步公司招聘',
                  href: careerUrl,
                  snippet: '异步公司招聘职位',
                  kind: 'organic',
                }] : [];
              }
              if (String(callback).includes('document.documentElement')) {
                return {
                  text: '异步公司招聘职位列表',
                  html: '<main>异步公司招聘职位列表</main>',
                  title: '异步公司招聘',
                  h1: '招聘职位',
                  links: [],
                };
              }
              return currentUrl === searchUrl
                ? '异步公司招聘搜索结果'
                : '异步公司招聘职位列表';
            },
          },
        };
      },
    },
  };
  const browser = await createBrowserRuntime({
    mode: 'normal-chrome',
    chrome,
  });

  const result = await discoverCompanyWithBrowser({
    company: '异步公司',
    officialDomain: 'example.com',
    browser,
  });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.officialCandidates[0].url, careerUrl);
  await browser.close();
});
