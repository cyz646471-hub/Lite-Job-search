// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// \u5e94\u5c4a\u751f\u5c31\u4e1a\u7f51 provider \u2014 pulls the public city/keyword listing page and parses the
// inline job cards. The listing is server-rendered HTML with inline job
// entries, so no JavaScript runtime is needed.
//
// Provider entries:
//   portals.yml:
//     - name: \u5e94\u5c4a\u751f\u5c31\u4e1a\u7f51
//       provider: yingjiesheng
//       careers_url: https://www.yingjiesheng.com/job-1-0-0-0-0-1.html
//       keywords: ["\u79fb\u52a8\u5f00\u53d1", "iOS"]
//       max_pages: 8
//
// Zero-token, no browser needed. Verified 2026-07: GET returns an HTML
// page with anchor tags for each job card.

import { decodeHtml, stripTags, parseCnDate } from './_cn-entities.mjs';

const HOST = 'www.yingjiesheng.com';
const LIST_PATH = '/job-1-0-0-0-0-1.html';
const INTER_PAGE_DELAY_MS = 200;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_KEYWORDS = [''];

function buildUrl(keyword, page) {
  const q = new URLSearchParams({ p: String(page) });
  if (keyword) q.set('key', keyword);
  return `https://${HOST}${LIST_PATH}?${q}`;
}

/** Parse one page of the \u5e94\u5c4a\u751f\u5c31\u4e1a\u7f51 job-list HTML. */
export function parseYingjieshengHtml(html, { companyName = '\u5e94\u5c4a\u751f\u5c31\u4e1a\u7f51', sourceUrl = '' } = {}) {
  const jobs = [];
  if (typeof html !== 'string' || !html.trim()) return { jobs, total: 0 };

  // Common shape: <li class="job_item"> ... <a href="...">title</a> <span class="company">...</span> <span class="city">...</span> ... </li>
  const cardRegex = /<li[^>]*class=["'][^"']*job[^"']*item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  let count = 0;
  while ((m = cardRegex.exec(html)) !== null) {
    const block = m[1];
    const linkMatch = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!linkMatch) continue;
    const title = stripTags(linkMatch[2]);
    if (!title) continue;
    const href = linkMatch[1];
    const url = /^https?:/i.test(href) ? href : `https://${HOST}${href.startsWith('/') ? '' : '/'}${href}`;
    const company = stripTags((/class=["'][^"']*company[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(block) || [])[1] || '') || companyName;
    const city = stripTags((/class=["'][^"']*city[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block) || [])[1] || '');
    const dateMatch = /class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block);
    const batchMatch = /(20\d{2})\u5c4f/.exec(block);
    const jobTypeMatch = /(\u6821\u62db|\u5b9e\u4e60|\u793e\u62db)/.exec(block);
    const jobType = jobTypeMatch ? (jobTypeMatch[1] === '\u6821\u62db' ? 'new_grad_full_time' : jobTypeMatch[1] === '\u5b9e\u4e60' ? 'internship' : 'unspecified_full_time') : '';
    jobs.push({
      title,
      url,
      company,
      location: city || '',
      postedAt: parseCnDate(dateMatch?.[1] || ''),
      jobType,
      description: [
        batchMatch && `\u5c4a\u6b21: ${batchMatch[1]}\u5c4f`,
        jobType && `\u7c7b\u578b: ${jobTypeMatch?.[1] || ''}`,
      ].filter(Boolean).join('\n'),
    });
    count++;
  }

  const totalMatch = /\u5171\u8ba1?\s*(\d+)\s*\u4e2a\u62db\u8058/.exec(html);
  return { jobs, total: Number(totalMatch?.[1]) || count };
}

/** @type {Provider} */
export default {
  id: 'yingjiesheng',

  detect(entry) {
    const url = entry.careers_url;
    if (typeof url !== 'string') return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.hostname !== HOST) return null;
      return { url };
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    const keywords = Array.isArray(entry.keywords) && entry.keywords.length ? entry.keywords : DEFAULT_KEYWORDS;
    const maxPages = Math.min(Number(entry.max_pages) > 0 ? Number(entry.max_pages) : DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const companyName = entry.name || '\u5e94\u5c4a\u751f\u5c31\u4e1a\u7f51';
    const sleep = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const seen = new Map();
    let succeeded = false;

    for (const keyword of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        if (page > 1 || keywords.indexOf(keyword) > 0) await sleep(INTER_PAGE_DELAY_MS);
        const url = buildUrl(keyword, page);
        let html;
        try {
          html = await ctx.fetchText(url, { redirect: 'follow' });
          if (/id=["']renderData["'][\s\S]{0,500}aliyun_waf_aa/i.test(html)) {
            throw new Error('public page is blocked by Aliyun WAF');
          }
        } catch (err) {
          if (!succeeded) throw err;
          console.error(`  \u26a0 yingjiesheng: keyword "${keyword}" page ${page} failed (${err.message}) \u2014 keeping ${seen.size} jobs`);
          return [...seen.values()];
        }
        succeeded = true;
        const { jobs } = parseYingjieshengHtml(html, { companyName, sourceUrl: url });
        if (!jobs.length) break;
        for (const j of jobs) if (!seen.has(j.url)) seen.set(j.url, j);
      }
    }

    return [...seen.values()];
  },
};
