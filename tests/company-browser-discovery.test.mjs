import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiscoveryReport,
  classifySearchResult,
  discoverCareerLinks,
  discoverCompanyWithBrowser,
  isSearchBlockedPage,
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
          if (selector !== 'a[href]') return [];
          return current.searchRows || current.links || [];
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

test('isolates matching Liepin and BOSS company pages as lead-only', () => {
  const liepin = classifySearchResult({
    company: '希奥端', title: '希奥端招聘', url: 'https://www.liepin.com/company-jobs/13296749/', kind: 'organic',
  });
  const boss = classifySearchResult({
    company: '希奥端', title: '希奥端招聘', url: 'https://www.zhipin.com/gongsir/abc.html', kind: 'organic',
  });

  assert.deepEqual([liepin.classification, boss.classification], ['LEAD_ONLY', 'LEAD_ONLY']);
  assert.equal(liepin.platform, 'Liepin');
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
  assert.equal(shouldOpenSearchResult({ kind: 'organic' }), true);
});

test('detects Baidu safety verification as blocked instead of an empty search', () => {
  assert.equal(isSearchBlockedPage('百度安全验证\n请完成下方验证后继续操作\n拖动左侧滑块'), true);
  assert.equal(isSearchBlockedPage('小红书招聘职位列表'), false);
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
