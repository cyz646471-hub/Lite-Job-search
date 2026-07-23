import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

import { DailyBudget } from '../runtime/budget.mjs';
import { FileSearchCache } from '../runtime/cache.mjs';
import { loadRuntimeConfig } from '../runtime/config.mjs';
import { createSearchProviders, orderedProviders } from '../search/providers.mjs';
import { SearchRouter } from '../search/router.mjs';
import { searchBatch } from '../pipeline/search-batch.mjs';
import { searchCompany } from '../pipeline/search-company.mjs';
import { verifyCandidates } from '../pipeline/verify-candidates.mjs';
import { buildDoctorReport, probeMarketDiscoveryDatabase } from './doctor.mjs';
import { runDiscoverCommand } from './discover.mjs';
import { readRecords, writeRecords } from './io.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function implicitOrder(config, providers, market) {
  const explicit = orderedProviders(config, providers);
  if (explicit.length) return explicit;
  const preferred = String(market || 'NA').toUpperCase() === 'CN'
    ? ['baidu', 'tavily', 'brave']
    : ['tavily', 'brave'];
  return preferred.map((name) => providers[name]).filter((provider) => provider?.configured);
}

async function runtime(options, market = 'NA') {
  const manualEntries = options.manual ? await readRecords(options.manual) : [];
  const config = loadRuntimeConfig(process.env);
  const providers = createSearchProviders(process.env, { manualEntries });
  const order = manualEntries.length ? [providers.manual] : implicitOrder(config, providers, market);
  const cacheFile = process.env.LITE_JOB_SEARCH_CACHE_FILE || path.join(
    process.env.LITE_JOB_SEARCH_CACHE_DIR || path.join(root, 'cache'),
    'search-cache.json',
  );
  const cache = new FileSearchCache({ file: cacheFile });
  const budget = new DailyBudget({ limit: config.search.dailyQueryBudget });
  const router = new SearchRouter(order, {
    cache,
    budget,
    cacheTtlMs: config.search.cacheTtlDays * 86_400_000,
  });
  return { config, providers, order, router };
}

async function defaultFetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SEARCH_TIMEOUT_MS) || 15_000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Lite-Job-Search/0.1 (+public recruitment verification)' },
    });
    return {
      status: response.status,
      finalUrl: response.url,
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  return {
    usage: [
      'lite-job-search doctor --json',
      'lite-job-search search --market CN|NA --company NAME [--manual candidates.json] --json',
      'lite-job-search batch --input companies.json|csv [--manual candidates.json] --json',
      'lite-job-search verify --input candidates.json [--fixture-pages pages.json] --json',
      'lite-job-search export --input results.json --output results.csv --format csv --json',
      'lite-job-search discover --market CN|NA --role ROLE [--industry TAGS] [--since-days 90] [--limit 20] --json',
    ],
  };
}

export async function main(argv = process.argv.slice(2)) {
  loadDotenv({ path: path.join(root, '.env.local'), quiet: true });
  const options = parseArgs(argv);
  if (options.command === 'help' || options.help) return print(help());

  if (options.command === 'doctor') {
    const state = await runtime(options, options.market);
    const databaseFile = state.config.database.file
      || path.join(root, 'data', 'lite-job-search.sqlite');
    return print(buildDoctorReport({
      config: state.config,
      providers: state.providers,
      providerOrder: state.order,
      databaseReady: probeMarketDiscoveryDatabase(databaseFile),
    }));
  }

  if (options.command === 'discover') {
    return print(await runDiscoverCommand(options));
  }

  if (options.command === 'search') {
    if (!options.company || !options.market) throw new Error('search requires --market and --company');
    const state = await runtime(options, options.market);
    const result = await searchCompany({
      market: options.market,
      company: options.company,
      officialDomain: options.officialDomain,
      cohortYear: options.cohortYear,
      recruitmentType: options.recruitmentType,
      maxQueries: options.maxQueries,
      router: state.router,
    });
    return print(result);
  }

  if (options.command === 'batch') {
    if (!options.input) throw new Error('batch requires --input');
    const entries = await readRecords(options.input);
    const defaultMarket = options.market || entries[0]?.market || 'NA';
    const state = await runtime(options, defaultMarket);
    const results = await searchBatch(entries, {
      market: defaultMarket,
      router: state.router,
      maxQueries: options.maxQueries,
      concurrency: options.concurrency,
    });
    if (options.output) await writeRecords(options.output, results, options.format);
    return print(results);
  }

  if (options.command === 'verify') {
    if (!options.input) throw new Error('verify requires --input');
    const candidates = await readRecords(options.input);
    let fetchPage = defaultFetchPage;
    if (options.fixturePages) {
      const pages = JSON.parse(await (await import('node:fs/promises')).readFile(options.fixturePages, 'utf8'));
      fetchPage = async (url) => {
        if (!pages[url]) throw new Error(`missing page fixture: ${url}`);
        return pages[url];
      };
    }
    const verified = await verifyCandidates(candidates, { fetchPage });
    if (options.output) await writeRecords(options.output, verified, options.format);
    return print(verified);
  }

  if (options.command === 'export') {
    if (!options.input || !options.output) throw new Error('export requires --input and --output');
    const records = await readRecords(options.input);
    const summary = await writeRecords(options.output, records, options.format);
    return print({ status: 'ok', ...summary });
  }

  throw new Error(`unknown command: ${options.command}`);
}

