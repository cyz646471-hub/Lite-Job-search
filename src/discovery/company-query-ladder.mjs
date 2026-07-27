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

const GOOGLE_CN_EXCLUSIONS = Object.freeze([
  '-site:jobui.com',
  '-site:51job.com',
  '-site:zhaopin.com',
  '-site:liepin.com',
  '-site:zhipin.com',
  '-site:nowcoder.com',
]);

function queryStep(tier, purpose, text, keywords) {
  return Object.freeze({
    tier,
    purpose,
    text: clean(text),
    keywords: Object.freeze(keywords),
  });
}

export function buildCompanyQueryPlan({
  company,
  englishName = '',
  officialDomain = '',
  market = 'CN',
  searchEngine = 'baidu',
} = {}) {
  const name = clean(company);
  if (!name) throw new Error('company is required to build a query ladder');
  const domain = domainOnly(officialDomain);
  const engine = clean(searchEngine).toLowerCase() || 'baidu';
  if (normalizedMarket(market) === 'NA') {
    const english = clean(englishName) || name;
    return Object.freeze([
      queryStep(1, 'official_career_home', `${english} careers`, ['careers']),
      queryStep(2, 'official_job_list', `${english} jobs`, ['jobs']),
      ...(domain
        ? [queryStep(3, 'known_domain_recruitment', `site:${domain} careers`, ['site', 'careers'])]
        : []),
    ]);
  }
  if (engine === 'google') {
    const quotedName = `"${name.replaceAll('"', '')}"`;
    const exclusions = GOOGLE_CN_EXCLUSIONS.join(' ');
    return Object.freeze([
      queryStep(
        1,
        'official_career_home',
        `${quotedName} 招聘官网 ${exclusions}`,
        ['招聘官网'],
      ),
      queryStep(
        2,
        'campus_recruitment',
        `${quotedName} 校园招聘 官网 ${exclusions}`,
        ['校园招聘', '官网'],
      ),
      queryStep(
        2,
        'experienced_recruitment',
        `${quotedName} 社会招聘 职位 官网 ${exclusions}`,
        ['社会招聘', '职位', '官网'],
      ),
      queryStep(
        2,
        'internship_recruitment',
        `${quotedName} 实习 招聘 官网 ${exclusions}`,
        ['实习', '招聘', '官网'],
      ),
      ...(domain
        ? [queryStep(
          3,
          'known_domain_recruitment',
          `site:${domain} (招聘 OR 校园招聘 OR 社会招聘 OR 实习)`,
          ['site', '招聘', '校园招聘', '社会招聘', '实习'],
        )]
        : []),
    ]);
  }
  return Object.freeze([
    queryStep(1, 'official_career_home', `${name} 招聘官网`, ['招聘官网']),
    queryStep(2, 'campus_recruitment', `${name} 校园招聘`, ['校园招聘']),
    queryStep(2, 'experienced_recruitment', `${name} 社会招聘`, ['社会招聘']),
    ...(domain
      ? [queryStep(3, 'known_domain_recruitment', `site:${domain} 招聘`, ['site', '招聘'])]
      : []),
  ]);
}

export function buildCompanyQueryLadder(input = {}) {
  return Object.freeze(buildCompanyQueryPlan(input).map((step) => step.text));
}
