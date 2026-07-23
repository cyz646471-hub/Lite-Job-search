// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { pickOfficialRecruitmentLink } from '../planner/official-links.mjs';

const HOST = 'www.nowcoder.com';
const API_URL = `https://${HOST}/np-api/u/school-schedule/list-card`;
const PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10;
const DELAY_MS = 350;

export const SCHEDULE_TABS = Object.freeze([
  { id: 3, name: '24h更新', url: `https://${HOST}/jobs/school/schedule?tab=3`, minSinceDays: 1 },
  { id: 0, name: '热门推荐', url: `https://${HOST}/jobs/school/schedule?pageSource=schedule_tab`, minSinceDays: 7 },
  { id: 2, name: '即将截止', url: `https://${HOST}/jobs/school/schedule?tab=2`, minSinceDays: 7 },
]);

export function scheduleTabsForSinceDays(sinceDays = 30) {
  const days = Math.max(1, Number(sinceDays) || 30);
  return SCHEDULE_TABS.filter((tab) => days >= tab.minSinceDays);
}

function scheduleText(item) {
  const content = item?.cardSchoolScheduleInfo?.content?.data;
  return Array.isArray(content) ? content.map((part) => part?.text).filter(Boolean).join(' ') : '';
}

export function parseScheduleResponse(json, { tab = SCHEDULE_TABS[0] } = {}) {
  const root = json?.data || {};
  const campaigns = [];
  for (const item of Array.isArray(root.datas) ? root.datas : []) {
    if (!item?.name || !item?.companyId) continue;
    const indexUrl = `https://${HOST}/enterprise/${item.companyId}?channel=recruitmentSchedule&pageSource=5014`;
    const links = pickOfficialRecruitmentLink([
      item.customWangshenLink,
      item.adInfo?.rawUrl,
      item.adInfo?.specialWangshenLink,
      item.sourceInformation,
    ]);
    const primary = links.primary;
    const batchName = String(item.batchName || '').trim();
    const updateTime = Number(item.updateTime || item.wangshenUpdateTime) || undefined;
    campaigns.push({
      campaignId: `nowcoder-${item.companyId}-${item.batch || 'general'}`,
      recordType: 'recruitment_campaign',
      title: `${batchName || '校园招聘'}招聘项目`,
      company: String(item.name).trim(),
      location: Array.isArray(item.cityList) ? item.cityList.join('/') : '',
      jobType: /实习/.test(batchName) ? 'internship' : 'new_grad_full_time',
      postedAt: updateTime,
      updateTime,
      expiresAt: Number(item.wangshenEndDate || item.supplementEndDate) || undefined,
      campaignStartAt: Number(item.wangshenBeginDate || item.supplementBeginDate) || undefined,
      batchName,
      roleCategories: Array.isArray(item.careerNameList) ? item.careerNameList : [],
      industries: Array.isArray(item.industryList) ? item.industryList : [],
      scheduleStatus: scheduleText(item),
      officialUrl: primary?.url || '',
      officialChannel: primary?.channel || '',
      url: primary?.url || indexUrl,
      applyUrl: primary?.url || '',
      indexUrl,
      sourceUrl: tab.url,
      scheduleTab: tab.id,
      scheduleTabName: tab.name,
      source: 'NowCoder Schedule',
      sourceType: 'discovery_index',
      needsOfficialLink: !primary || primary.channel === 'official_candidate',
      description: [item.companyEvaluation, batchName, item.wangshenTime, scheduleText(item)].filter(Boolean).join('\n'),
      officialCandidates: links.candidates,
      contentHash: [updateTime, item.wangshenEndDate, primary?.url, batchName].join('|'),
    });
  }
  return {
    campaigns,
    total: Number(root.totalCount) || campaigns.length,
    totalPages: Number(root.totalPage) || 1,
    currentPage: Number(root.currentPage) || 1,
  };
}

function buildBody(page, tab, pageSize = PAGE_SIZE) {
  return new URLSearchParams({ query: '', propertyId: '', page: String(page), pageSize: String(pageSize), tab: String(tab) }).toString();
}

/** @type {Provider} */
export default {
  id: 'nowcoder-schedule',
  detect(entry) {
      return entry?.provider === 'nowcoder-schedule' ? { url: entry.careers_url || SCHEDULE_TABS[0].url } : null;
  },
  async fetch(entry, ctx) {
    if (typeof ctx?.fetchJson !== 'function') throw new Error('nowcoder-schedule: HTTP context is missing fetchJson');
    const maxPages = Math.max(1, Math.min(100, Number(entry.max_pages) || DEFAULT_MAX_PAGES, Number(ctx?.maxPages) || Infinity));
    const sinceDays = Math.max(1, Number(entry.since_days) || 30);
    const cutoff = Date.now() - sinceDays * 86_400_000;
    const sleep = (ms) => typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
    const seen = new Map();
    for (const tab of scheduleTabsForSinceDays(sinceDays)) {
      for (let page = 1; page <= maxPages; page++) {
        if (page > 1 || seen.size) await sleep(DELAY_MS);
        const json = await ctx.fetchJson(API_URL, {
          method: 'POST', body: buildBody(page, tab.id),
          headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest', accept: 'application/json',
            referer: tab.url,
          },
        });
        if (Number(json?.code) !== 0) throw new Error(`nowcoder-schedule: API error ${json?.code ?? 'unknown'} ${json?.msg || ''}`.trim());
        const parsed = parseScheduleResponse(json, { tab });
        // tab=3 is processed first, so a company/batch present in several lists is
        // retained as one campaign with the highest-frequency discovery evidence.
        for (const campaign of parsed.campaigns) if (!seen.has(campaign.campaignId)) seen.set(campaign.campaignId, campaign);
        if (!parsed.campaigns.length || page >= parsed.totalPages) break;
        const dated = parsed.campaigns.map((item) => Number(item.postedAt)).filter((value) => Number.isFinite(value) && value > 0);
        if (dated.length && dated.every((value) => value < cutoff)) break;
      }
    }
    return [...seen.values()];
  },
};
