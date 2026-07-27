function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedMarket(value) {
  return String(value || 'CN').trim().toUpperCase() === 'NA' ? 'NA' : 'CN';
}

function domainOnly(value) {
  const input = clean(value).toLowerCase();
  if (!input) return '';
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function buildCompanyQueryLadder({
  company,
  englishName = '',
  officialDomain = '',
  market = 'CN',
} = {}) {
  const name = clean(company);
  if (!name) throw new Error('company is required to build a query ladder');
  const domain = domainOnly(officialDomain);
  const queries = normalizedMarket(market) === 'NA'
    ? [
      `${clean(englishName) || name} careers`,
      `${clean(englishName) || name} jobs`,
      domain ? `site:${domain} careers` : '',
    ]
    : [
      `${name} 招聘官网`,
      `${name} 校园招聘`,
      `${name} 社会招聘`,
      domain ? `site:${domain} 招聘` : '',
    ];
  return Object.freeze([...new Set(queries.filter(Boolean))]);
}
