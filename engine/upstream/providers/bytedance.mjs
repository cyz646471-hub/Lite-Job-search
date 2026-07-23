// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ByteDance public campus-careers API. The endpoint requires the same CSRF
// token in a header and cookie; both values are obtained from the public token
// endpoint without authentication.

const HOST = 'jobs.bytedance.com';
const BASE = `https://${HOST}`;
const CSRF_URL = `${BASE}/api/v1/csrf/token`;
const SEARCH_URL = `${BASE}/api/v1/search/job/posts`;
const PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 3;
const INTER_PAGE_DELAY_MS = 250;

function typeFor(item) {
  const value = `${item?.recruit_type?.name || ''} ${item?.recruit_type?.en_name || ''}`;
  if (/实习|intern/i.test(value)) return 'internship';
  if (/校招|campus|graduate/i.test(value)) return 'new_grad_full_time';
  return 'unspecified_full_time';
}

/** Parse one ByteDance public search response. */
export function parseByteDanceResponse(json, { companyName = '字节跳动' } = {}) {
  const data = json?.data || {};
  const items = Array.isArray(data.job_post_list) ? data.job_post_list : [];
  const jobs = [];
  for (const item of items) {
    const id = item?.id;
    const title = String(item?.title || '').trim();
    if (!id || !title) continue;
    const cities = Array.isArray(item.city_list) ? item.city_list.map((city) => city?.name).filter(Boolean) : [];
    const location = cities.join('/') || item?.city_info?.name || '';
    const category = item?.job_category?.name || '';
    const subject = item?.job_subject?.name?.zh_cn || item?.job_subject?.name?.i18n || '';
    jobs.push({
      title,
      url: `${BASE}/campus/position/${id}/detail`,
      company: companyName,
      location,
      postedAt: Number(item.publish_time) || undefined,
      expiresAt: Number(item?.job_post_info?.expiry_time) || undefined,
      jobType: typeFor(item),
      description: [
        item.description,
        item.requirement && `任职要求:\n${item.requirement}`,
        category && `职位类别: ${category}`,
        subject && `招聘项目: ${subject}`,
        item.code && `职位 ID: ${item.code}`,
      ].filter(Boolean).join('\n'),
    });
  }
  return {
    jobs,
    total: Number(data.count || data.total_count || data.total) || jobs.length,
    hasMore: Boolean(data.has_more) || items.length >= PAGE_SIZE,
  };
}

function searchPayload(keyword, page, portalType) {
  return {
    keyword,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    job_category_id_list: [], tag_id_list: [], location_code_list: [],
    subject_id_list: [], recruitment_id_list: [], portal_type: portalType,
    job_function_id_list: [], storefront_id_list: [], portal_entrance: 1,
  };
}

/** @type {Provider} */
export default {
  id: 'bytedance',

  detect(entry) {
    const url = entry.careers_url;
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname === HOST ? { url } : null;
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    if (typeof ctx?.fetchJson !== 'function') throw new Error('bytedance: HTTP context is missing fetchJson');
    const tokenPayload = await ctx.fetchJson(CSRF_URL, {
      method: 'POST', body: JSON.stringify({ portal_entrance: 1 }),
      headers: { 'content-type': 'application/json', referer: `${BASE}/campus/position`, 'portal-channel': 'campus', 'portal-platform': 'pc' },
    });
    const token = tokenPayload?.data?.token;
    if (!token) throw new Error('bytedance: CSRF token endpoint returned no token');
    const keywords = Array.isArray(entry.keywords) && entry.keywords.length ? entry.keywords : [''];
    const portalType = Number(entry.portal_type) || 3;
    const maxPages = Math.min(
      Number(entry.max_pages) > 0 ? Number(entry.max_pages) : DEFAULT_MAX_PAGES,
      Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity,
    );
    const sleep = (ms) => typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
    const seen = new Map();
    let requestCount = 0;
    for (const keyword of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        if (requestCount++) await sleep(INTER_PAGE_DELAY_MS);
        const payload = searchPayload(String(keyword || ''), page, portalType);
        const json = await ctx.fetchJson(SEARCH_URL, {
          method: 'POST', body: JSON.stringify(payload),
          headers: {
            'content-type': 'application/json', accept: 'application/json',
            origin: BASE, referer: `${BASE}/campus/position`,
            'portal-channel': 'campus', 'portal-platform': 'pc', 'website-path': 'campus',
            'x-csrf-token': token,
            cookie: `channel=campus; platform=pc; atsx-csrf-token=${encodeURIComponent(token)}`,
          },
        });
        if (Number(json?.code) !== 0) throw new Error(`bytedance: API error ${json?.code ?? 'unknown'} ${json?.message || ''}`.trim());
        const parsed = parseByteDanceResponse(json, { companyName: entry.name || '字节跳动' });
        for (const job of parsed.jobs) if (!seen.has(job.url)) seen.set(job.url, job);
        if (!parsed.jobs.length || !parsed.hasMore) break;
      }
    }
    return [...seen.values()];
  },
};
