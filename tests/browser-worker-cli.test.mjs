import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(ROOT, 'scripts', 'company-browser-discovery.mjs'),
      ...args,
    ], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('normal Chrome binding module runs candidate verification, extraction and SQLite through CLI', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-normal-chrome-cli-'));
  const inputFile = path.join(directory, 'companies.json');
  const outputDir = path.join(directory, 'output');
  const databaseFile = path.join(directory, 'jobs.sqlite');
  await writeFile(inputFile, JSON.stringify([{
    company: '示例公司',
    officialDomain: 'example.com',
  }]));

  const result = await runCli([
    '--input', inputFile,
    '--output-dir', outputDir,
    '--database', databaseFile,
    '--browser-mode', 'normal-chrome',
    '--chrome-binding-module',
    path.join(ROOT, 'tests', 'fixtures', 'fake-normal-chrome-binding.mjs'),
    '--batch-id', 'normal-chrome-cli',
    '--max-companies-per-run', '1',
    '--max-career-entries', '1',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout.trim());
  const report = JSON.parse(await readFile(
    path.join(outputDir, 'run-report.json'),
    'utf8',
  ));
  assert.equal(summary.status, 'COMPLETE');
  assert.equal(report.discovery.searchQueries.length, 1);
  assert.equal(report.discovery.completedCompanies, 1);
  assert.equal(report.discovery.candidateUrlCount, 1);
  assert.equal(report.verification.verified, 1);
  assert.equal(report.extraction.jobsStored, 1);
});
