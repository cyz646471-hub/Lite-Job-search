import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPublicSearchBlockedSnapshot,
  normalizePublicSearchEngine,
  publicSearchUrl,
  readPublicSearchRows,
} from '../src/adapters/browser/public-search-page-adapter.mjs';

test('allows explicit Baidu or Google selection without accepting unknown engines', () => {
  assert.equal(normalizePublicSearchEngine('BAIDU'), 'baidu');
  assert.equal(normalizePublicSearchEngine('Google'), 'google');
  assert.match(publicSearchUrl('baidu', 'Example Company jobs'), /^https:\/\/www\.baidu\.com\/s\?wd=/);
  assert.match(
    publicSearchUrl('google', '示例公司 招聘官网'),
    /^https:\/\/www\.google\.com\/search\?q=.*&hl=zh-CN$/,
  );
  assert.throws(() => normalizePublicSearchEngine('bing'), /unsupported public search engine/i);
});

test('recognizes Baidu access challenges as blocked', () => {
  assert.equal(isPublicSearchBlockedSnapshot({ engine: 'baidu', text: '安全验证' }), true);
  assert.equal(isPublicSearchBlockedSnapshot({ engine: 'baidu', text: 'ordinary public search result' }), false);
});

test('recognizes Google challenge pages without treating ordinary results as blocked', () => {
  assert.equal(isPublicSearchBlockedSnapshot({
    engine: 'google',
    text: 'Our systems have detected unusual traffic from your computer network',
  }), true);
  assert.equal(isPublicSearchBlockedSnapshot({
    engine: 'google',
    text: '示例公司招聘官网',
    url: 'https://www.google.com/search?q=example',
  }), false);
});

test('Google result adapter returns bounded external organic rows', async () => {
  const rows = await readPublicSearchRows({
    locator(selector) {
      assert.match(selector, /#search/);
      return {
        async evaluateAll(_reader, maximum) {
          assert.equal(maximum, 2);
          return [
            {
              title: '示例公司招聘官网',
              href: 'https://jobs.example.com/',
              snippet: '示例公司招聘职位',
              kind: 'organic',
            },
          ];
        },
      };
    },
  }, 'google', 2);
  assert.deepEqual(rows, [{
    title: '示例公司招聘官网',
    href: 'https://jobs.example.com/',
    snippet: '示例公司招聘职位',
    kind: 'organic',
  }]);
});
