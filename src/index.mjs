export {
  MARKETS,
  createJobResult,
  normalizeMarket,
  selectBestEntryUrl,
} from './core/contracts.mjs';
export { canonicalCompany, normalizeText } from './core/normalize.mjs';
export { dedupeResults, stableJobKey } from './core/dedupe.mjs';

export {
  discoverCompanySites,
  queriesForCompany,
  scoreCandidate,
} from '../engine/upstream/planner/site-discovery.mjs';
export {
  boundedSurfaceDrill,
  classifySurfacePage,
} from '../engine/upstream/planner/cn-surface-drill.mjs';
export {
  createCnSearchProviderRouter,
  summarizeCnSearchConfiguration,
} from '../engine/upstream/planner/cn-search-providers.mjs';

