import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiscoveryReport, classifySearchResult, discoverCareerLinks, isSearchBlockedPage, shouldOpenSearchResult } from '../scripts/company-browser-discovery.mjs';

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
