import assert from 'node:assert/strict';
import test from 'node:test';

import { buildControlCompanyList } from '../src/application/build-control-company-list.mjs';

const items = [
  {
    itemKey: 'a',
    position: 0,
    input: {
      company: '阿里巴巴',
      market: 'CN',
      countryRegion: 'China',
      officialDomain: 'alibabagroup.com',
    },
    status: 'PENDING',
    attemptCount: 0,
  },
  {
    itemKey: 'b',
    position: 1,
    input: {
      company: '百度',
      market: 'CN',
      countryRegion: '中国大陆',
      officialDomain: 'baidu.com',
    },
    status: 'FAILED',
    attemptCount: 2,
    errorMessage: 'candidate_page_blocked',
  },
  {
    itemKey: 'c',
    position: 2,
    input: { company: '腾讯', market: 'CN', countryRegion: 'China' },
    status: 'SUCCEEDED',
    attemptCount: 1,
  },
];

test('remaining company list is searchable, paginated, and excludes succeeded items', () => {
  const repository = { listBatchItems: () => items };
  const remaining = buildControlCompanyList({
    repository,
    batchId: 'batch-cn',
    scope: 'REMAINING',
    limit: 1,
  });
  assert.equal(remaining.total, 2);
  assert.equal(remaining.items.length, 1);
  assert.equal(remaining.items[0].company, '阿里巴巴');
  assert.equal(remaining.counts.SUCCEEDED, 1);

  const searched = buildControlCompanyList({
    repository,
    batchId: 'batch-cn',
    scope: 'REMAINING',
    query: 'baidu.com',
  });
  assert.equal(searched.total, 1);
  assert.equal(searched.items[0].company, '百度');
  assert.equal(searched.items[0].reason, 'candidate_page_blocked');
});
