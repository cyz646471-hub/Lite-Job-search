import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discoverRecruitmentEntries,
  recruitmentTypeForEntry,
} from '../src/discovery/recruitment-entry-discovery.mjs';

test('classifies Chinese and English recruitment entry labels', () => {
  const cases = [
    ['社会招聘', '/social', 'experienced'],
    ['Experienced hires', '/careers/experienced', 'experienced'],
    ['校园招聘', '/campus', 'campus'],
    ['Graduate programme', '/graduate', 'campus'],
    ['实习生招聘', '/internship', 'internship'],
    ['Intern opportunities', '/intern', 'internship'],
    ['全部职位', '/positions', 'general'],
    ['Open jobs', '/jobs', 'general'],
  ];

  for (const [text, url, expected] of cases) {
    assert.equal(recruitmentTypeForEntry(text, url), expected);
  }
  assert.equal(recruitmentTypeForEntry('公司首页', '/'), null);
});

test('discovers and canonicalizes first-party recruitment entries', () => {
  const entries = discoverRecruitmentEntries({
    baseUrl: 'https://zhaopin.example.com/social',
    trustedRegistrableDomains: ['example.com'],
    links: [
      { text: '校园招聘', href: '/campus' },
      { text: '社会招聘', href: '/social#top' },
      { text: '实习生招聘', href: '/internship' },
      { text: '公司首页', href: '/' },
    ],
  });

  assert.deepEqual(
    entries.map(({ recruitmentType, url }) => ({ recruitmentType, url })),
    [
      { recruitmentType: 'campus', url: 'https://zhaopin.example.com/campus' },
      { recruitmentType: 'internship', url: 'https://zhaopin.example.com/internship' },
    ],
  );
});

test('allows only trusted first-party or official-attributed ATS domains', () => {
  const entries = discoverRecruitmentEntries({
    baseUrl: 'https://jobs.example.com/',
    trustedRegistrableDomains: ['example.com'],
    knownAtsRegistrableDomains: ['mokahr.com'],
    parentOfficialVerified: true,
    links: [
      { text: '校园招聘', href: 'https://campus.example.com/jobs' },
      { text: '社会招聘', href: 'https://example.mokahr.com/social' },
      { text: '新闻报道', href: 'https://news.example.net/jobs' },
      { text: '猎聘职位', href: 'https://www.liepin.com/company-jobs/1/' },
    ],
  });

  assert.deepEqual(entries.map((entry) => entry.url), [
    'https://campus.example.com/jobs',
    'https://example.mokahr.com/social',
  ]);
});

test('skips authentication, employer publishing, and editorial content links', () => {
  const entries = discoverRecruitmentEntries({
    baseUrl: 'https://www.example.com/',
    trustedRegistrableDomains: ['example.com'],
    links: [
      { text: '招聘职位登录', href: 'https://passport.example.com/login?path=/jobs' },
      { text: '发布招聘职位', href: 'https://fabu.example.com/zhaopin/new' },
      { text: '产品经理招聘趋势', href: 'https://www.example.com/article/123' },
      { text: 'AI 产品经理', href: 'https://career.example.com/position/42/detail' },
      { text: '管理简历', href: 'https://career.example.com/resume.html' },
      { text: '加入我们', href: 'https://career.example.com/careers' },
    ],
  });

  assert.deepEqual(entries.map((entry) => entry.url), [
    'https://career.example.com/careers',
  ]);
});

test('verified official page may enqueue a known ATS tenant link', () => {
  const [entry] = discoverRecruitmentEntries({
    baseUrl: 'https://example.com/careers',
    links: [{ text: '查看职位', href: 'https://example.mokahr.com/jobs' }],
    trustedRegistrableDomains: ['example.com'],
    knownAtsRegistrableDomains: ['mokahr.com'],
    parentOfficialVerified: true,
  });

  assert.equal(entry.discoveryReason, 'verified_official_outbound_ats_link');
  assert.equal(entry.parentOfficialVerified, true);
  assert.equal(entry.officialAttributionUrl, 'https://example.com/careers');
});

test('official careers page may enqueue a first-party apply-jobs link and preserve filters', () => {
  const [entry] = discoverRecruitmentEntries({
    baseUrl: 'https://www.bosch.com.cn/careers/',
    links: [{
      text: '申请岗位',
      href: 'https://jobs.bosch.com/en/?country=cn',
    }],
    trustedRegistrableDomains: ['bosch.com', 'bosch.com.cn'],
    parentOfficialVerified: true,
  });

  assert.equal(entry.url, 'https://jobs.bosch.com/en/?country=cn');
  assert.equal(entry.recruitmentType, 'general');
  assert.equal(entry.discoveryReason, 'career_navigation_link');
});

test('ATS login page may return to a trusted recruitment homepage', () => {
  const [entry] = discoverRecruitmentEntries({
    baseUrl: 'https://ainnovation.zhiye.com/Portal/Account/Login',
    links: [{
      text: '回到招聘首页',
      href: 'https://ainnovation.zhiye.com/Campus',
    }],
    trustedRegistrableDomains: ['zhiye.com'],
  });

  assert.equal(entry.url, 'https://ainnovation.zhiye.com/Campus');
  assert.equal(entry.recruitmentType, 'general');
});

test('unverified page cannot authorize a cross-domain ATS link', () => {
  const entries = discoverRecruitmentEntries({
    baseUrl: 'https://example.net/list',
    links: [{ text: '查看职位', href: 'https://example.mokahr.com/jobs' }],
    knownAtsRegistrableDomains: ['mokahr.com'],
    parentOfficialVerified: false,
  });

  assert.deepEqual(entries, []);
});

test('deduplicates canonical URLs and respects depth and entry budgets', () => {
  const links = [
    { text: '校园招聘', href: '/campus#top' },
    { text: '校园岗位', href: '/campus' },
    { text: '社会招聘', href: '/social' },
    { text: '实习招聘', href: '/internship' },
  ];

  assert.deepEqual(
    discoverRecruitmentEntries({
      baseUrl: 'https://jobs.example.com/',
      trustedRegistrableDomains: ['example.com'],
      links,
      visitedUrls: ['https://jobs.example.com/social'],
      maxEntries: 1,
    }).map((entry) => entry.url),
    ['https://jobs.example.com/campus'],
  );

  assert.deepEqual(discoverRecruitmentEntries({
    baseUrl: 'https://jobs.example.com/',
    trustedRegistrableDomains: ['example.com'],
    links,
    depth: 3,
    maxDepth: 2,
  }), []);
});

test('preserves parent and depth evidence for child entries', () => {
  const [entry] = discoverRecruitmentEntries({
    baseUrl: 'https://jobs.example.com/social',
    trustedRegistrableDomains: ['example.com'],
    links: [{ text: '校园招聘', href: '/campus' }],
    parentUrl: 'https://jobs.example.com/social',
    depth: 2,
  });

  assert.deepEqual(entry, {
    url: 'https://jobs.example.com/campus',
    text: '校园招聘',
    recruitmentType: 'campus',
    parentUrl: 'https://jobs.example.com/social',
    depth: 2,
    discoveryReason: 'career_navigation_link',
  });
  assert.ok(Object.isFrozen(entry));
});
