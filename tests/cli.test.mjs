import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const bin = path.join(root, 'bin', 'lite-job-search.mjs');

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

test('doctor reports a redacted no-provider mode without keys', () => {
  const result = run(['doctor', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const doctor = JSON.parse(result.stdout);
  assert.equal(doctor.searchMode, 'no_provider');
  assert.equal(doctor.canRunLiveSearch, false);
  assert.equal(doctor.providers.tavily, 'not_configured');
  assert.doesNotMatch(result.stdout, /api[_-]?key|bearer/i);
});

test('search and batch run through a manual provider without network access', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-search-cli-'));
  const manual = path.join(directory, 'manual.json');
  const input = path.join(directory, 'companies.json');
  await writeFile(manual, JSON.stringify([
    { company: 'Acme', title: 'Acme Careers', url: 'https://acme.com/jobs' },
    { company: 'Stripe', title: 'Stripe Jobs', url: 'https://stripe.com/jobs/search' },
  ]));
  await writeFile(input, JSON.stringify([
    { company: 'Acme', market: 'NA' },
    { company: 'Stripe', market: 'NA' },
  ]));

  const single = run(['search', '--market', 'NA', '--company', 'Acme', '--manual', manual, '--json']);
  assert.equal(single.status, 0, single.stderr);
  assert.equal(JSON.parse(single.stdout).candidates[0].url, 'https://acme.com/jobs');

  const batch = run(['batch', '--input', input, '--manual', manual, '--json']);
  assert.equal(batch.status, 0, batch.stderr);
  assert.equal(JSON.parse(batch.stdout).length, 2);
});

test('verify and export work with offline page fixtures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-search-verify-'));
  const input = path.join(directory, 'candidates.json');
  const pages = path.join(directory, 'pages.json');
  const output = path.join(directory, 'verified.csv');
  const url = 'https://acme.com/jobs';
  await writeFile(input, JSON.stringify([{
    market: 'NA',
    company: 'Acme',
    url,
    officialDomain: 'acme.com',
  }]));
  await writeFile(pages, JSON.stringify({
    [url]: {
      status: 200,
      finalUrl: url,
      html: '<title>Acme Careers</title><h1>Open positions</h1><a href="/jobs/1">Engineer</a><a href="/jobs/2">Intern</a>',
    },
  }));

  const verified = run(['verify', '--input', input, '--fixture-pages', pages, '--json']);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout)[0].jobListUrl, url);

  await writeFile(input, verified.stdout);
  const exported = run(['export', '--input', input, '--output', output, '--format', 'csv', '--json']);
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(await readFile(output, 'utf8'), /company,market/);
});
