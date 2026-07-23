import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJobResult,
  searchCompany,
  verifyCandidates,
} from '../src/index.mjs';

test('legacy public entrypoints remain exported', () => {
  assert.equal(typeof searchCompany, 'function');
  assert.equal(typeof verifyCandidates, 'function');
  assert.equal(typeof createJobResult, 'function');
});

test('legacy JobResult keeps recruitment URL roles separate', () => {
  const result = createJobResult({
    market: 'CN',
    company: '示例公司',
    title: 'AI 产品经理',
    companyCareerHomeUrl: 'https://example.com/careers',
    jobListUrl: 'https://example.com/jobs',
  });

  assert.equal(result.companyCareerHomeUrl, 'https://example.com/careers');
  assert.equal(result.jobListUrl, 'https://example.com/jobs');
  assert.equal(result.jobDetailUrl, null);
  assert.equal(result.applyUrl, null);
});
