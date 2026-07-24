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

test('allows only trusted first-party or verified ATS domains', () => {
  const entries = discoverRecruitmentEntries({
    baseUrl: 'https://jobs.example.com/',
    trustedRegistrableDomains: ['example.com'],
    verifiedAtsDomains: ['mokahr.com'],
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
