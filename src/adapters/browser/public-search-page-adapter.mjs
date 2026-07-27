import { isBaiduBlockedSnapshot, readBaiduRows } from './baidu-search-page-adapter.mjs';

const ENGINES = new Set(['baidu']);

export function normalizePublicSearchEngine(value = 'baidu') {
  const engine = String(value || 'baidu').trim().toLowerCase();
  if (!ENGINES.has(engine)) throw new Error(`unsupported public search engine: ${engine}`);
  return engine;
}

export function publicSearchUrl(engine, query) {
  const normalized = normalizePublicSearchEngine(engine);
  const encoded = encodeURIComponent(String(query || '').trim());
  return `https://www.baidu.com/s?wd=${encoded}`;
}

export function isPublicSearchBlockedSnapshot({ engine = 'baidu', text = '', status = 200, url = '' } = {}) {
  normalizePublicSearchEngine(engine);
  return isBaiduBlockedSnapshot({ text, status, url });
}

export async function readPublicSearchRows(page, engine = 'baidu', limit = 10) {
  const normalized = normalizePublicSearchEngine(engine);
  const maximum = Math.max(1, Math.min(20, Number(limit) || 10));
  if (normalized === 'baidu') return readBaiduRows(page, maximum);
  return readBaiduRows(page, maximum);
}
