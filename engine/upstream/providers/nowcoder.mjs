// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// NowCoder public job-board API. The old SSR parser remains exported for
// backwards-compatible fixtures, but live retrieval uses the structured
// /np-api/u/job/square-search endpoint used by the public jobs page.

import { stripTags, parseCnDate } from './_cn-entities.mjs';

const HOST = 'www.nowcoder.com';
const API_URL = `https://${HOST}/np-api/u/job/square-search`;
const PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_KEYWORDS = [''];
const DEFAULT_RECRUIT_TYPES = [1, 2, 3]; // campus, internship, experienced
const INTER_PAGE_DELAY_MS = 250;

function parseExt(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

function jobTypeFor(recruitType) {
  if (Number(recruitType) === 1) return 'new_grad_full_time';
  if (Number(recruitType) === 2) return 'internship';
  return 'unspecified_full_time';
}

function buildBody(keyword, page, recruitType) {
  return new URLSearchParams({
    careerJobId: '', jobCity: '', page: String(page), query: keyword,
    random: 'false', recommend: 'false', recruitType: String(recruitType),
    salaryType: '2', pageSize: String(PAGE_SIZE), requestFrom: '1',
    order: '0', pageSource: '5001',
  }).toString();
}

/** Parse one public NowCoder API response. */
export function parseNowcoderResponse(json, { companyName = '牛客网' } = {}) {
  const root = json?.data || json?.Data || {};
  const items = Array.isArray(root.datas) ? root.datas : [];
  const jobs = [];
  for (const wrapper of items) {
    const item = wrapper?.data || wrapper?.job || wrapper;
    const id = item?.id || item?.jobId;
    const title = stripTags(item?.jobName || item?.title || '');
    if (!id || !title) continue;
    const ext = parseExt(item.ext);
    const company = stripTags(
      item?.recommendInternCompany?.companyShortName
      || item?.recommendInternCompany?.companyName
      || item?.user?.identity?.[0]?.companyName
      || item?.companyName
      || companyName,
    );
    const cityList = Array.isArray(item.jobCityList) ? item.jobCityList : [];
    const location = cityList.length ? cityList.join('/') : stripTags(item.jobCity || item.jobAddress || '');
    const industry = (item?.recommendInternCompany?.industryTagNameList || []).join('、');
    const salary = item.salaryShow || (
      Number(item.salaryMin) > 0 && Number(item.salaryMax) < 9_999_999
        ? `${item.salaryMin}-${item.salaryMax}K${item.salaryMonth ? `·${item.salaryMonth}薪` : ''}`
        : ''
    );
    jobs.push({
      title,
      url: `https://${HOST}/jobs/detail/${id}`,
      company,
      location,
      postedAt: Number(item.createTime || item.deliverBegin || item.refreshTime) || undefined,
      expiresAt: Number(item.deliverEnd) || undefined,
      jobType: jobTypeFor(item.recruitType),
      description: [
        ext.infos || ext.description,
        ext.requirements,
        item.graduationYear && `届次: ${item.graduationYear}`,
        item.eduLevelName && `学历: ${item.eduLevelName}`,
        salary && `薪资: ${salary}`,
        industry && `行业: ${industry}`,
      ].filter(Boolean).join('\n'),
    });
  }
  return {
    jobs,
    total: Number(root.totalCount || root.count) || jobs.length,
    totalPages: Number(root.totalPage) || Math.ceil((Number(root.totalCount) || jobs.length) / PAGE_SIZE),
  };
}

/** Parse legacy SSR fixtures or a serialized API response. */
export function parseNowcoderPayload(value, options = {}) {
  if (typeof value !== 'string' || !value.trim()) return { jobs: [], total: 0 };
  try {
    const parsed = JSON.parse(value);
    return parseNowcoderResponse(parsed, options);
  } catch {}
  const match = value.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return { jobs: [], total: 0 };
  try {
    const state = JSON.parse(match[1]);
    const items = collectJobs(state);
    return parseNowcoderResponse({ data: { datas: items.map((data) => ({ data })) } }, options);
  } catch { return { jobs: [], total: 0 }; }
}

function collectJobs(node, depth = 0, out = []) {
  if (depth > 8 || node === null || typeof node !== 'object') return out;
  if ((node.id || node.jobId) && (node.jobName || node.title)) out.push(node);
  for (const value of Array.isArray(node) ? node : Object.values(node)) collectJobs(value, depth + 1, out);
  return out;
}

/** @type {Provider} */
export default {
  id: 'nowcoder',

  detect(entry) {
    const url = entry.careers_url;
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname === HOST ? { url } : null;
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    if (typeof ctx?.fetchJson !== 'function') throw new Error('nowcoder: HTTP context is missing fetchJson');
    const keywords = Array.isArray(entry.keywords) && entry.keywords.length ? entry.keywords : DEFAULT_KEYWORDS;
    const recruitTypes = Array.isArray(entry.recruit_types) && entry.recruit_types.length
      ? entry.recruit_types.map(Number).filter((value) => DEFAULT_RECRUIT_TYPES.includes(value))
      : DEFAULT_RECRUIT_TYPES;
    const maxPages = Math.min(
      Number(entry.max_pages) > 0 ? Number(entry.max_pages) : DEFAULT_MAX_PAGES,
      Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity,
    );
    const sleep = (ms) => typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
    const seen = new Map();
    let requestCount = 0;

    for (const recruitType of recruitTypes) {
      for (const keyword of keywords) {
        for (let page = 1; page <= maxPages; page++) {
          if (requestCount++) await sleep(INTER_PAGE_DELAY_MS);
          const json = await ctx.fetchJson(API_URL, {
            method: 'POST',
            body: buildBody(String(keyword || ''), page, recruitType),
            headers: {
              'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'x-requested-with': 'XMLHttpRequest',
              referer: `https://${HOST}/jobs/school/jobs`,
              accept: 'application/json',
            },
          });
          if (Number(json?.code) !== 0) throw new Error(`nowcoder: API error ${json?.code ?? 'unknown'} ${json?.msg || ''}`.trim());
          const parsed = parseNowcoderResponse(json, { companyName: entry.name || '牛客网' });
          for (const job of parsed.jobs) if (!seen.has(job.url)) seen.set(job.url, job);
          if (!parsed.jobs.length || page >= parsed.totalPages) break;
        }
      }
    }
    return [...seen.values()];
  },
};
