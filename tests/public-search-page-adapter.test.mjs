import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPublicSearchBlockedSnapshot,
  normalizePublicSearchEngine,
  publicSearchUrl,
} from '../src/adapters/browser/public-search-page-adapter.mjs';

test('allows Baidu only and has no automatic engine fallback', () => {
  assert.equal(normalizePublicSearchEngine('BAIDU'), 'baidu');
  assert.match(publicSearchUrl('baidu', 'Example Company jobs'), /^https:\/\/www\.baidu\.com\/s\?wd=/);
  assert.throws(() => normalizePublicSearchEngine('bing'), /unsupported public search engine/i);
});

test('recognizes Baidu access challenges as blocked', () => {
  assert.equal(isPublicSearchBlockedSnapshot({ engine: 'baidu', text: '安全验证' }), true);
  assert.equal(isPublicSearchBlockedSnapshot({ engine: 'baidu', text: 'ordinary public search result' }), false);
});
