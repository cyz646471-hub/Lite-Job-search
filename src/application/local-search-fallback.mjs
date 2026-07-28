function uniqueByUrl(values = []) {
  const seen = new Set();
  return values.filter((item) => {
    const key = String(item?.url || item?.finalUrl || item?.requestedUrl || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function shouldEscalateLocalDiscovery({
  plan,
  discovery,
} = {}) {
  if (!plan || !discovery) return false;
  if (plan.confirmedPortalsOnly === true) return false;
  if (plan.searchFallbackAllowed !== true) return false;
  return (discovery.officialCandidates || []).length === 0;
}

export function mergeLocalAndSearchDiscovery(localDiscovery, searchDiscovery, {
  searchEngine = 'baidu',
} = {}) {
  const provider = String(searchEngine || 'baidu').trim().toLowerCase();
  return Object.freeze({
    ...localDiscovery,
    ...searchDiscovery,
    discoveryProvider: `local_then_chrome_${provider}_visible_search`,
    liveSearchExecuted: searchDiscovery?.liveSearchExecuted !== false,
    queries: Object.freeze([
      ...(localDiscovery?.queries || []),
      ...(searchDiscovery?.queries || []),
    ]),
    officialCandidates: Object.freeze(uniqueByUrl([
      ...(localDiscovery?.officialCandidates || []),
      ...(searchDiscovery?.officialCandidates || []),
    ])),
    platformCandidates: Object.freeze(uniqueByUrl([
      ...(localDiscovery?.platformCandidates || []),
      ...(searchDiscovery?.platformCandidates || []),
    ])),
    leads: Object.freeze(uniqueByUrl([
      ...(localDiscovery?.leads || []),
      ...(searchDiscovery?.leads || []),
    ])),
    rejected: Object.freeze(uniqueByUrl([
      ...(localDiscovery?.rejected || []),
      ...(searchDiscovery?.rejected || []),
    ])),
    observations: Object.freeze(uniqueByUrl([
      ...(localDiscovery?.observations || []),
      ...(searchDiscovery?.observations || []),
    ])),
    failures: Object.freeze([
      ...(localDiscovery?.failures || []),
      ...(searchDiscovery?.failures || []),
    ]),
    queryStatuses: Object.freeze([
      ...(localDiscovery?.queryStatuses || []),
      ...(searchDiscovery?.queryStatuses || []),
    ]),
    localDiscoveryStatus: localDiscovery?.status || null,
    localDiscoveryReasonCode: localDiscovery?.reasonCode || null,
  });
}
