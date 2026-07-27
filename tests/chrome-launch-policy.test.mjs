import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSafeChromeArgs,
  buildSafePersistentChromeOptions,
  FORBIDDEN_CHROME_ARGUMENTS,
} from '../src/runtime/chrome-launch-policy.mjs';

test('production persistent Chrome options request sandbox with an empty safe arg list', () => {
  assert.deepEqual(buildSafePersistentChromeOptions(), {
    channel: 'chrome',
    headless: false,
    chromiumSandbox: true,
    viewport: null,
    args: [],
  });
});

test('every forbidden Chrome argument prevents startup', () => {
  for (const argument of FORBIDDEN_CHROME_ARGUMENTS) {
    assert.throws(
      () => assertSafeChromeArgs([argument]),
      (error) => error?.code === 'BROWSER_UNSAFE_ARGUMENTS'
        && error.forbiddenArguments.includes(argument),
    );
  }
});

test('forbidden arguments are rejected even when they include a value', () => {
  assert.throws(
    () => assertSafeChromeArgs(['--ignore-certificate-errors=true']),
    /BROWSER_UNSAFE_ARGUMENTS/,
  );
});

test('non-security Chrome arguments remain available to reviewed callers', () => {
  assert.deepEqual(
    assertSafeChromeArgs(['--host-resolver-rules=MAP example.test 127.0.0.1']),
    ['--host-resolver-rules=MAP example.test 127.0.0.1'],
  );
});
