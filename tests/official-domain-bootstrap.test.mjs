import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapOfficialDomain } from '../src/verification/official-domain-bootstrap.mjs';

test('confirms a first-party recruitment domain from independent brand fields', () => {
  const result = bootstrapOfficialDomain({
    company: {
      canonicalName: '米哈游',
      aliases: [],
    },
    candidate: {
      url: 'https://jobs.mihoyo.com/',
    },
    page: {
      status: 200,
      finalUrl: 'https://jobs.mihoyo.com/',
      title: '米哈游招聘',
      html: '<main><h1>加入米哈游</h1><p>开放职位</p></main>',
    },
    pageType: 'CAREER_HOME',
    atsType: '',
  });

  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.registrableDomain, 'mihoyo.com');
  assert.deepEqual(result.matchedSignals, ['title', 'h1']);
});

test('requires two independent page fields instead of repeated body text', () => {
  const result = bootstrapOfficialDomain({
    company: {
      canonicalName: '示例科技',
      aliases: [],
    },
    candidate: {
      url: 'https://jobs.example.com/',
    },
    page: {
      status: 200,
      finalUrl: 'https://jobs.example.com/',
      title: '招聘职位',
      html: '<main><h1>加入我们</h1><p>示例科技 示例科技 示例科技</p></main>',
    },
    pageType: 'CAREER_HOME',
    atsType: '',
  });

  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.registrableDomain, null);
});

test('does not confirm an unrelated recruitment domain', () => {
  const result = bootstrapOfficialDomain({
    company: {
      canonicalName: '米哈游',
      aliases: [],
    },
    candidate: {
      url: 'https://jobs.unrelated.example/',
    },
    page: {
      status: 200,
      finalUrl: 'https://jobs.unrelated.example/',
      title: '其他公司招聘',
      html: '<main><h1>加入其他公司</h1><p>开放职位</p></main>',
    },
    pageType: 'CAREER_HOME',
    atsType: '',
  });

  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
});

test('ATS tenants cannot bootstrap an official company domain', () => {
  const result = bootstrapOfficialDomain({
    company: {
      canonicalName: '示例科技',
      aliases: [],
    },
    candidate: {
      url: 'https://app.mokahr.com/campus-recruitment/example/123',
    },
    page: {
      status: 200,
      finalUrl: 'https://app.mokahr.com/campus-recruitment/example/123',
      title: '示例科技招聘',
      html: '<main><h1>示例科技校园招聘</h1></main>',
    },
    pageType: 'CAMPAIGN',
    atsType: 'MOKA',
  });

  assert.equal(result.status, 'INELIGIBLE');
  assert.equal(result.reasonCode, 'ats_domain');
});

test('hard-excluded recruitment aggregators cannot bootstrap', () => {
  for (const url of [
    'https://www.jobui.com/company/123/jobs/',
    'https://jobs.51job.com/example/',
    'https://www.zhipin.com/gongsi/job/example.html',
  ]) {
    const result = bootstrapOfficialDomain({
      company: {
        canonicalName: '示例科技',
        aliases: [],
      },
      candidate: { url },
      page: {
        status: 200,
        finalUrl: url,
        title: '示例科技招聘',
        html: '<main><h1>示例科技招聘职位</h1></main>',
      },
      pageType: 'JOB_LIST',
      atsType: '',
    });

    assert.equal(result.status, 'INELIGIBLE', url);
    assert.equal(result.reasonCode, 'excluded_domain', url);
  }
});

test('blocked and unknown-role pages cannot bootstrap', () => {
  const blocked = bootstrapOfficialDomain({
    company: { canonicalName: '示例科技', aliases: [] },
    candidate: { url: 'https://jobs.example.com/' },
    page: {
      status: 403,
      finalUrl: 'https://jobs.example.com/',
      title: '示例科技招聘',
      html: '<h1>示例科技招聘</h1>',
    },
    pageType: 'CAREER_HOME',
    atsType: '',
  });
  const unknown = bootstrapOfficialDomain({
    company: { canonicalName: '示例科技', aliases: [] },
    candidate: { url: 'https://www.example.com/' },
    page: {
      status: 200,
      finalUrl: 'https://www.example.com/',
      title: '示例科技',
      html: '<h1>示例科技</h1>',
    },
    pageType: 'UNKNOWN',
    atsType: '',
  });

  assert.equal(blocked.status, 'INELIGIBLE');
  assert.equal(blocked.reasonCode, 'unreachable');
  assert.equal(unknown.status, 'INELIGIBLE');
  assert.equal(unknown.reasonCode, 'unknown_page_role');
});
