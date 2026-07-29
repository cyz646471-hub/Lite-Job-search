import { MONITOR_QUEUE_LANES } from '../domain/monitor-policy.mjs';

const DEFAULT_LANE_SHARES = Object.freeze({
  PORTAL_MONITOR: 0.7,
  PORTAL_RECOVERY: 0.1,
  MARKET_DISCOVERY: 0.1,
  REVIEW_FEEDBACK: 0.1,
});

function due(timestamp, now) {
  if (!timestamp) return true;
  const value = Date.parse(timestamp);
  return !Number.isFinite(value) || value <= Date.parse(now);
}

function activeOfficialPortal(portal) {
  return !portal.supersededByPortalId
    && ['OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL'].includes(portal.sourceTier);
}

function policyFor(targetType, targetId, policies) {
  return policies.find((policy) => (
    policy.enabled
    && policy.targetType === targetType
    && policy.targetId === targetId
  )) || null;
}

function priorityFor({ company, portal, endpoint, policy, reviewCount, actionCount }) {
  let priority = Number(policy?.priority) || 50;
  if (portal?.hiringAvailability === 'OPENINGS_FOUND') priority += 25;
  if (portal?.verificationStatus === 'VERIFIED') priority += 10;
  if (endpoint?.consecutiveFailures > 0) priority += Math.min(15, endpoint.consecutiveFailures * 3);
  if (reviewCount > 0) priority += Math.min(15, reviewCount * 5);
  if (actionCount > 0) priority += Math.min(15, actionCount * 3);
  if (company?.countryRegion && /china|中国/i.test(company.countryRegion)) priority += 5;
  return Math.max(0, Math.min(100, priority));
}

function boundedShares(input = {}) {
  const result = {};
  let total = 0;
  for (const lane of MONITOR_QUEUE_LANES) {
    const value = Math.max(0, Number(input[lane] ?? DEFAULT_LANE_SHARES[lane]) || 0);
    result[lane] = value;
    total += value;
  }
  if (total <= 0) return DEFAULT_LANE_SHARES;
  return Object.freeze(Object.fromEntries(
    Object.entries(result).map(([lane, value]) => [lane, value / total]),
  ));
}

function laneLimit(total, share, isLast, allocated) {
  if (isLast) return Math.max(0, total - allocated);
  return Math.max(0, Math.floor(total * share));
}

export function buildMonitoringNetworkPlan({
  companies = [],
  portals = [],
  sourceEndpoints = [],
  monitorPolicies = [],
  reviewTasks = [],
  userActions = [],
  jobs = [],
  providerCircuits = [],
  searchEngine = 'google',
  market = 'CN',
  targetCount = 300,
  laneShares = DEFAULT_LANE_SHARES,
  includeNotDue = false,
  now = new Date().toISOString(),
} = {}) {
  if (!Number.isFinite(Date.parse(now))) throw new Error('now must be an ISO timestamp');
  const selectedEngine = String(searchEngine || 'google').toLowerCase();
  if (!['baidu', 'google'].includes(selectedEngine)) {
    throw new Error('searchEngine must be baidu or google');
  }
  const selectedMarket = String(market || 'CN').toUpperCase();
  if (!['CN', 'NA', 'ALL'].includes(selectedMarket)) {
    throw new Error('market must be CN, NA or ALL');
  }
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const portalsByCompany = new Map();
  const endpointsByCompany = new Map();
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  for (const portal of portals.filter(activeOfficialPortal)) {
    if (!portalsByCompany.has(portal.companyId)) portalsByCompany.set(portal.companyId, []);
    portalsByCompany.get(portal.companyId).push(portal);
  }
  for (const endpoint of sourceEndpoints) {
    if (!endpointsByCompany.has(endpoint.companyId)) endpointsByCompany.set(endpoint.companyId, []);
    endpointsByCompany.get(endpoint.companyId).push(endpoint);
  }
  const reviewsByCompany = new Map();
  for (const task of reviewTasks.filter((item) => ['OPEN', 'IN_REVIEW'].includes(item.status))) {
    let companyId = null;
    if (task.targetType === 'COMPANY') companyId = task.targetId;
    if (task.targetType === 'CAREER_PORTAL') {
      companyId = portals.find((portal) => portal.id === task.targetId)?.companyId || null;
    }
    if (task.targetType === 'JOB_OPENING') {
      companyId = jobsById.get(task.targetId)?.companyId || null;
    }
    if (!companyId) continue;
    const values = reviewsByCompany.get(companyId) || [];
    values.push(task);
    reviewsByCompany.set(companyId, values);
  }
  const actionsByCompany = new Map();
  for (const action of userActions.filter((item) => item.triggersReverification)) {
    const companyId = jobsById.get(action.jobId)?.companyId || null;
    if (!companyId) continue;
    const values = actionsByCompany.get(companyId) || [];
    values.push(action);
    actionsByCompany.set(companyId, values);
  }

  const lanes = Object.fromEntries(MONITOR_QUEUE_LANES.map((lane) => [lane, []]));
  for (const company of companies.filter((item) => (
    selectedMarket === 'ALL' || item.market === selectedMarket
  ))) {
    const companyPortals = portalsByCompany.get(company.id) || [];
    const companyEndpoints = endpointsByCompany.get(company.id) || [];
    const reviews = reviewsByCompany.get(company.id) || [];
    const actions = actionsByCompany.get(company.id) || [];
    if (reviews.length || actions.length) {
      lanes.REVIEW_FEEDBACK.push({
        queueLane: 'REVIEW_FEEDBACK',
        companyId: company.id,
        company: company.canonicalName,
        reviewTaskIds: reviews.map((item) => item.id),
        userActionIds: actions.map((item) => item.id),
        priority: priorityFor({
          company,
          reviewCount: reviews.length,
          actionCount: actions.length,
        }),
        runnable: true,
        reason: actions.length ? 'user_reverification_feedback' : 'open_review_task',
      });
    }

    const endpointIds = new Set(companyEndpoints.map((endpoint) => endpoint.id));
    for (const endpoint of companyEndpoints) {
      const portal = companyPortals.find((item) => item.id === endpoint.careerPortalId) || null;
      const policy = policyFor('SOURCE_ENDPOINT', endpoint.id, monitorPolicies);
      const lane = policy?.queueLane
        || (
          endpoint.state === 'ACTIVE' && portal?.verificationStatus === 'VERIFIED'
            ? 'PORTAL_MONITOR'
            : 'PORTAL_RECOVERY'
        );
      if (!['PORTAL_MONITOR', 'PORTAL_RECOVERY'].includes(lane)) continue;
      const nextDueAt = endpoint.nextCheckAt || policy?.nextDueAt;
      if (!includeNotDue && !due(nextDueAt, now)) continue;
      lanes[lane].push({
        queueLane: lane,
        companyId: company.id,
        company: company.canonicalName,
        careerPortalId: portal?.id || endpoint.careerPortalId,
        sourceEndpointId: endpoint.id,
        url: endpoint.canonicalUrl,
        transport: endpoint.transport,
        adapterType: endpoint.adapterType,
        priority: priorityFor({
          company,
          portal,
          endpoint,
          policy,
          reviewCount: reviews.length,
          actionCount: actions.length,
        }),
        browserAllowed: policy?.browserAllowed === true,
        searchAllowed: false,
        nextDueAt: nextDueAt || null,
        runnable: true,
        reason: lane === 'PORTAL_MONITOR'
          ? 'verified_endpoint_due'
          : 'known_endpoint_recovery_due',
      });
    }

    const hasRunnableEndpoint = companyEndpoints.some((endpoint) => (
      endpointIds.has(endpoint.id) && ['ACTIVE', 'BLOCKED'].includes(endpoint.state)
    ));
    const hasVerifiedPortal = companyPortals.some((portal) => (
      portal.verificationStatus === 'VERIFIED'
    ));
    if (!hasRunnableEndpoint && !hasVerifiedPortal) {
      const policy = policyFor('COMPANY', company.id, monitorPolicies);
      const circuit = providerCircuits.find((item) => item.provider === selectedEngine);
      const circuitBlocked = ['OPEN', 'HALF_OPEN'].includes(circuit?.state);
      lanes.MARKET_DISCOVERY.push({
        queueLane: 'MARKET_DISCOVERY',
        companyId: company.id,
        company: company.canonicalName,
        officialDomains: company.officialDomains || [],
        priority: priorityFor({
          company,
          policy,
          reviewCount: reviews.length,
          actionCount: actions.length,
        }),
        browserAllowed: policy?.browserAllowed !== false,
        searchAllowed: true,
        searchEngine: selectedEngine,
        runnable: !circuitBlocked,
        deferReason: circuitBlocked ? `PROVIDER_CIRCUIT_${circuit.state}` : null,
        reason: 'official_recruitment_entry_missing',
      });
    }
  }

  for (const lane of MONITOR_QUEUE_LANES) {
    lanes[lane].sort((left, right) => (
      right.priority - left.priority
      || String(left.nextDueAt || '').localeCompare(String(right.nextDueAt || ''))
      || left.company.localeCompare(right.company, 'zh-CN')
    ));
  }

  const boundedTarget = Math.max(1, Math.trunc(Number(targetCount) || 300));
  const shares = boundedShares(laneShares);
  const selected = {};
  let allocated = 0;
  MONITOR_QUEUE_LANES.forEach((lane, index) => {
    const limit = laneLimit(
      boundedTarget,
      shares[lane],
      index === MONITOR_QUEUE_LANES.length - 1,
      allocated,
    );
    selected[lane] = Object.freeze(lanes[lane].slice(0, limit));
    allocated += selected[lane].length;
  });
  if (allocated < boundedTarget) {
    const alreadySelected = new Set(Object.values(selected).flat().map((item) => (
      `${item.queueLane}|${item.companyId}|${item.sourceEndpointId || item.reason}`
    )));
    const overflow = MONITOR_QUEUE_LANES.flatMap((lane) => lanes[lane])
      .filter((item) => !alreadySelected.has(
        `${item.queueLane}|${item.companyId}|${item.sourceEndpointId || item.reason}`,
      ))
      .sort((left, right) => right.priority - left.priority)
      .slice(0, boundedTarget - allocated);
    for (const item of overflow) {
      selected[item.queueLane] = Object.freeze([...selected[item.queueLane], item]);
    }
  }

  const allSelected = MONITOR_QUEUE_LANES.flatMap((lane) => selected[lane]);
  return Object.freeze({
    mode: 'MONITORING_NETWORK',
    generatedAt: now,
    market: selectedMarket,
    searchEngine: selectedEngine,
    targetCount: boundedTarget,
    laneShares: shares,
    totals: Object.freeze(Object.fromEntries(
      MONITOR_QUEUE_LANES.map((lane) => [lane, lanes[lane].length]),
    )),
    selectedCounts: Object.freeze(Object.fromEntries(
      MONITOR_QUEUE_LANES.map((lane) => [lane, selected[lane].length]),
    )),
    runnableCount: allSelected.filter((item) => item.runnable).length,
    deferredCount: allSelected.filter((item) => !item.runnable).length,
    queues: Object.freeze(selected),
  });
}
