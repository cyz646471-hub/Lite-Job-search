import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileSearchInstruction } from '../src/application/compile-search-instruction.mjs';
import { normalizePublicSearchEngine } from '../src/adapters/browser/public-search-page-adapter.mjs';
import {
  normalizeCompanyRegistry,
  selectUnseenCompanies,
} from '../src/application/resolve-task-companies.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const BOOLEAN_ARGS = new Set([
  'help',
  'plan-only',
  'no-registry-scan',
  'retry-failed',
  'headless',
]);

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    args[name] = BOOLEAN_ARGS.has(name) ? true : argv[++index];
  }
  args.instruction = args.instruction || positional.join(' ').trim();
  return args;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function loadLocalRegistries({
  primaryFile,
  market,
  scanDirectory = true,
}) {
  const primary = path.resolve(primaryFile);
  const files = [primary];
  if (scanDirectory) {
    const entries = await fs.readdir(path.dirname(primary), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;
      const candidate = path.join(path.dirname(primary), entry.name);
      if (path.resolve(candidate) !== primary) files.push(candidate);
    }
  }
  const companies = [];
  const sources = [];
  const failures = [];
  for (const file of files) {
    try {
      const input = await readJson(file);
      const normalized = normalizeCompanyRegistry(input, { market, source: file });
      companies.push(...normalized);
      sources.push({ file, records: normalized.length, status: 'LOADED' });
    } catch (error) {
      failures.push({
        file,
        status: 'FAILED',
        reasonCode: 'registry_read_failed',
        error: String(error?.message || error).slice(0, 240),
      });
    }
  }
  if (!sources.some((item) => path.resolve(item.file) === primary)) {
    const primaryFailure = failures.find((item) => path.resolve(item.file) === primary);
    throw new Error(primaryFailure?.error || `unable to read primary registry: ${primary}`);
  }
  return { companies, sources, failures };
}

async function loadSupplementCompanies(modulePath, { task, knownCompanies, needed }) {
  if (!modulePath || needed < 1) {
    return { configured: Boolean(modulePath), companies: [], status: modulePath ? 'NOT_NEEDED' : 'NOT_CONFIGURED' };
  }
  const loaded = await import(pathToFileURL(path.resolve(modulePath)).href);
  const provider = loaded.provideCompanies || loaded.default;
  if (typeof provider !== 'function') {
    throw new Error('company supplement module must export provideCompanies or a default function');
  }
  const result = await provider({
    task,
    knownCompanies,
    needed,
  });
  return {
    configured: true,
    companies: normalizeCompanyRegistry(result, {
      market: task.market,
      source: path.resolve(modulePath),
    }),
    status: 'CONFIGURED',
  };
}

function selectionBatchId(task, companies) {
  const digest = createHash('sha256')
    .update(JSON.stringify(companies.map((item) => ({
      company: item.company,
      officialDomain: item.officialDomain,
    }))))
    .digest('hex')
    .slice(0, 8);
  return `${task.batchId}-${digest}`;
}

function workerArguments({ task, selectedFile, outputDir, database, batchId, args }) {
  const values = [
    path.resolve('scripts/run-persistent-browser-supervisor.mjs'),
    '--input', selectedFile,
    '--output-dir', outputDir,
    '--database', database,
    '--role', task.role,
    '--industry', task.industry,
    '--location', task.location,
    '--freshness-days', String(task.freshnessDays),
    '--target-count', String(task.targetCount),
    '--batch-id', batchId,
    '--max-results', String(task.maxResults),
    '--max-candidates', String(task.maxCandidates),
    '--max-career-entries', String(task.maxCareerEntries),
    '--max-depth', String(task.maxDepth),
    '--timeout-ms', String(task.timeoutMs),
    '--search-delay-ms', String(task.searchDelayMs),
    '--search-jitter-ms', String(task.searchJitterMs),
    '--max-companies-per-run', String(task.maxCompaniesPerRun),
  ];
  if (args['profile-dir']) values.push('--profile-dir', path.resolve(args['profile-dir']));
  values.push('--search-engine', task.searchEngine);
  if (args['retry-failed']) values.push('--retry-failed');
  if (args.headless) values.push('--headless');
  return values;
}

async function readRunReport(outputDir) {
  try {
    return await readJson(path.join(outputDir, 'run-report.json'));
  } catch {
    return null;
  }
}

async function writeInstructionReport(outputDir, report) {
  await fs.writeFile(
    path.join(outputDir, 'instruction-run-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

function shouldContinue(report) {
  if (report?.status !== 'PAUSED') return false;
  if ((report?.batch?.pending || 0) < 1) return false;
  if ((report?.batch?.deferred || 0) > 0) return false;
  return !['OPEN', 'HALF_OPEN'].includes(report?.providerCircuit?.state);
}

async function buildFinalXlsx({ outputDir, xlsxOutput }) {
  const input = path.join(outputDir, 'student-application-rows.json');
  try {
    await fs.access(input);
  } catch {
    return { status: 'NOT_CREATED', reasonCode: 'student_projection_missing' };
  }
  const result = spawnSync(process.execPath, [
    path.resolve('scripts/build-browser-batch-xlsx.mjs'),
    '--input', input,
    '--output', xlsxOutput,
  ], {
    cwd: path.resolve('.'),
    stdio: 'inherit',
  });
  return result.status === 0
    ? { status: 'CREATED', file: xlsxOutput }
    : { status: 'FAILED', reasonCode: 'xlsx_export_failed', exitCode: result.status };
}

export async function runSearchInstructionCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.instruction) {
    process.stdout.write(
      'Usage: npm.cmd run discover:instruction -- "<instruction>" [--registry companies.json] [--database jobs.sqlite] [--output-dir output] [--xlsx-output jobs.xlsx] [--company-supplement-module provider.mjs] [--plan-only]\n',
    );
    return args.help ? 0 : 2;
  }

  const compiled = compileSearchInstruction(args.instruction);
  if (compiled.market === 'CN'
    && args['browser-mode']
    && args['browser-mode'] !== compiled.browserMode) {
    throw new Error(
      'China production search requires the dedicated persistent Chrome worker profile',
    );
  }
  const outputDirArgument = args['output-dir'] || compiled.outputDir;
  const task = Object.freeze({
    ...compiled,
    registry: args.registry || compiled.registry,
    database: args.database || compiled.database,
    outputDir: outputDirArgument,
    xlsxOutput: args['xlsx-output'] || path.join(outputDirArgument, 'student-applications.xlsx'),
    browserMode: args['browser-mode'] || compiled.browserMode,
    searchEngine: normalizePublicSearchEngine(
      args['search-engine'] || compiled.searchEngine,
    ),
    searchSources: Object.freeze([
      `chrome_${normalizePublicSearchEngine(args['search-engine'] || compiled.searchEngine)}_visible_search`,
    ]),
    maxCompaniesPerRun: boundedInteger(
      args['max-companies-per-run'],
      compiled.maxCompaniesPerRun,
      1,
      100,
    ),
  });
  const outputDir = path.resolve(task.outputDir);
  const database = path.resolve(task.database);
  const registry = path.resolve(task.registry);
  const xlsxOutput = path.resolve(task.xlsxOutput);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.dirname(database), { recursive: true });

  const repository = openSqliteMarketDiscoveryRepository({ file: database });
  repository.migrate();
  const knownCompanies = repository.listCompanies();
  repository.close();

  const local = await loadLocalRegistries({
    primaryFile: registry,
    market: task.market,
    scanDirectory: !args['no-registry-scan'],
  });
  const localSelection = selectUnseenCompanies({
    registryCompanies: local.companies,
    knownCompanies,
    targetCount: task.targetCount,
    market: task.market,
  });
  const supplement = await loadSupplementCompanies(args['company-supplement-module'], {
    task,
    knownCompanies,
    needed: localSelection.stats.shortage,
  });
  const selection = selectUnseenCompanies({
    registryCompanies: local.companies,
    knownCompanies,
    supplementCompanies: supplement.companies,
    supplementConfigured: supplement.configured,
    targetCount: task.targetCount,
    market: task.market,
  });
  const batchId = selectionBatchId(task, selection.companies);
  const selectedFile = path.join(outputDir, 'selected-companies.json');
  const manifest = {
    schemaVersion: 1,
    task: {
      ...task,
      registry,
      database,
      outputDir,
      xlsxOutput,
      batchId,
    },
    selection: {
      ...selection.stats,
      supplementStatus: selection.supplementStatus,
      knownCompanies: knownCompanies.filter(
        (item) => item.market === task.market,
      ).length,
    },
    registrySources: local.sources,
    registryFailures: local.failures,
    generatedFiles: {
      selectedCompanies: selectedFile,
      database,
      xlsx: xlsxOutput,
    },
  };
  await Promise.all([
    fs.writeFile(
      path.join(outputDir, 'task-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
    fs.writeFile(selectedFile, `${JSON.stringify(selection.companies, null, 2)}\n`),
  ]);

  if (!selection.companies.length) {
    const response = {
      status: 'NO_UNSEEN_COMPANIES',
      selectedCompanies: 0,
      shortage: selection.stats.shortage,
      supplementStatus: selection.supplementStatus,
      outputDir,
    };
    await writeInstructionReport(outputDir, response);
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 0;
  }

  if (args['plan-only']) {
    const response = {
      status: selection.stats.shortage > 0 ? 'PLANNED_WITH_SHORTAGE' : 'PLANNED',
      batchId,
      selectedCompanies: selection.companies.length,
      shortage: selection.stats.shortage,
      supplementStatus: selection.supplementStatus,
      outputDir,
      manifest: path.join(outputDir, 'task-manifest.json'),
    };
    await writeInstructionReport(outputDir, response);
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 0;
  }

  const maxCycles = boundedInteger(
    args['max-cycles'],
    Math.ceil(selection.companies.length / task.maxCompaniesPerRun) + 1,
    1,
    101,
  );
  const cycles = [];
  let finalReport = null;
  let finalStatus = 'FAILED';
  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const result = spawnSync(process.execPath, workerArguments({
      task,
      selectedFile,
      outputDir,
      database,
      batchId,
      args,
    }), {
      cwd: path.resolve('.'),
      stdio: 'inherit',
    });
    finalReport = await readRunReport(outputDir);
    cycles.push({
      cycle,
      exitCode: result.status,
      status: finalReport?.status || 'FAILED',
      batch: finalReport?.batch || null,
      providerCircuit: finalReport?.providerCircuit || null,
    });
    finalStatus = finalReport?.status || 'FAILED';
    await writeInstructionReport(outputDir, {
      status: finalStatus,
      task: manifest.task,
      selection: manifest.selection,
      cycles,
      finalRunReport: finalReport,
    });
    if (!shouldContinue(finalReport)) break;
  }

  if (finalStatus === 'PAUSED'
    && ['OPEN', 'HALF_OPEN'].includes(finalReport?.providerCircuit?.state)) {
    finalStatus = 'BLOCKED';
  } else if (finalStatus === 'PAUSED') {
    finalStatus = 'PARTIAL';
  }
  const xlsx = await buildFinalXlsx({ outputDir, xlsxOutput });
  if (xlsx.status === 'FAILED' && finalStatus === 'COMPLETE') {
    finalStatus = 'COMPLETE_WITH_ERRORS';
  }
  const response = {
    status: finalStatus,
    batchId,
    selectedCompanies: selection.companies.length,
    shortage: selection.stats.shortage,
    supplementStatus: selection.supplementStatus,
    cycles,
    database,
    outputDir,
    xlsx,
  };
  await writeInstructionReport(outputDir, {
    ...response,
    task: manifest.task,
    selection: manifest.selection,
    finalRunReport: finalReport,
  });
  process.stdout.write(`${JSON.stringify(response)}\n`);
  return ['COMPLETE', 'NO_UNSEEN_COMPANIES'].includes(finalStatus) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSearchInstructionCli().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      reasonCode: 'instruction_runner_failed',
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 1;
  });
}
