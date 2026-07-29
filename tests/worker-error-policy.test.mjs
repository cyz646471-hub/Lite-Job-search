import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyWorkerError,
  runWithWorkerErrorPolicy,
} from '../src/application/worker-error-policy.mjs';

test('transient process inspection timeout retries and then succeeds', async () => {
  let calls = 0;
  const errors = [];
  const result = await runWithWorkerErrorPolicy(async () => {
    calls += 1;
    if (calls < 3) {
      throw Object.assign(new Error('spawnSync powershell.exe ETIMEDOUT'), {
        code: 'ETIMEDOUT',
      });
    }
    return { status: 'COMPLETE' };
  }, {
    maxRetries: 2,
    retryDelayMs: 1,
    sleep: async () => {},
    onError: async (event) => errors.push(event),
  });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
  assert.deepEqual(errors.map((event) => event.canRetry), [true, true]);
  assert.ok(errors.every((event) => (
    event.classification.code === 'PROCESS_INSPECTION_TIMEOUT'
  )));
});

test('transient errors pause with evidence after bounded retries', async () => {
  const result = await runWithWorkerErrorPolicy(async () => {
    throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
  }, {
    maxRetries: 1,
    retryDelayMs: 0,
  });
  assert.equal(result.status, 'PAUSED');
  assert.equal(result.attempts, 2);
  assert.equal(result.error.code, 'SQLITE_BUSY');
});

test('profile contention pauses without unsafe retry', async () => {
  let calls = 0;
  const result = await runWithWorkerErrorPolicy(async () => {
    calls += 1;
    throw Object.assign(new Error('persistent profile is already owned'), {
      code: 'PROFILE_IN_USE',
    });
  });
  assert.equal(result.status, 'PAUSED');
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

test('invalid configuration and unknown errors fail fast', async () => {
  assert.equal(
    classifyWorkerError(new Error('profile-dir must be a dedicated automation profile')).code,
    'INVALID_CONFIGURATION',
  );
  await assert.rejects(
    runWithWorkerErrorPolicy(async () => {
      throw new Error('unexpected invariant violation');
    }),
    /unexpected invariant violation/,
  );
});
