const RECRUITMENT_TYPE_MAP = Object.freeze({
  SOCIAL: 'experienced',
  GRADUATE: 'campus',
  INTERNSHIP: 'internship',
  SPECIAL_PROGRAM: 'special_program',
  experienced: 'experienced',
  campus: 'campus',
  internship: 'internship',
  special_program: 'special_program',
});

function canonicalHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeRecruitmentTypes(candidate = {}) {
  const values = [
    ...(candidate.recruitmentTypes || []),
    candidate.recruitmentType,
  ];
  return [...new Set(values.map((value) => (
    RECRUITMENT_TYPE_MAP[value] || RECRUITMENT_TYPE_MAP[clean(value).toUpperCase()]
  )).filter(Boolean))];
}

export function adaptBrowserCompanyResult(result = {}) {
  const company = clean(result.company);
  const query = clean(result.query || `${company} 招聘`);
  if (!company) throw new Error('browser company name is required');

  const items = (result.officialCandidates || []).map((candidate, index) => {
    const url = canonicalHttpUrl(candidate?.url);
    if (!url) throw new Error(`invalid browser candidate URL: ${candidate?.url || ''}`);
    return Object.freeze({
      company,
      aliases: Object.freeze([...(result.aliases || []).map(clean).filter(Boolean)]),
      chineseName: result.chineseName || null,
      englishName: result.englishName || null,
      countryRegion: result.countryRegion || '中国大陆',
      url,
      title: clean(candidate.title),
      rank: Number(candidate.rank) || index + 1,
      sourceType: 'browser_observation',
      sourceUrl: candidate.sourceUrl || url,
      confirmedOfficialDomain: clean(result.officialDomain).toLowerCase() || null,
      officialDomainSource: result.officialDomain ? 'registry' : null,
      verifiedTenant: false,
      recruitmentTypes: Object.freeze(normalizeRecruitmentTypes(candidate)),
      parentUrl: candidate.parentUrl || null,
      entryDepth: Number(candidate.depth ?? candidate.entryDepth) || 0,
      discoveryReason: candidate.discoveryReason || null,
      verifiedByBrowser: false,
    });
  });

  return Object.freeze({
    company,
    query,
    items: Object.freeze(items),
  });
}

export function createBrowserObservationFetcher(observations = []) {
  const byUrl = new Map();
  for (const rawPage of observations || []) {
    const requestedUrl = canonicalHttpUrl(rawPage?.requestedUrl);
    const finalUrl = canonicalHttpUrl(rawPage?.finalUrl || rawPage?.url);
    if (!requestedUrl && !finalUrl) continue;
    const page = Object.freeze({
      ...structuredClone(rawPage),
      requestedUrl: requestedUrl || finalUrl,
      finalUrl: finalUrl || requestedUrl,
      url: finalUrl || requestedUrl,
      links: Object.freeze([...(rawPage.links || []).map((link) => ({
        text: clean(link?.text),
        href: canonicalHttpUrl(link?.href),
      })).filter((link) => link.href)]),
    });
    if (requestedUrl) byUrl.set(requestedUrl, page);
    if (finalUrl) byUrl.set(finalUrl, page);
  }

  return async function fetchBrowserObservation(rawUrl) {
    const url = canonicalHttpUrl(rawUrl);
    if (!url) throw new Error(`invalid browser observation URL: ${rawUrl || ''}`);
    const page = byUrl.get(url);
    if (!page) throw new Error(`missing browser observation: ${url}`);
    return structuredClone(page);
  };
}
