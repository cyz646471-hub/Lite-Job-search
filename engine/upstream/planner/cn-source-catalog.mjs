export const CN_INDEX_SOURCES = Object.freeze([
  { id: 'web', name: '搜索引擎', domains: [], querySuffix: '招聘 OR 校招 OR 实习 招聘官网', organizationType: '待确认' },
  { id: 'shixiseng', name: '实习僧', domains: ['shixiseng.com'], querySuffix: '实习 OR 校招', organizationType: '待确认' },
  { id: 'yingjiesheng', name: '应届生求职网', domains: ['yingjiesheng.com'], querySuffix: '校招 OR 实习', organizationType: '待确认' },
  { id: 'boss', name: 'BOSS直聘', domains: ['zhipin.com'], querySuffix: '校招 OR 实习', organizationType: '待确认' },
  { id: 'liepin', name: '猎聘', domains: ['liepin.com'], querySuffix: '社招 OR 社会招聘 OR 经验招聘', organizationType: '待确认' },
  { id: 'zhaopin', name: '智联招聘', domains: ['zhaopin.com'], querySuffix: '校园招聘 OR 实习', organizationType: '待确认' },
  { id: 'ncss', name: '国家大学生就业服务平台', domains: ['ncss.cn'], querySuffix: '职位 OR 实习 OR 招聘公告', organizationType: '待确认' },
  { id: 'iguopin', name: '国聘招聘平台', domains: ['iguopin.com'], querySuffix: '央企 OR 国企 校园招聘 OR 实习', organizationType: '国有企业' },
  { id: 'mohrss-public', name: '中国公共招聘网', domains: ['job.mohrss.gov.cn'], querySuffix: '中央企业 OR 事业单位 应届高校毕业生 OR 公开招聘', organizationType: '公共部门/国有企业' },
  { id: 'sasac', name: '国务院国资委招聘公告', domains: ['sasac.gov.cn'], querySuffix: '中央企业 校园招聘 OR 高校毕业生 OR 公开招聘', organizationType: '中央企业' },
  { id: 'public-institution', name: '事业单位公开招聘服务平台', domains: ['sydwgkzp.cn'], querySuffix: '事业单位 应届毕业生 OR 公开招聘', organizationType: '事业单位' },
  { id: 'jobonline', name: '就业在线', domains: ['jobonline.cn'], querySuffix: '国企 OR 事业单位 高校毕业生', organizationType: '待确认' },
  // These are deliberately discovery-only. A listing/update timestamp on an
  // aggregator is evidence of a lead, never proof that the employer opened a
  // recruitment project on that date.
  { id: 'gank-interview', name: 'Gank Interview', domains: ['gankinterview.com', 'gankinterview.cn'], querySuffix: '校招 OR 实习 OR 秋招 OR 春招', organizationType: '待确认', sourceType: 'aggregator' },
  { id: 'niuqizhipin', name: '牛企直聘', domains: ['niuqizp.com', 'niuqizhipin.com', 'niuqizhipin.cn'], querySuffix: '校招 OR 实习 OR 社招', organizationType: '待确认', sourceType: 'aggregator' },
]);

export function inferOrganizationType({ sourceId = '', title = '', snippet = '', company = '' } = {}) {
  const text = `${title} ${snippet} ${company}`;
  if (/(事业单位|研究院|研究所|直属单位|公共服务中心|高校|大学|学院|医院)/.test(text)) return '事业单位';
  if (/(中央企业|央企|国务院国资委|国家电网|中国石油|中国石化|中国移动|中国联通|中国电信|中国诚通)/.test(text)) return '中央企业';
  if (/(地方国企|市属国企|省属国企|国有企业|国企)/.test(text)) return '地方/其他国企';
  const source = CN_INDEX_SOURCES.find((item) => item.id === sourceId);
  return source?.organizationType || '待确认';
}

export function normalizeCnIndexSources(value) {
  const ids = new Set(CN_INDEX_SOURCES.map((item) => item.id));
  const requested = Array.isArray(value) ? value : String(value || '').split(',');
  const clean = requested.map((item) => String(item).trim().toLowerCase()).filter((item) => ids.has(item));
  return [...new Set(clean.length ? clean : CN_INDEX_SOURCES.map((item) => item.id))];
}

export function sourceForUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return CN_INDEX_SOURCES.find((source) => source.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) || CN_INDEX_SOURCES[0];
  } catch {
    return CN_INDEX_SOURCES[0];
  }
}

export function sourceClassification(sourceId = '') {
  const source = CN_INDEX_SOURCES.find((item) => item.id === sourceId);
  if (source?.sourceType === 'aggregator') return 'aggregator';
  if (['iguopin', 'mohrss-public', 'sasac', 'public-institution', 'jobonline', 'ncss'].includes(sourceId)) return 'government';
  return 'discovery_index';
}

export function buildCnIndexQueries(roles = [], { sources, cohort = '2027届' } = {}) {
  const selected = new Set(normalizeCnIndexSources(sources));
  const roleList = [...new Set((roles || []).map((role) => String(role).trim()).filter(Boolean))].slice(0, 18);
  const effectiveRoles = roleList.length ? roleList : ['软件开发', '技术', '产品'];
  const roleGroups = [];
  for (let index = 0; index < effectiveRoles.length; index += 6) roleGroups.push(effectiveRoles.slice(index, index + 6));
  const queries = [];
  const targetYear = Number(String(cohort).match(/20\d{2}/)?.[0]) || new Date().getUTCFullYear() + 1;
  const cohortQuery = `(${targetYear - 1}届 OR ${targetYear}届 OR 应届毕业生)`;
  for (const source of CN_INDEX_SOURCES) {
    if (!selected.has(source.id)) continue;
    for (const rolesInGroup of roleGroups) {
      const site = source.domains.length ? `site:${source.domains[0]}` : '';
      const roleQuery = `(${rolesInGroup.map((role) => `"${role}"`).join(' OR ')})`;
      queries.push({ source: source.id, sourceName: source.name, domains: source.domains, roles: rolesInGroup, query: [site, cohortQuery, roleQuery, source.querySuffix].filter(Boolean).join(' ') });
    }
  }
  return queries;
}
