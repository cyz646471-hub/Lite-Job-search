const RESULT_SELECTOR = [
  '#search .MjjYud',
  '#search .g',
  'main .g',
].join(', ');

export function isGoogleBlockedSnapshot({
  text = '',
  status = 200,
  url = '',
} = {}) {
  const combined = `${text} ${url}`;
  return [401, 403, 429].includes(Number(status))
    || /unusual traffic|automated queries|our systems have detected|detected unusual traffic|recaptcha|captcha|请验证您不是机器人|异常流量|访问受限/i
      .test(combined)
    || /(?:^|\.)google\.[^/]+\/sorry\//i.test(String(url || ''))
    || /consent\.google\./i.test(String(url || ''));
}

export async function readGoogleRows(page, limit = 10) {
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  return page.locator(RESULT_SELECTOR).evaluateAll((containers, maximum) => {
    const unwrapGoogleUrl = (value) => {
      try {
        const target = new URL(value);
        if (/(^|\.)google\./i.test(target.hostname) && target.pathname === '/url') {
          return target.searchParams.get('q') || target.searchParams.get('url') || value;
        }
        return value;
      } catch {
        return value;
      }
    };
    return containers.map((container) => {
      const heading = container.querySelector('h3');
      const anchor = heading?.closest('a[href]')
        || [...container.querySelectorAll('a[href]')].find((item) => item.querySelector('h3'));
      if (!anchor) return null;
      const href = unwrapGoogleUrl(anchor.href);
      let target;
      try {
        target = new URL(href);
      } catch {
        return null;
      }
      if (!['http:', 'https:'].includes(target.protocol)
        || /(^|\.)google\./i.test(target.hostname)) return null;
      const title = (heading?.innerText || heading?.textContent || '').trim();
      if (!title) return null;
      const text = (container.innerText || '').trim();
      const joined = `${title} ${text} ${String(container.className || '')}`.toLowerCase();
      return {
        title,
        href: target.href,
        snippet: text.slice(0, 1_200),
        kind: /广告|赞助|sponsored|advertisement|\bads?\b/.test(joined)
          ? 'advertisement'
          : /新闻|转载|news/.test(joined)
            ? 'news'
            : 'organic',
      };
    }).filter(Boolean).slice(0, maximum);
  }, boundedLimit);
}
