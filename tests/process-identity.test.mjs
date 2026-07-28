import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentProcessStartToken,
  inspectProfileOwner,
} from '../src/runtime/process-identity.mjs';

test('current process identity is stable without launching PowerShell', () => {
  let calls = 0;
  const dependencies = {
    execute() {
      calls += 1;
      throw new Error('PowerShell must not be called for the current process');
    },
  };
  const first = currentProcessStartToken(process.pid, dependencies);
  const second = currentProcessStartToken(process.pid, dependencies);
  assert.ok(first);
  assert.equal(first, second);
  assert.equal(calls, 0);
});

test('timed out Windows owner inspection remains explicitly unverified', {
  skip: process.platform !== 'win32',
}, () => {
  const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
  const owner = inspectProfileOwner({
    pid: 987_654,
    profilePath: 'C:\\automation-profile',
  }, {
    execute() {
      throw timeout;
    },
    killProcess() {
      throw Object.assign(new Error('not found'), { code: 'ESRCH' });
    },
  });
  assert.equal(owner.processExists, false);
  assert.equal(owner.chromeUsingProfile, null);
  assert.equal(owner.inspectionComplete, false);
  assert.equal(owner.inspectionError, 'PROCESS_INSPECTION_TIMEOUT');
});
