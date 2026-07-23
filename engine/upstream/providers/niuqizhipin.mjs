// @ts-check
// Public campus schedule adapter. Each card remains a discovery lead until an
// official announcement or application endpoint is independently verified.
const BASE = 'https://campus.niuqizp.com';
const LIST = `${BASE}/scheduleintern-1/`;
const strip = (v = '') => String(v).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const absolute = (v = '') => new URL(v, BASE).href;
const date = (v = '') => { const m = String(v).match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };

export function parseNiuqizhipinSchedule(html, { sourceUrl = LIST } = {}) {
  return (html.match(/<article class="schedule-card">[\s\S]*?<\/article>/g) || []).map((card) => {
    const company = strip(card.match(/schedule-card-company[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1]);
    const title = strip(card.match(/schedule-card-title[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1]);
    const href = card.match(/schedule-card-title[\s\S]*?<a href="([^"]+)"/)?.[1] || card.match(/href="(\/job-[^"]+)"/)?.[1] || '';
    const summary = card.match(/href="(\/schedule-[^"]+)"/)?.[1] || '';
    const posted = card.match(/schedule-card-post-date[\s\S]*?(20\d{2}-\d{2}-\d{2})/)?.[1] || '';
    const dates = [...strip(card.match(/schedule-card-date"[\s\S]*?<\/span>/)?.[0]).matchAll(/20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}/g)].map((m) => date(m[0]));
    const location = strip(card.match(/schedule-card-location[\s\S]*?<\/svg>([\s\S]*?)<\/span>/)?.[1]);
    const tags = strip(card.match(/schedule-card-tags[^>]*>([\s\S]*?)<\/span>/)?.[1]);
    return { campaignId: `niuqizhipin-${href.replace(/\W/g, '')}`, recordType: 'recruitment_campaign', company, title: title || company, batchName: `${title} ${tags}`.trim(), description: strip(card), location, postedAt: date(posted), expiresAt: dates.at(-1) || null, campaignStartAt: dates[0] || date(posted), url: absolute(href || summary), indexUrl: absolute(summary || href), sourceUrl, source: '牛企直聘', sourceType: 'aggregator', needsOfficialLink: true, contentHash: `${company}|${title}|${posted}|${dates.join('|')}` };
  }).filter((x) => x.company && x.title);
}

export default { id: 'niuqizhipin', detect: (entry) => entry?.provider === 'niuqizhipin' ? { url: entry.careers_url || LIST } : null, async fetch(entry, ctx) { if (typeof ctx?.fetchText !== 'function') throw new Error('niuqizhipin: HTTP context missing fetchText'); return parseNiuqizhipinSchedule(await ctx.fetchText(entry.careers_url || LIST), { sourceUrl: entry.careers_url || LIST }); } };
