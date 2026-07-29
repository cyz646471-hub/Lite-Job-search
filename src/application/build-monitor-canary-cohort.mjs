const HOT_INDUSTRY = /AI|人工智能|互联网|软件|科技|芯片|半导体|3C|消费电子|金融/i;
const KNOWN_ADAPTER = /MOKA|BEISEN|ZHIYE|ITALENT|FEISHU|HOTJOB|MOSEEKER|SELF_HOSTED/i;

function isChinaCompany(company) {
  const region = String(company.countryRegion || '');
  if (/north america|united states|canada|usa|美国|加拿大/i.test(region)) return false;
  return company.market === 'CN' && (
    /china|中国|大陆|港澳台|cn/i.test(region)
    || /[\u3400-\u9fff]/u.test(
      `${company.chineseName || ''}${company.canonicalName || ''}${(company.aliases || []).join('')}`,
    )
    || (company.officialDomains || []).some((domain) => /\.cn$/i.test(domain))
  );
}

function scoreCandidate({ company, portal, endpoint, policy, jobCount }) {
  let score = 0;
  const reasons = [];
  if (portal.verificationStatus === 'VERIFIED') {
    score += 40;
    reasons.push('verified_portal');
  }
  if (portal.hiringAvailability === 'OPENINGS_FOUND') {
    score += 25;
    reasons.push('openings_found');
  }
  if (KNOWN_ADAPTER.test(`${endpoint.adapterType || ''} ${endpoint.metadata?.adapterType || ''}`)) {
    score += 15;
    reasons.push('known_adapter');
  }
  if (HOT_INDUSTRY.test((company.industryTags || []).join(' '))) {
    score += 10;
    reasons.push('hot_industry');
  }
  if (jobCount > 0) {
    score += Math.min(10, jobCount);
    reasons.push('job_history');
  }
  if ((policy?.studentInterestCount || 0) > 0) {
    score += 10;
    reasons.push('student_interest');
  }
  if ((policy?.historicalApplicationScore || 0) > 0) {
    score += 10;
    reasons.push('application_history');
  }
  return { score, reasons };
}

export function buildMonitorCanaryCohort({
  companies = [],
  portals = [],
  sourceEndpoints = [],
  monitorPolicies = [],
  jobs = [],
  targetCount = 250,
} = {}) {
  const companyById = new Map(companies.map((item) => [item.id, item]));
  const portalById = new Map(portals.map((item) => [item.id, item]));
  const policyByTarget = new Map(monitorPolicies.map((item) => [item.targetId, item]));
  const jobsByCompany = new Map();
  for (const job of jobs) {
    jobsByCompany.set(job.companyId, (jobsByCompany.get(job.companyId) || 0) + 1);
  }
  const candidates = [];
  for (const endpoint of sourceEndpoints) {
    const company = companyById.get(endpoint.companyId);
    const portal = portalById.get(endpoint.careerPortalId);
    if (!company || !isChinaCompany(company) || !portal
      || portal.verificationStatus !== 'VERIFIED'
      || endpoint.state === 'RETIRED') {
      continue;
    }
    const ranked = scoreCandidate({
      company,
      portal,
      endpoint,
      policy: policyByTarget.get(endpoint.id),
      jobCount: jobsByCompany.get(company.id) || 0,
    });
    candidates.push({
      companyId: company.id,
      company: company.canonicalName,
      sourceEndpointId: endpoint.id,
      careerPortalId: portal.id,
      url: endpoint.canonicalUrl,
      adapterType: endpoint.adapterType,
      priorityScore: ranked.score,
      priorityReasons: ranked.reasons,
    });
  }
  candidates.sort((left, right) => (
    right.priorityScore - left.priorityScore
    || left.company.localeCompare(right.company, 'zh-CN')
    || left.url.localeCompare(right.url)
  ));
  const byCompany = new Map();
  for (const candidate of candidates) {
    if (!byCompany.has(candidate.companyId)) byCompany.set(candidate.companyId, candidate);
  }
  const boundedTarget = Math.max(200, Math.min(300, Math.trunc(Number(targetCount) || 250)));
  const selected = [...byCompany.values()].slice(0, boundedTarget);
  return Object.freeze({
    targetCount: boundedTarget,
    eligibleCompanyCount: byCompany.size,
    selectedCount: selected.length,
    shortage: Math.max(0, boundedTarget - selected.length),
    companies: Object.freeze(selected),
  });
}
