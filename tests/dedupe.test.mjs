import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupeResults, stableJobKey } from '../src/core/dedupe.mjs';

test('stableJobKey includes market so CN and NA results never merge', () => {
  const base = { company: 'Acme', title: 'Intern', location: 'Remote' };
  assert.notEqual(
    stableJobKey({ ...base, market: 'CN' }),
    stableJobKey({ ...base, market: 'NA' }),
  );
});

test('dedupeResults keeps the deepest official URL and merges source evidence', () => {
  const merged = dedupeResults([
    {
      market: 'CN',
      company: '腾讯',
      title: '产品实习生',
      location: '深圳',
      sourceUrl: 'https://www.nowcoder.com/jobs/1',
      companyCareerHomeUrl: 'https://join.tencent.com/',
      evidence: [{ source: 'nowcoder' }],
    },
    {
      market: 'CN',
      company: '腾讯',
      title: '产品实习生',
      location: '深圳',
      sourceUrl: 'https://join.tencent.com/campus.html',
      jobListUrl: 'https://join.tencent.com/campus/jobs',
      evidence: [{ source: 'official' }],
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].jobListUrl, 'https://join.tencent.com/campus/jobs');
  assert.equal(merged[0].companyCareerHomeUrl, 'https://join.tencent.com/');
  assert.equal(merged[0].evidence.length, 2);
  assert.deepEqual(merged[0].sourceUrls.sort(), [
    'https://join.tencent.com/campus.html',
    'https://www.nowcoder.com/jobs/1',
  ]);
});

