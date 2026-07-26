import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseTimeRange, runDiscoverCommand } from '../src/cli/discover.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const bin = path.join(root, 'bin', 'lite-job-search.mjs');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'ai-product-manager');

test('time range parser accepts days, weeks and months', () => {
  assert.equal(parseTimeRange('近3个月'), 90);
  assert.equal(parseTimeRange('2 weeks'), 14);
  assert.equal(parseTimeRange('45 days'), 45);
});

function run(args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      ...env,
    },
  });
}

test('discover requires role and market', () => {
  const result = run(['discover', '--market', 'CN', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /discover requires --market and --role/);
});

test('discover runs offline with planning, search and page fixtures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-discover-cli-'));
  const result = run([
    'discover',
    '--market', 'CN',
    '--role', 'AI产品经理',
    '--industry', 'AI,互联网',
    '--location', '上海',
    '--since-days', '90',
    '--limit', '20',
    '--planning-fixture', path.join(fixtureRoot, 'planning.json'),
    '--manual', path.join(fixtureRoot, 'search-results.json'),
    '--fixture-pages', path.join(fixtureRoot, 'pages.json'),
    '--database', path.join(directory, 'jobs.sqlite'),
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.jobsStored, 1);
  assert.equal(output.portalsVerified, 2);
  assert.equal(output.reviewRequired, 0);
  assert.equal(output.rejected, 1);
  assert.equal(output.liveSearchExecuted, false);
  assert.equal(output.intent.location, '上海');
  assert.equal(output.report.searchQueries.length, 1);
  assert.equal(output.report.candidateUrlCount, 3);
});

test('discover without an LLM configuration reports not configured', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-discover-none-'));
  const result = run([
    'discover',
    '--market', 'CN',
    '--role', 'AI产品经理',
    '--database', path.join(directory, 'jobs.sqlite'),
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'NOT_CONFIGURED');
  assert.equal(JSON.parse(result.stdout).report.failures[0].code, 'NOT_CONFIGURED');
});

test('discover returns a structured FAILED report when runtime initialization fails', async () => {
  const output = await runDiscoverCommand({
    market: 'CN',
    role: 'AI产品经理',
  }, {
    env: {
      LITE_JOB_LLM_ENDPOINT: 'https://llm.example.test/v1/chat/completions',
      LITE_JOB_LLM_MODEL: 'fixture-model',
    },
    runtimeFactory: async () => {
      throw new Error('fixture runtime unavailable');
    },
  });

  assert.equal(output.status, 'FAILED');
  assert.equal(output.liveSearchExecuted, false);
  assert.equal(output.report.failures[0].stage, 'runtime_initialization');
});

test('discover-batch checkpoints all items and reports missing configuration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-discover-batch-'));
  const database = path.join(directory, 'jobs.sqlite');
  const args = [
    'discover-batch',
    '--input', path.join(root, 'examples', 'first-data-batch.json'),
    '--batch-id', 'fixture-first-batch',
    '--database', database,
    '--json',
  ];
  const first = run(args);
  assert.equal(first.status, 0, first.stderr);
  const output = JSON.parse(first.stdout);
  assert.equal(output.status, 'COMPLETE_WITH_ERRORS');
  assert.equal(output.total, 4);
  assert.equal(output.failed, 4);
  assert.ok(output.items.every((item) => item.resultStatus === 'NOT_CONFIGURED'));
  assert.ok(output.items.every((item) => item.attemptCount === 1));

  const resumed = run(args);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.ok(JSON.parse(resumed.stdout).items.every((item) => item.attemptCount === 1));
});
