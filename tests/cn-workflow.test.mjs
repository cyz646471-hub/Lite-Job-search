import assert from 'node:assert/strict';
import test from 'node:test';

import { searchCompany } from '../src/pipeline/search-company.mjs';
import { verifyCandidates } from '../src/pipeline/verify-candidates.mjs';

test('CN company search stops after a high-confidence official domain hit', async () => {
  let calls = 0;
  const router = {
    search: async () => {
      calls += 1;
      return {
        status: 'ok',
        provider: 'fixture',
        items: [{
          title: '小红书招聘官网 - 职位列表',
          url: 'https://job.xiaohongshu.com/campus/position',
          snippet: '小红书校园招聘职位',
        }],
        attempts: [],
      };
    },
  };
  const result = await searchCompany({
    market: 'CN',
    company: '小红书',
    officialDomain: 'xiaohongshu.com',
    router,
    maxQueries: 3,
  });
  assert.equal(result.status, 'candidates_found');
  assert.equal(result.queriesExecuted.length, 1);
  assert.equal(calls, 1);
  assert.equal(result.candidates[0].decision, 'auto_verify');
});

test('CN candidate verification assigns a JOB_LIST URL without fabricating applyUrl', async () => {
  const [verified] = await verifyCandidates([{
    market: 'CN',
    company: '小红书',
    url: 'https://job.xiaohongshu.com/campus/position',
    officialDomain: 'xiaohongshu.com',
    source: 'fixture',
  }], {
    fetchPage: async () => ({
      status: 200,
      finalUrl: 'https://job.xiaohongshu.com/campus/position',
      html: '<title>小红书招聘</title><h1>招聘职位</h1><a href="/job/1">产品实习生</a><a href="/job/2">运营实习生</a>',
    }),
  });
  assert.equal(verified.officialIdentityConfirmed, true);
  assert.equal(verified.jobListUrl, 'https://job.xiaohongshu.com/campus/position');
  assert.equal(verified.applyUrl, null);
});

