import { htmlToText } from './core.mjs';

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function decode(value = '') { return String(value).replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'"); }

export function linksFromHtml(html = '', baseUrl = '') {
  const found = [];
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try { found.push({ url: new URL(decode(href), baseUrl).href, text: htmlToText(match[2]) }); } catch {}
  }
  return [...new Map(found.map((item) => [item.url, item])).values()];
}

export function parseHtmlDocument({ url = '', html = '' } = {}) {
  const title = clean(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? htmlToText(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)[1]) : '');
  const published = String(html).match(/(?:发布时间|发布于|日期)[：:\s]*((?:20)?\d{2}[年\-/]\d{1,2}[月\-/]\d{1,2}日?)/i)?.[1] || '';
  const images = [...String(html).matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].flatMap((match) => { try { return [new URL(decode(match[1]), url).href]; } catch { return []; } });
  return { title, plainText: htmlToText(html), links: linksFromHtml(html, url), images: [...new Set(images)], publishedText: published };
}

export function parseJsonDocument({ json, url = '' } = {}) {
  const value = typeof json === 'string' ? JSON.parse(json) : json;
  const plainText = JSON.stringify(value);
  const urls = [...plainText.matchAll(/https?:\\?\/\\?\/[^"\\\s]+/g)].map((match) => match[0].replace(/\\\//g, '/'));
  return { title: clean(value?.title || value?.name || ''), plainText, links: [...new Set(urls)].map((item) => ({ url: item, text: '' })), images: [], publishedText: clean(value?.published_at || value?.publishTime || '') };
}

export function parseContentDocument({ contentType = 'html', rawContent = '', url = '' } = {}) {
  if (/json/i.test(contentType)) return parseJsonDocument({ json: rawContent, url });
  if (/html|xml/i.test(contentType)) return parseHtmlDocument({ html: rawContent, url });
  return { title: '', plainText: String(rawContent), links: [], images: [], publishedText: '' };
}
