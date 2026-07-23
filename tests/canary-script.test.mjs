import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

test('AI product manager canary reports missing configuration without network claims', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-canary-'));
  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'run-ai-product-manager-canary.mjs'),
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      LITE_JOB_DATABASE_FILE: path.join(directory, 'canary.sqlite'),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'NOT_CONFIGURED');
  assert.equal(output.liveSearchExecuted, false);
  assert.deepEqual(output.report.searchQueries, []);
  assert.equal(output.report.candidateUrlCount, 0);
  assert.equal(output.report.candidateCompanyCount, 0);
  assert.equal(output.report.officialVerifiedCount, 0);
  assert.equal(output.report.reviewCount, 0);
  assert.equal(output.report.rejectedCount, 0);
  assert.equal(output.report.extractedJobCount, 0);
  assert.equal(output.report.failures[0].code, 'NOT_CONFIGURED');
  assert.equal(output.report.quality.officialVerificationRate.value, null);
  assert.doesNotMatch(result.stdout + result.stderr, /authorization|bearer|api[_-]?key/i);
});
