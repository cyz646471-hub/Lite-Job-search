import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { runDiscoveryBatch } from '../application/run-discovery-batch.mjs';
import { loadRuntimeConfig } from '../runtime/config.mjs';
import { openSqliteMarketDiscoveryRepository } from '../storage/sqlite-job-repository.mjs';
import { parseTimeRange, runDiscoverCommand } from './discover.mjs';

function normalizeItem(item, defaults = {}) {
  return {
    id: item.id || null,
    market: item.market || defaults.market || 'CN',
    role: item.role || item.roleType || item.role_type,
    industry: Array.isArray(item.industry || item.industryTags || item.industry_tags)
      ? (item.industry || item.industryTags || item.industry_tags).join(',')
      : item.industry || item.industryTags || item.industry_tags || '',
    location: item.location || '',
    sinceDays: parseTimeRange(
      item.sinceDays
      || item.freshnessDays
      || item.timeRange
      || item.time_range
      || defaults.sinceDays,
      90,
    ),
    limit: item.limit || item.targetCount || item.target_count || defaults.limit || 20,
  };
}

export async function runDiscoverBatchCommand(options, {
  env = process.env,
  runSingle = runDiscoverCommand,
} = {}) {
  if (!options.input) throw new Error('discover-batch requires --input');
  const rawItems = JSON.parse(await readFile(options.input, 'utf8'));
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw new Error('discover-batch input must be a non-empty JSON array');
  }
  const items = rawItems.map((item) => normalizeItem(item, options));
  if (items.some((item) => !item.role)) throw new Error('every batch item requires role');
  const config = loadRuntimeConfig(env);
  const databaseFile = options.database
    || config.database.file
    || path.resolve('data', 'lite-job-search.sqlite');
  const repository = openSqliteMarketDiscoveryRepository({ file: databaseFile });
  repository.migrate();
  const batchId = options.batchId || `batch-${createHash('sha256')
    .update(JSON.stringify(items))
    .digest('hex')
    .slice(0, 16)}`;
  try {
    return await runDiscoveryBatch({
      batchId,
      items,
      retryFailed: options.retryFailed === true || options.retryFailed === 'true',
    }, {
      repository,
      runItem: (item) => runSingle({
        ...options,
        ...item,
        database: databaseFile,
      }, { env }),
    });
  } finally {
    repository.close();
  }
}
