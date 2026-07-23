import { searchCompany } from './search-company.mjs';

export async function searchBatch(companies = [], options = {}) {
  const concurrency = Math.max(1, Math.min(10, Number(options.concurrency) || 3));
  const results = new Array(companies.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < companies.length) {
      const index = cursor++;
      const entry = typeof companies[index] === 'string'
        ? { company: companies[index] }
        : companies[index];
      results[index] = await searchCompany({ ...options, ...entry });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, companies.length) }, worker));
  return results;
}

