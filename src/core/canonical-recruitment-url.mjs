const TRACKING_KEY = /^(?:utm_.+|rtm_.+|itm_.+|spm|from|source|src|ref|referrer|campaign|campaignid|tracking|trace|qd\d*)$/i;
const DIRECTORY_FILTER_KEY = /^(?:sort|order|asc|desc|department|location|city|keyword|keywords|search|filter|page|pageindex|pagenum|offset|limit)$/i;

function decodeHtmlSeparators(value) {
  return String(value || '')
    .replace(/&amp(?:%3B|;)/gi, '&')
    .replace(/%26amp%3B/gi, '&');
}

export function canonicalRecruitmentUrl(value, {
  directory = true,
} = {}) {
  try {
    const url = new URL(decodeHtmlSeparators(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443')
      || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_KEY.test(key) || (directory && DIRECTORY_FILTER_KEY.test(key))) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return '';
  }
}

export function recruitmentDirectoryKey(value) {
  return canonicalRecruitmentUrl(value, { directory: true });
}
