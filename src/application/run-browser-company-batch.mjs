import { createHash } from 'node:crypto';

import { runDiscoveryBatch } from './run-discovery-batch.mjs';

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
  retryFailed = false,
  runOptions = {},
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
    });
  });
  const companyResults = [];
  const discoveryRuns = [];

  const batch = await runDiscoveryBatch({
    batchId,
    items,
    retryFailed,
  }, {
    repository,
    now,
    runItem: async (company) => {
      const companyResult = await discoverCompany(company);
      companyResults.push(companyResult);
      if (companyResult?.status === 'BLOCKED') {
        return {
          status: 'BLOCKED',
          reason: companyResult.reasonCode || 'browser_search_blocked',
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
      return discoveryRun;
    },
  });

  return Object.freeze({
    ...batch,
    companyResults: Object.freeze(companyResults),
    discoveryRuns: Object.freeze(discoveryRuns),
  });
}
