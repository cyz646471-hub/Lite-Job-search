// @ts-check
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const BASE = "https://www.gankinterview.cn";
const LIST_DEFAULT = `${BASE}/campus?tab=latest&size=50&sort=updated&order=desc&page=1`;

const decode = (v = "") => String(v)
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#x27;/g, "\x27").replace(/&quot;/g, "\"")
  .replace(/\s+/g, " ").trim();

const dateMs = (v = "") => { const m = String(v).match(/(20\d{2})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };

const DEFAULT_HEADERS = {
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "sec-ch-ua": "\"Chromium\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "upgrade-insecure-requests": "1",
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

let lastUserAgent = "";
function pickUserAgent() {
  let next = lastUserAgent;
  while (next === lastUserAgent) next = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  lastUserAgent = next;
  return next;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function stealthSleep(page, { totalPages } = {}) {
  const base = 1600 + Math.floor(Math.random() * 1400);
  const jitter = Math.random() * 600;
  let extra = 0;
  if (page && page % 4 === 0) extra = 2500 + Math.floor(Math.random() * 1800);
  if (totalPages && page === totalPages) extra = Math.max(extra, 900);
  await sleep(base + jitter + extra);
}

async function tryReadCookieFile(path) {
  if (!path) return "";
  try { await access(path, fsConstants.R_OK); } catch { return ""; }
  try { return (await readFile(path, "utf8")).trim(); } catch { return ""; }
}

export async function loadGankCookie({ env = process.env } = {}) {
  const inline = String(env.GANK_INTERVIEW_COOKIE || env.GANK_COOKIE || "").trim();
  if (inline) return inline;
  const file = String(env.GANK_COOKIE_FILE || "").trim();
  return tryReadCookieFile(file);
}

function buildHeaders({ cookie = "", referer = LIST_DEFAULT } = {}) {
  const headers = { ...DEFAULT_HEADERS, "user-agent": pickUserAgent(), referer };
  if (cookie) headers.cookie = cookie;
  return headers;
}

export function detectGankLogin(html = "") {
  const body = String(html || "");
  if (/(?:auth[\\\/]login)/i.test(body) && /登录后查看/.test(body)) return "anonymous";
  if (/(?:退出登录|logout|signout|我的投递)/i.test(body)) return "authenticated";
  return "unknown";
}

export function parseGankCampusHtml(html, { sourceUrl = LIST_DEFAULT } = {}) {
  const text = String(html || "");
  const items = [];
  const seen = new Set();
  const linkMatches = [...text.matchAll(/\\"href\\":\\"\/job\/[a-z0-9-]+\\"/gi)];
  for (const m of linkMatches) {
    const start = m.index ?? 0;
    const chunk = text.slice(Math.max(0, start - 2400), start + 200);
    const get = (pattern) => { const v = chunk.match(pattern); return v ? decode(v[1]) : ""; };
    const getUrl = (keys) => {
      const escaped = chunk.match(new RegExp(`\\\\\"(?:${keys})\\\\\":\\\\\"(https?:[^\"\\\\]+)\\\\\"`, "i"))?.[1] || "";
      return escaped.replace(/\\\\\//g, "/");
    };
    const company = get(/\\"companyName\\":\\"([^\\"]+)\\"/);
    const positions = get(/\\"positionName\\":\\"([^\\"]+)\\"/);
    const location = get(/\\"cityName\\":\\"([^\\"]+)\\"/);
    const recruitmentType = get(/\\"recruitmentType\\":\\"([^\\"]+)\\"/);
    const audience = get(/\\"audienceYear\\":\\"([^\\"]+)\\"/);
    const industry = get(/\\"industryName\\":\\"([^\\"]+)\\"/);
    const updated = get(/\\"updatedAt\\":\\"([^\\"]+)\\"/);
    const deadline = get(/\\"deadline\\":\\"([^\\"]+)\\"/);
    const announcementUrl = getUrl("announcementUrl|officialUrl|sourceUrl|jobsUrl");
    const applyUrl = getUrl("applyUrl|officialApplyUrl|deliveryUrl|applyUrlWeb");
    const slug = m[0].match(/\\"\/job\/([a-z0-9-]+)\\"/i)?.[1] || "";
    if (!company && !positions) continue;
    const key = `${company}|${positions}|${location}|${recruitmentType}|${audience}|${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const years = [...String(audience).matchAll(/20\d{2}/g)].map((mm) => Number(mm[0])).filter((n) => n >= 2020 && n <= 2100);
    const mixed = /(?:实习.*(?:秋招|春招|提前批|补录)|(?:秋招|春招|提前批|补录).*实习)/.test(recruitmentType);
    const id = createHash("sha1").update(key).digest("hex").slice(0, 20);
    const internalUrl = new URL(sourceUrl); internalUrl.searchParams.set("career_op_record", `gank-${id}`);
    items.push({
      campaignId: `gank-${id}`,
      recordType: "recruitment_campaign",
      company,
      title: positions || `${company}招聘`,
      batchName: recruitmentType,
      description: `${industry} ${positions} ${audience} ${deadline}`,
      location,
      cohortYear: years.length === 1 ? years[0] : null,
      graduationYears: years,
      roleCategories: positions.split(/[、,,,;;\/]/).map((x) => x.trim()).filter(Boolean).slice(0, 30),
      postedAt: dateMs(updated),
      updateTime: dateMs(updated),
      expiresAt: deadline === "招满为止" ? null : dateMs(deadline),
      deadlineType: deadline === "招满为止" ? "until_filled" : dateMs(deadline) ? "date" : "unknown",
      sourceUpdatedAt: updated || null,
      industry,
      slug,
      detailUrl: slug ? `${BASE}/job/${slug}` : null,
      officialPublishedAt: null,
      positionsIncomplete: /(?:…|\.\.\.)$/.test(positions),
      mixedRecruitmentType: mixed,
      announcementUrl: announcementUrl || null,
      applyUrl: applyUrl || null,
      announcementAccess: announcementUrl ? "public" : "login_required",
      applyAccess: applyUrl ? "public" : "login_required",
      url: internalUrl.href,
      indexUrl: sourceUrl,
      sourceUrl,
      source: "Gank Interview",
      sourceType: "aggregator",
      requiresOfficialVerification: true,
      needsOfficialLink: true,
      contentHash: createHash("sha256").update(chunk).digest("hex"),
    });
  }
  // The public list is sometimes rendered as an HTML table rather than serialized JSON.
  // Keep this fallback deliberately positional: Gank's campus table uses a stable column order.
  if (items.length === 0) {
    const rows = [...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1);
    for (const row of rows) {
      const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => decode(cell[1]));
      if (cells.length < 8) continue;
      const [company, industry, positions, location, recruitmentType, audience, updated, deadline] = cells;
      const rowLinks = [...row[1].matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => {
        try { return { url: new URL(match[1], sourceUrl).href, text: decode(match[2]) }; } catch { return { url: '', text: decode(match[2]) }; }
      });
      const allowedDirect = (link) => link?.url && !/gankinterview\.cn\/auth\/login/i.test(link.url);
      const announcementUrl = rowLinks.find((link) => allowedDirect(link) && /公告|详情/.test(link.text))?.url || '';
      const applyUrl = rowLinks.find((link) => allowedDirect(link) && /投递|申请/.test(link.text))?.url || '';
      const key = `${company}|${positions}|${location}|${recruitmentType}|${audience}`;
      if (!company || seen.has(key)) continue;
      seen.add(key);
      const years = [...String(audience).matchAll(/20\d{2}/g)].map((match) => Number(match[0]));
      const id = createHash("sha1").update(key).digest("hex").slice(0, 20);
      const internalUrl = new URL(sourceUrl); internalUrl.searchParams.set("career_op_record", `gank-${id}`);
      items.push({
        campaignId: `gank-${id}`, recordType: "recruitment_campaign", company,
        title: positions || `${company}招聘`, batchName: recruitmentType,
        description: `${industry} ${positions} ${audience} ${deadline}`, location,
        cohortYear: years.length === 1 ? years[0] : null, graduationYears: years,
        roleCategories: positions.split(/[、,，;；/]/).map((value) => value.trim()).filter(Boolean).slice(0, 30),
        postedAt: dateMs(updated), updateTime: dateMs(updated),
        expiresAt: deadline === "招满为止" ? null : dateMs(deadline),
        deadlineType: deadline === "招满为止" ? "until_filled" : dateMs(deadline) ? "date" : "unknown",
        sourceUpdatedAt: updated || null, industry, slug: "", detailUrl: null,
        officialPublishedAt: null, positionsIncomplete: /(?:…|\.\.\.)$/.test(positions),
        mixedRecruitmentType: /(?:实习.*(?:秋招|春招|提前批|补录)|(?:秋招|春招|提前批|补录).*实习)/.test(recruitmentType),
        announcementUrl: announcementUrl || null, applyUrl: applyUrl || null,
        announcementAccess: announcementUrl ? "public" : "login_required", applyAccess: applyUrl ? "public" : "login_required",
        url: internalUrl.href, indexUrl: sourceUrl, sourceUrl, source: "Gank Interview", sourceType: "aggregator",
        requiresOfficialVerification: true, needsOfficialLink: true,
        contentHash: createHash("sha256").update(row[1]).digest("hex"),
      });
    }
  }
  return items;
}

export function parseGankJobDetailHtml(html, { sourceUrl = "" } = {}) {
  const text = String(html || "");
  const apply = text.match(/\\"(?:applyUrl|officialApplyUrl|deliveryUrl|applyUrlWeb)\\":\\"(https?:[\\\/][\\\/][^\"\\]+)\\"/i)?.[1] || "";
  const announcement = text.match(/\\"(?:announcementUrl|officialUrl|sourceUrl|jobsUrl)\\":\\"(https?:[\\\/][\\\/][^\"\\]+)\\"/i)?.[1] || "";
  const title = text.match(/\\"(?:positionName|jobName|title)\\":\\"([^\"]+)\\"/)?.[1] || "";
  const description = text.match(/\\"(?:description|jobDescription|content)\\":\\"([\s\S]*?)\\"/)?.[1] || "";
  return {
    title: decode(title),
    description: decode(description).slice(0, 30000),
    applyUrl: apply,
    announcementUrl: announcement,
    detailUrl: sourceUrl,
    source: "Gank Interview",
    sourceType: "aggregator",
    applyAccess: apply ? "public" : "login_required",
    announcementAccess: announcement ? "public" : "login_required",
  };
}

async function fetchListPage({ url, ctx, cookie, maxRetries = 3 }) {
  let attempt = 0;
  let lastError = null;
  while (attempt < maxRetries) {
    attempt += 1;
    try {
      const html = await ctx.fetchText(url, { timeoutMs: 60000, headers: buildHeaders({ cookie, referer: url }) });
      return { html, status: "ok" };
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      await sleep(2000 * attempt);
    }
  }
  throw lastError || new Error(`gank: fetch failed for ${url}`);
}

async function fetchDetailPage({ url, ctx, cookie, maxRetries = 3 }) {
  let attempt = 0;
  let lastError = null;
  while (attempt < maxRetries) {
    attempt += 1;
    try {
      const html = await ctx.fetchText(url, { timeoutMs: 45000, headers: buildHeaders({ cookie, referer: `${BASE}/campus` }) });
      return { html, status: "ok" };
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      await sleep(1500 * attempt);
    }
  }
  return { html: "", status: "failed", error: lastError?.message || "fetch failed" };
}

export async function fetchGankFullList({ ctx, cookie = "", maxPages = 6, fetchDetails = true } = {}) {
  const all = [];
  const detailReports = [];
  let loginState = "unknown";
  let firstListHtml = "";
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? `${BASE}/campus` : `${BASE}/campus?tab=latest&size=50&sort=updated&order=desc&page=${page}`;
    const { html, status } = await fetchListPage({ url, ctx, cookie });
    if (page === 1) {
      firstListHtml = html;
      loginState = detectGankLogin(html);
    }
    if (status !== "ok") break;
    const records = parseGankCampusHtml(html, { sourceUrl: url });
    all.push(...records);
    if (records.length < 50) break;
    if (page < maxPages) await stealthSleep(page, { totalPages: maxPages });
  }
  if (fetchDetails && cookie && loginState === "authenticated") {
    for (const record of all) {
      if (!record.detailUrl) continue;
      const { html, status } = await fetchDetailPage({ url: record.detailUrl, ctx, cookie });
      if (status !== "ok") { detailReports.push({ campaignId: record.campaignId, status: "failed" }); continue; }
      const detail = parseGankJobDetailHtml(html, { sourceUrl: record.detailUrl });
      record.applyUrl = detail.applyUrl || null;
      record.announcementUrl = detail.announcementUrl || null;
      record.applyAccess = detail.applyUrl ? "public" : "login_required";
      record.announcementAccess = detail.announcementUrl ? "public" : "login_required";
      record.description = detail.description || record.description;
      detailReports.push({ campaignId: record.campaignId, status: "ok", applyUrl: detail.applyUrl });
      await stealthSleep(0);
    }
  }
  return { records: all, loginState, firstListLength: firstListHtml.length, detailReports };
}

export default {
  id: "gank-interview",
  detect: (e) => e?.provider === "gank-interview" ? { url: e.careers_url || LIST_DEFAULT } : null,
  async fetch(entry, ctx) {
    if (typeof ctx?.fetchText !== "function") throw new Error("gank-interview: HTTP context missing fetchText");
    const cookie = ctx?.gankCookie || entry?.cookie || "";
    const maxPages = Math.max(1, Math.min(10, Number(entry.max_pages) || 1));
    const fetchDetails = entry?.fetch_details !== false;
    const { records } = await fetchGankFullList({ ctx, cookie, maxPages, fetchDetails });
    return records;
  },
};
