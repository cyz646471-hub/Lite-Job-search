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
  probePublicSearchHealth,
  shouldOpenSearchResult,
} from '../scripts/company-browser-discovery.mjs';
import {
  buildCompanyQueryLadder,
  buildCompanyQueryPlan,
} from '../src/discovery/company-query-ladder.mjs';
import {
  canonicalHost,
  officialHomepageCandidates,
  sameCanonicalHost,
} from '../src/discovery/canonical-domain-resolver.mjs';
import { publicSearchUrl } from '../src/adapters/browser/public-search-page-adapter.mjs';

function fakeBrowser(pages) {
  const visits = [];
  let currentUrl = '';
  const currentFixture = () => {
    let current = pages[currentUrl];
    if (!current && currentUrl.startsWith('https://www.baidu.com/s?wd=')) {
      const query = new URL(currentUrl).searchParams.get('wd') || '';
      const company = query
        .replace(/\s+(?:招聘官网|校园招聘|社会招聘|招聘|careers|jobs)$/i, '')
        .replace(/^site:\S+\s+/i, '');
      const legacy = `https://www.baidu.com/s?wd=${encodeURIComponent(`${company} 招聘`)}`;
      current = pages[legacy];
    }
    return current || {};
  };
  const page = {
    async goto(url) {
      currentUrl = url;
      visits.push(url);
      const current = currentFixture();
      if (current.error) throw current.error;
      return { status: () => current.status || 200 };
    },
    async waitForTimeout() {},
    url() {
      return currentFixture().finalUrl || currentUrl;
    },
    async title() {
      return currentFixture().title || '';
    },
    locator(selector) {
      const current = currentFixture();
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

test('reviewed domain knowledge replaces the stale 360 Finance domain', () => {
  const [company] = normalizeBrowserCompanyInput([{
    company: '360 数科',
    officialDomains: ['360shuoke.com'],
  }]);

  assert.equal(company.officialDomain, 'qifu.tech');
  assert.deepEqual(company.officialDomains, ['qifu.tech', '360shuke.com']);
  assert.deepEqual(company.rejectedOfficialDomains, ['360shuoke.com']);
  assert.ok(company.aliases.includes('奇富科技'));
  assert.match(company.domainKnowledgeEvidence, /Qifu Technology/);
});

test('reviewed company knowledge preserves unusual first-party recruitment paths', () => {
  const [huasheng] = normalizeBrowserCompanyInput([{
    company: '华盛证券',
    officialDomains: ['hstong.com'],
  }]);
  const [bosch] = normalizeBrowserCompanyInput([{
    company: '博世',
    officialDomains: ['bosch.com'],
  }]);

  assert.deepEqual(huasheng.reviewedCareerPortals, [
    'https://www.hstong.com/hk/about/recruit',
  ]);
  assert.ok(bosch.reviewedCareerPortals.includes(
    'https://jobs.bosch.com/en/?country=cn',
  ));
});

test('builds market-aware deterministic query ladders', () => {
  assert.deepEqual(buildCompanyQueryLadder({
    company: '示例公司',
    officialDomain: 'www.example.com',
    market: 'CN',
  }), [
    '示例公司 招聘官网',
    '示例公司 校园招聘',
    '示例公司 社会招聘',
    'site:example.com 招聘',
  ]);
  assert.deepEqual(buildCompanyQueryLadder({
    company: '示例中国名',
    englishName: 'Example Inc',
    officialDomain: 'example.com',
    market: 'NA',
  }), [
    'Example Inc careers',
    'Example Inc jobs',
    'site:example.com careers',
  ]);
});

test('builds tiered Google queries for Chinese official recruitment sites', () => {
  const plan = buildCompanyQueryPlan({
    company: '示例公司',
    officialDomain: 'example.com',
    market: 'CN',
    searchEngine: 'google',
  });
  assert.deepEqual(plan.map((step) => step.tier), [1, 2, 2, 2, 3]);
  assert.deepEqual(plan.map((step) => step.purpose), [
    'official_career_home',
    'campus_recruitment',
    'experienced_recruitment',
    'internship_recruitment',
    'known_domain_recruitment',
  ]);
  assert.match(plan[0].text, /^"示例公司" 招聘官网/);
  assert.match(plan[0].text, /-site:jobui\.com/);
  assert.match(plan[4].text, /^site:example\.com/);
  assert.ok(plan.every((step) => !/\bcareers?\b/i.test(step.text)));
});

test('Google browser discovery executes the tiered Chinese official query', async () => {
  const [firstStep] = buildCompanyQueryPlan({
    company: '示例公司',
    officialDomain: 'example.com',
    market: 'CN',
    searchEngine: 'google',
  });
  const searchUrl = publicSearchUrl('google', firstStep.text);
  const careerUrl = 'https://jobs.example.com/positions';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: '示例公司招聘官网',
      searchRows: [{
        title: '示例公司招聘官网',
        href: careerUrl,
        snippet: '示例公司官方招聘职位',
        kind: 'organic',
      }],
    },
    [careerUrl]: {
      title: '示例公司招聘',
      text: '示例公司 招聘 职位列表 产品经理 上海 立即申请',
      links: [],
    },
  });
  const result = await discoverCompanyWithBrowser({
    company: '示例公司',
    officialDomain: 'example.com',
    market: 'CN',
    searchEngine: 'google',
    browser,
    maxCandidates: 1,
  });
  assert.equal(result.discoveryProvider, 'chrome_google_visible_search');
  assert.equal(result.queryPlan[0].tier, 1);
  assert.equal(result.queryPlan[0].status, 'COMPLETED');
  assert.equal(result.queries[0], firstStep.text);
  assert.ok(browser.visits.includes(searchUrl));
  assert.ok(browser.visits.includes(careerUrl));
});

test('Google health probe requires a readable real result page', async () => {
  const searchUrl = publicSearchUrl('google', '招聘官网');
  const browser = fakeBrowser({
    [searchUrl]: {
      text: '招聘官网搜索结果',
      searchRows: [{
        title: '示例招聘官网',
        href: 'https://jobs.example.com/',
        snippet: '公开职位',
        kind: 'organic',
      }],
    },
  });
  assert.deepEqual(await probePublicSearchHealth({
    browser,
    engine: 'google',
  }), {
    healthy: true,
    reasonCode: null,
  });
});

test('restores apex and www official homepage candidates deterministically', () => {
  assert.equal(canonicalHost('https://www.example.com/path'), 'example.com');
  assert.deepEqual(officialHomepageCandidates('www.example.com'), [
    'https://example.com/',
    'https://www.example.com/',
    'http://example.com/',
    'http://www.example.com/',
  ]);
  assert.equal(sameCanonicalHost('https://global.example.com/', 'example.com'), true);
});

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

test('does not treat a recruitment result login snippet as a Baidu challenge', () => {
  assert.equal(isSearchBlockedPage(
    '猎聘 公司招聘信息 登录/注册 密码登录 +86 获取验证码 登录 同意用户协议',
    {
      status: 200,
      url: 'https://www.baidu.com/s?wd=Example+Tech+jobs',
    },
  ), false);
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

test('marks Jobui invalid and continues to a later official recruitment result', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('Example Tech 招聘')}`;
  const jobuiUrl = 'https://www.jobui.com/company/123/jobs/';
  const officialUrl = 'https://jobs.example.com/positions';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: 'Example Tech 招聘',
      searchRows: [{
        title: 'Example Tech招聘 - 职友集',
        href: jobuiUrl,
        snippet: '职友集公司招聘',
        kind: 'organic',
      }, {
        title: 'Example Tech官方招聘',
        href: officialUrl,
        snippet: '职位列表',
        kind: 'organic',
      }],
    },
    [officialUrl]: {
      title: 'Example Tech官方招聘',
      text: 'Example Tech 招聘职位列表 Product Manager',
      links: [],
    },
  });

  const result = await discoverCompanyWithBrowser({
    company: 'Example Tech',
    officialDomain: 'example.com',
    browser,
    maxCandidates: 1,
  });

  assert.equal(browser.visits.includes(jobuiUrl), false);
  assert.equal(browser.visits.includes(officialUrl), true);
  assert.equal(
    result.rejected.find((item) => item.url === jobuiUrl)?.reasonCode,
    'excluded_jobui_domain',
  );
  assert.equal(result.officialCandidates[0].url, officialUrl);
});

test('falls back to one known official homepage and follows its recruitment link', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('Example Tech 招聘')}`;
  const officialHomeUrl = 'https://example.com/';
  const careersUrl = 'https://jobs.example.com/positions';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: '没有找到相关结果',
      searchRows: [],
    },
    [officialHomeUrl]: {
      title: 'Example Tech',
      text: 'Example Tech 企业官网',
      links: [{ text: '加入我们', href: careersUrl }],
    },
    [careersUrl]: {
      title: 'Example Tech 招聘',
      text: 'Example Tech 招聘职位列表 Product Manager',
      links: [],
    },
  });

  const result = await discoverCompanyWithBrowser({
    company: 'Example Tech',
    officialDomain: 'example.com',
    browser,
  });

  assert.equal(browser.visits.filter((url) => url === officialHomeUrl).length, 1);
  assert.equal(browser.visits.filter((url) => url === careersUrl).length, 1);
  assert.equal(result.officialCandidates.some((item) => item.url === careersUrl), true);
});

test('known official homepage is evidence only and is not itself a recruitment candidate', async () => {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('Example Academy 招聘')}`;
  const officialHomeUrl = 'https://example.com/';
  const browser = fakeBrowser({
    [searchUrl]: {
      text: '没有找到相关结果',
      searchRows: [],
    },
    [officialHomeUrl]: {
      title: 'Example Academy 技术学习平台',
      text: 'Example Academy 技术学习平台 招聘讲师 职位课程 岗位能力培训',
      links: [{ text: '课程岗位介绍', href: 'https://example.com/course/jobs' }],
    },
  });

  const result = await discoverCompanyWithBrowser({
    company: 'Example Academy',
    officialDomain: 'example.com',
    browser,
  });

  assert.equal(browser.visits.filter((url) => url === officialHomeUrl).length, 1);
  assert.equal(result.officialCandidates.some((item) => item.url === officialHomeUrl), false);
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

test('applies reviewed company domain corrections before search planning', () => {
  const [company] = normalizeBrowserCompanyInput([{
    name_cn: '霸王茶姬',
    name_en: 'CHAGEE',
    official_domains: ['chatee.com'],
  }]);

  assert.equal(company.officialDomain, 'chagee.com');
  assert.deepEqual(company.officialDomains, ['chagee.com']);
  assert.match(company.domainKnowledgeEvidence, /replaces erroneous chatee\.com/);
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

test('normal Chrome starts a clean work tab after the previous company closes', async () => {
  let created = 0;
  const chrome = {
    tabs: {
      async new() {
        created++;
        return {
          goto: async () => ({ status: () => 200 }),
          url: async () => 'https://example.com/',
          title: async () => 'Example',
          close: async () => {},
          playwright: {
            waitForTimeout: async () => {},
            evaluate: async () => '',
          },
        };
      },
    },
  };
  const browser = await createBrowserRuntime({
    mode: 'normal-chrome',
    chrome,
  });

  const first = await browser.newPage();
  await first.close();
  await browser.newPage();

  assert.equal(created, 2);
  await browser.close();
});

test('normal Chrome discards a poisoned work tab even when tab cleanup fails', async () => {
  let created = 0;
  const chrome = {
    tabs: {
      async new() {
        created++;
        return {
          goto: async () => ({ status: () => 200 }),
          url: async () => 'https://example.com/',
          title: async () => 'Example',
          close: async () => {
            throw new Error('cannot attach to stale tab');
          },
          playwright: {
            waitForTimeout: async () => {},
            evaluate: async () => '',
          },
        };
      },
    },
  };
  const browser = await createBrowserRuntime({
    mode: 'normal-chrome',
    chrome,
  });

  const first = await browser.newPage();
  await first.close();
  await browser.newPage();

  assert.equal(created, 2);
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
    options: {
      channel: 'chrome',
      headless: false,
      chromiumSandbox: true,
      viewport: null,
      args: [],
    },
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
    maxCompaniesPerRun: 200,
  });
});

test('local worker defaults to a bounded 10-company search run', () => {
  assert.deepEqual(browserDiscoveryLimits({}), {
    maxResults: 10,
    maxCandidates: 3,
    maxCareerEntries: 5,
    maxDepth: 2,
    timeoutMs: 10_000,
    searchDelayMs: 4_000,
    searchJitterMs: 20_000,
    maxCompaniesPerRun: 10,
  });
});

test('local worker clamps an unsafe sub-four-second search delay', () => {
  assert.equal(browserDiscoveryLimits({
    'search-delay-ms': '1000',
  }).searchDelayMs, 4_000);
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
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('异步公司 招聘官网')}`;
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
