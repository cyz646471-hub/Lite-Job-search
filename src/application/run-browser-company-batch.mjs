import { createHash } from 'node:crypto';

import {
  createClosedCircuit,
  transitionCircuit,
} from './browser-search-circuit-breaker.mjs';
import { runDiscoveryBatch } from './run-discovery-batch.mjs';

export const BROWSER_QUEUE_TYPES = Object.freeze({
  LOCAL: 'LOCAL_OR_DIRECT_VERIFICATION',
  BAIDU: 'BAIDU_DISCOVERY_REQUIRED',
});

function companyItemId(company = {}) {
  if (company.id) return String(company.id);
  if (company.companyIdentityKey) return String(company.companyIdentityKey);
  const name = String(company.company || '').replace(/\s+/g, ' ').trim();
  const market = String(company.market || 'CN').toUpperCase();
  return `browser-company-${createHash('sha256')
    .update(`${market}|${name}`)
    .digest('hex')
    .slice(0, 24)}`;
}

export async function runBrowserCompanyBatch({
  batchId,
  companies = [],
  batchInputHash = null,
  retryFailed = false,
  maxCompaniesPerRun = 10,
  runOptions = {},
  provider = 'baidu',
} = {}, {
  repository,
  discoverCompany,
  ingestCompany,
  now = () => new Date().toISOString(),
} = {}) {
  if (!batchId || !Array.isArray(companies) || !companies.length) {
    throw new Error('batchId and at least one company are required');
  }
  if (!repository || typeof discoverCompany !== 'function' || typeof ingestCompany !== 'function') {
    throw new Error('repository, discoverCompany and ingestCompany are required');
  }
  const items = companies.map((company) => {
    const name = String(company?.company || '').replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('every browser batch item requires company');
    return Object.freeze({
      ...company,
      company: name,
      id: companyItemId({ ...company, company: name }),
      queueType: company.queueType === BROWSER_QUEUE_TYPES.LOCAL
        ? BROWSER_QUEUE_TYPES.LOCAL
        : BROWSER_QUEUE_TYPES.BAIDU,
    });
  });
  const companyResults = [];
  const discoveryRuns = [];
  let circuit = repository.getProviderCircuitState(provider)
    || createClosedCircuit(provider, now());
  const retryDeferred = circuit.state === 'CLOSED' && Boolean(circuit.lastHealthyAt);

  const batch = await runDiscoveryBatch({
    batchId,
    items,
    inputHash: batchInputHash,
    retryFailed,
    retryDeferred,
    pauseBeforeRun: false,
    pauseOnBlocked: false,
    maxItemsPerRun: maxCompaniesPerRun,
    stopOnResultStatuses: [],
  }, {
    repository,
    now,
    shouldStop: () => (
      typeof repository.isBatchStopRequested === 'function'
      && repository.isBatchStopRequested(batchId)
    ),
    shouldDeferItem: (company) => (
      company.queueType === BROWSER_QUEUE_TYPES.BAIDU && circuit.state !== 'CLOSED'
        ? {
            resultStatus: 'BLOCKED',
            retryClass: 'PROVIDER_BLOCKED',
            deferReason: 'SEARCH_ENGINE_OPEN',
            reason: `provider circuit is ${circuit.state}`,
          }
        : null
    ),
    runItem: async (company) => {
      const companyResult = await discoverCompany(company);
      companyResults.push(companyResult);
      if (companyResult?.status === 'BLOCKED') {
        if (company.queueType === BROWSER_QUEUE_TYPES.BAIDU) {
          circuit = transitionCircuit(circuit, {
            type: 'BLOCKED',
            reasonCode: companyResult.reasonCode || 'browser_search_blocked',
          }, now());
          repository.saveProviderCircuitState(circuit);
        }
        return {
          status: 'BLOCKED',
          reason: companyResult.reasonCode || 'browser_search_blocked',
          deferReason: /captcha/i.test(companyResult.reasonCode || '')
            ? 'CAPTCHA_REQUIRED'
            : 'SEARCH_ENGINE_OPEN',
        };
      }
      if (companyResult?.status === 'FAILED') {
        return {
          status: 'FAILED',
          reason: companyResult.reasonCode || 'browser_search_failed',
        };
      }
      const discoveryRun = await ingestCompany({
        companyResult,
        ...runOptions,
      });
      discoveryRuns.push(discoveryRun);
      if (discoveryRun?.status === 'BLOCKED') {
        return {
          ...discoveryRun,
          status: 'FAILED',
          reason: 'candidate_page_blocked',
        };
      }
      return discoveryRun;
    },
  });

  return Object.freeze({
    ...batch,
    providerCircuit: repository.getProviderCircuitState(provider) || circuit,
    companyResults: Object.freeze(companyResults),
    discoveryRuns: Object.freeze(discoveryRuns),
  });
}
