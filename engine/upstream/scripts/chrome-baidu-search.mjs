const MAX_NATURAL_RESULTS = 8;

function text(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function labelsOf(row) { return [...(Array.isArray(row?.labels) ? row.labels : []), row?.kind, row?.snippet].map(text).join(' '); }
function excluded(row) { return /(?:广告|推广|赞助|资讯|新闻|百家号|sponsored|advertisement)/i.test(labelsOf(row)); }
function isBaiduInternalSearch(url) {
  try {
    const parsed = new URL(String(url || ''));
    return /(?:^|\.)baidu\.com$/i.test(parsed.hostname) && parsed.pathname === '/s';
  } catch { return true; }
}

export function normalizeBaiduVisibleResults(rows, { topK = MAX_NATURAL_RESULTS } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => text(row.url).startsWith('http'))
    .filter((row) => !isBaiduInternalSearch(row.url))
    .filter((row) => !excluded(row))
    .slice(0, Math.min(MAX_NATURAL_RESULTS, Math.max(1, Number(topK) || MAX_NATURAL_RESULTS)))
    .map((row) => ({
      title: text(row.title),
      url: text(row.url),
      snippet: text(row.snippet),
      kind: 'organic',
    }));
}

export async function readBaiduVisibleNaturalResults(tab, { query, topK = MAX_NATURAL_RESULTS } = {}) {
  if (!tab?.goto || !tab?.playwright?.evaluate) throw new Error('Chrome tab is required for visible Baidu search');
  const requestedTopK = Math.min(MAX_NATURAL_RESULTS, Math.max(1, Number(topK) || MAX_NATURAL_RESULTS));
  await tab.goto(`https://www.baidu.com/s?wd=${encodeURIComponent(String(query || ''))}&rn=${requestedTopK}`);
  const visibleRows = await tab.playwright.evaluate(() => {
    const isVisible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    return [...document.querySelectorAll('#content_left > div, #content_left > table')]
      .filter(isVisible)
      .map((node) => {
        const heading = node.querySelector('h3');
        const link = heading?.closest('a[href]') || heading?.querySelector('a[href]') || node.querySelector('a[href]');
        const labels = [...node.querySelectorAll('[class*="ad" i], [class*="news" i], [class*="label" i], span')]
          .map((item) => item.textContent || '')
          .filter((value) => /广告|推广|赞助|资讯|新闻|百家号/i.test(value))
          .slice(0, 4);
        return {
          title: heading?.textContent || link?.textContent || '',
          url: link?.href || '',
          snippet: node.textContent || '',
          labels,
        };
      })
      .filter((row) => row.title || row.url);
  });
  return normalizeBaiduVisibleResults(visibleRows, { topK: requestedTopK });
}

export function createChromeBaiduVisibleResultReader(tab) {
  return ({ query, topK }) => readBaiduVisibleNaturalResults(tab, { query, topK });
}
