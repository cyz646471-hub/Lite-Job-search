import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { diagnoseBrowserSearchChallenge } from '../scripts/diagnose-browser-search-challenge.mjs';

const PRODUCTION_ROOTS = ['src', 'scripts', 'bin', 'engine'];
const PRODUCTION_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.json', '.ps1', '.cmd', '.sh']);
const FORBIDDEN_FLAGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu-sandbox',
  '--disable-web-security',
  '--ignore-certificate-errors',
];

async function productionFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await productionFiles(absolutePath));
    else if (PRODUCTION_EXTENSIONS.has(path.extname(entry.name))) files.push(absolutePath);
  }
  return files;
}

test('manual diagnostic records no automated search and writes atomically', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-browser-diagnostic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await diagnoseBrowserSearchChallenge({ variant: 'A', outputDir: directory });
  assert.equal(result.status, 'MANUAL_OBSERVATION_REQUIRED');
  assert.equal(result.total_queries, 0);
  const persisted = JSON.parse(await readFile(path.join(directory, 'diagnostic.json'), 'utf8'));
  assert.equal(persisted.automation_mode, 'manual_normal_chrome');
});

test('production launcher requests Chromium sandbox and has no sandbox-disabling flags', async () => {
  const adapterSource = await readFile(
    new URL('../scripts/chrome-extension-browser-adapter.mjs', import.meta.url),
    'utf8',
  );
  const policySource = await readFile(
    new URL('../src/runtime/chrome-launch-policy.mjs', import.meta.url),
    'utf8',
  );
  assert.match(adapterSource, /buildSafePersistentChromeOptions/);
  assert.match(policySource, /chromiumSandbox:\s*true/);
});

test('all production entry points are free of forbidden Chrome arguments', async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  const policyFile = path.join(repositoryRoot, 'src', 'runtime', 'chrome-launch-policy.mjs');
  const files = [
    path.join(repositoryRoot, 'package.json'),
    ...(await Promise.all(PRODUCTION_ROOTS.map((root) => productionFiles(path.join(repositoryRoot, root))))).flat(),
  ];
  const violations = [];
  for (const file of files) {
    if (path.resolve(file) === policyFile) continue;
    const source = await readFile(file, 'utf8');
    for (const flag of FORBIDDEN_FLAGS) {
      if (source.includes(flag)) violations.push(`${path.relative(repositoryRoot, file)}: ${flag}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('diagnostic and supervisor do not report a requested sandbox as OS verified', async () => {
  const diagnosticSource = await readFile(
    new URL('../scripts/diagnose-browser-search-challenge.mjs', import.meta.url),
    'utf8',
  );
  const supervisorSource = await readFile(
    new URL('../scripts/run-persistent-browser-supervisor.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    diagnosticSource,
    /sandbox_request_status:\s*selectedVariant === ['"]B['"] \? ['"]REQUESTED['"] : ['"]NOT_REQUESTED['"]/,
  );
  assert.match(diagnosticSource, /profilePath:\s*resolvedProfile/);
  assert.match(
    supervisorSource,
    /sandbox_request_status:\s*browser \? ['"]REQUESTED['"] : ['"]NOT_REQUESTED['"]/,
  );
  for (const source of [diagnosticSource, supervisorSource]) {
    assert.match(source, /sandbox_verified:\s*['"]NOT_OS_VERIFIED['"]/);
    assert.doesNotMatch(source, /sandbox_verified:\s*['"]PLAYWRIGHT_SANDBOX_ENABLED['"]/);
  }
});
