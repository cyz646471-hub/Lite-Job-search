const RESULT_SELECTOR = [
  '#content_left .c-container',
  '#content_left [class*="result"]',
  'main article',
].join(', ');

export function isBaiduBlockedSnapshot({
  text = '',
  status = 200,
  url = '',
} = {}) {
  return [401, 403, 429].includes(Number(status))
    || /安全验证|验证码|访问过于频繁|请完成.{0,8}验证|captcha|access denied|enable javascript/i
      .test(`${text} ${url}`);
}

export async function readBaiduRows(page, limit = 10) {
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  return page.locator(RESULT_SELECTOR).evaluateAll((containers, maximum) => (
    containers.map((container) => {
      const anchor = [...container.querySelectorAll('a[href]')].find((item) => {
        const title = (item.innerText || item.textContent || '').trim();
        try {
          const target = new URL(item.href);
          return title && ['http:', 'https:'].includes(target.protocol);
        } catch {
          return false;
        }
      });
      if (!anchor) return null;
      const title = (anchor.innerText || anchor.textContent || '').trim();
      const text = (container.innerText || '').trim();
      const joined = `${title} ${text} ${String(container.className || '')}`.toLowerCase();
      return {
        title,
        href: anchor.href,
        snippet: text.slice(0, 1_200),
        kind: /广告|推广|sponsored|advertisement|(?:^|\s)ec-/.test(joined)
          ? 'advertisement'
          : /新闻|转载|news/.test(joined)
            ? 'news'
            : 'organic',
      };
    }).filter(Boolean).slice(0, maximum)
  ), boundedLimit);
}
