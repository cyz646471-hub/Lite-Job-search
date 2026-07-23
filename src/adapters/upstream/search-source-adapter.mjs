export function createSearchSourceAdapter({
  router,
} = {}) {
  if (!router || typeof router.search !== 'function') {
    throw new Error('SearchRouter is required');
  }
  return Object.freeze({
    async search(query, intent) {
      return router.search({
        query: query.text,
        market: intent.market,
        topK: query.topK,
        freshnessDays: intent.freshnessDays,
        cacheKey: `market-discovery|${intent.market}|${query.text}`,
      });
    },
  });
}
