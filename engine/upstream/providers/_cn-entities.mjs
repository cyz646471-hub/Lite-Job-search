// Shared helpers for Chinese job-board providers.

const CN_TEXT_TRIM = /(?:[\u3000\s]+)|(?:&nbsp;)/g;

export function decodeHtml(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function stripTags(html = '') {
  return decodeHtml(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(CN_TEXT_TRIM, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse Chinese formatted dates like "2026\u5e7406\u5e723\u65e5" or ISO. */
export function parseCnDate(value) {
  if (!value) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  const cn = s.match(/(\d{4})[\u5e74\-\.\/](\d{1,2})[\u6708\-\.\/](\d{1,2})[\u65e5]/);
  if (cn) {
    const ts = Date.UTC(Number(cn[1]), Number(cn[2]) - 1, Number(cn[3]));
    return Number.isNaN(ts) ? undefined : ts;
  }
  const isoish = s.match(/(\d{4})[\-\.\/](\d{1,2})[\-\.\/](\d{1,2})/);
  if (isoish) {
    const ts = Date.UTC(Number(isoish[1]), Number(isoish[2]) - 1, Number(isoish[3]));
    return Number.isNaN(ts) ? undefined : ts;
  }
  const ts = Date.parse(s);
  return Number.isNaN(ts) ? undefined : ts;
}

/** Map raw BG / category / experience text to a normalized English jobType label. */
export function inferCnJobType(text) {
  const t = String(text || '');
  if (/(\u6821\u62db|\u5e94\u5c4a\u751f|\u6821\u5f55\u53d6|\u9ad8\u6821)/.test(t)) return 'new_grad_full_time';
  if (/(\u5b9e\u4e60|\u5b9e\u4e60\u751f|\u4ee3\u62db\u5b9e\u4e60|\u96f7\u5c39)/.test(t)) return 'internship';
  if (/(\u793e\u62db|\u793e\u4f1a\u62db\u8058)/.test(t)) return 'unspecified_full_time';
  return '';
}

/** Map Chinese experience phrases like "1\u5e743\u5e74" / "\u4e94\u5e74\u4ee5\u4e0a" to a year range. */
export function parseCnExperience(text) {
  const t = String(text || '');
  if (!t) return { minYears: null, maxYears: null, evidence: [] };
  const evidence = [];
  let minYears = null, maxYears = null;

  if (/\u5e94\u5c4a|\u6ca1\u6709\u5de5\u4f5c\u7ecf\u9a8c\u8981\u6c42|\u4e0d\u9650\u7ecf\u9a8c/i.test(t)) {
    evidence.push('campus-no-exp');
    return { minYears: 0, maxYears: 0, evidence };
  }
  const range = t.match(/(\d{1,2})\s*[\-\u2013\u2014~]\s*(\d{1,2})\s*\u5e74/);
  if (range) {
    minYears = Number(range[1]);
    maxYears = Number(range[2]);
    evidence.push(range[0]);
    return { minYears, maxYears, evidence };
  }
  const minOnly = t.match(/(\d{1,2})\s*\u5e74\u4ee5\u4e0a/);
  if (minOnly) {
    minYears = Number(minOnly[1]);
    evidence.push(minOnly[0]);
    return { minYears, maxYears: null, evidence };
  }
  const minBelow = t.match(/(?:\u4e0d\u8d85\u8fc7|\u4e0d\u591a\u4e8e|\u5c0f\u4e8e|\u4f4e\u4e8e)\s*(\d{1,2})\s*\u5e74/);
  if (minBelow) {
    maxYears = Number(minBelow[1]);
    evidence.push(minBelow[0]);
    return { minYears: null, maxYears, evidence };
  }
  const single = t.match(/(\d{1,2})\s*\u5e74[\u4ee5\u4e0a\u4ee5\u4e0b\u7ecf\u9a8c\u4ef7]/);
  if (single) {
    minYears = Number(single[1]);
    evidence.push(single[0]);
    return { minYears, maxYears: null, evidence };
  }
  return { minYears, maxYears, evidence };
}

/** Extract \u5c4f\u6b21 like 2026 from a title or description. */
export function parseCohortYear(text) {
  const t = String(text || '');
  const m = t.match(/(20\d{2})\s*\u5c4f/);
  return m ? Number(m[1]) : null;
}

/** Map Chinese education levels to a normalized token. */
export function parseCnEducation(text) {
  const t = String(text || '');
  if (/\u535a\u58eb/.test(t)) return 'phd';
  if (/\u7855\u58eb|\u7814\u7a76\u751f|\u4ee3\u62a4\u773c\u773c|\u300a\u62a4\u300b\s*\u300a\u7855\u300b/.test(t)) return 'master';
  if (/\u672c\u79d1/.test(t)) return 'bachelor';
  if (/\u5927\u4e13/.test(t)) return 'associate';
  if (/\u4e0d\u9650\u5b66\u5386/.test(t)) return 'any';
  return '';
}

export function pickPostId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.searchParams.get('post') || u.searchParams.get('postId') || u.searchParams.get('id') || u.pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    return '';
  }
}
