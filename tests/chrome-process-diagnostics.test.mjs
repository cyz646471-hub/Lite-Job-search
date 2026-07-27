import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectChromeProcessRows } from '../src/runtime/chrome-process-diagnostics.mjs';

test('Chrome diagnostics match the requested profile and expose unsafe actual flags', () => {
  const rows = [
    {
      ProcessId: 42,
      ParentProcessId: 7,
      ExecutablePath: 'C:\\Chrome\\chrome.exe',
      CommandLine: '"C:\\Chrome\\chrome.exe" --user-data-dir=C:\\profiles\\ljs --no-sandbox',
    },
    {
      ProcessId: 43,
      CommandLine: '"C:\\Chrome\\chrome.exe" --user-data-dir=C:\\profiles\\other',
    },
  ];
  const [result] = inspectChromeProcessRows(rows, 'C:\\profiles\\ljs');
  assert.equal(result.chromePid, 42);
  assert.deepEqual(result.forbiddenArguments, ['--no-sandbox']);
});

test('Chrome diagnostics can follow the worker child-process tree', () => {
  const processes = inspectChromeProcessRows([{
    ProcessId: 201,
    ParentProcessId: 100,
    ExecutablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    CommandLine: 'chrome.exe --type=browser',
  }, {
    ProcessId: 202,
    ParentProcessId: 201,
    ExecutablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    CommandLine: 'chrome.exe --type=renderer',
  }], 'C:\\profile-not-in-command-line', { workerPid: 100 });
  assert.equal(processes.length, 2);
  assert.equal(processes[0].matchReason, 'WORKER_PROCESS_TREE');
});
