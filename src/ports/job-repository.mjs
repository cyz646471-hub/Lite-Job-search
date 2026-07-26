const REQUIRED_METHODS = Object.freeze([
  'migrate',
  'withTransaction',
  'beginRun',
  'completeRun',
  'upsertCompany',
  'upsertCareerPortal',
  'replaceVerificationEvidence',
  'upsertRecruitmentEvent',
  'upsertJobOpening',
  'upsertPlatformJobOpening',
  'persistCompanySnapshot',
  'appendDiscoveryLog',
  'listCompanies',
  'listCareerPortals',
  'listRecruitmentEvents',
  'listJobOpenings',
  'listDiscoveryLogs',
  'deferBatchItem',
  'getProviderCircuitState',
  'saveProviderCircuitState',
  'close',
]);

export function assertMarketDiscoveryRepository(repository) {
  for (const method of REQUIRED_METHODS) {
    if (typeof repository?.[method] !== 'function') {
      throw new Error(`repository.${method} is required`);
    }
  }
  return repository;
}

export { REQUIRED_METHODS as MARKET_DISCOVERY_REPOSITORY_METHODS };
