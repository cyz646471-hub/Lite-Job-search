import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJobResult,
  normalizeMarket,
  selectBestEntryUrl,
} from '../src/core/contracts.mjs';

test('normalizeMarket isolates CN and NA and rejects unknown regions', () => {
  assert.equal(normalizeMarket('china'), 'CN');
  assert.equal(normalizeMarket('us'), 'NA');
  assert.throws(() => normalizeMarket('EU'), /unsupported market/);
});

test('createJobResult keeps recruitment link roles separate', () => {
  const result = createJobResult({
    market: 'CN',
    company: '小红书',
    title: '产品实习生',
    sourceUrl: 'https://www.gankinterview.cn/job/1',
    companyCareerHomeUrl: 'https://job.xiaohongshu.com/',
    jobListUrl: 'https://job.xiaohongshu.com/campus/position',
  });
  assert.equal(result.sourceUrl, 'https://www.gankinterview.cn/job/1');
  assert.equal(result.companyCareerHomeUrl, 'https://job.xiaohongshu.com/');
  assert.equal(result.jobListUrl, 'https://job.xiaohongshu.com/campus/position');
  assert.equal(result.applyUrl, null);
  assert.equal(result.jobDetailUrl, null);
});

test('selectBestEntryUrl uses the deepest available verified role', () => {
  assert.deepEqual(
    selectBestEntryUrl({
      companyCareerHomeUrl: 'https://example.com/careers',
      jobListUrl: 'https://example.com/jobs',
      applyUrl: 'https://example.com/jobs/1/apply',
    }),
    { role: 'DIRECT_APPLICATION', url: 'https://example.com/jobs/1/apply' },
  );
});

