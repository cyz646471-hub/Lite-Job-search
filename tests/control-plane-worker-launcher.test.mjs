import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createControlPlaneWorkerLauncher } from '../src/application/control-plane-worker-launcher.mjs';

function child(pid = 1234) {
  const value = new EventEmitter();
  value.pid = pid;
  value.exitCode = null;
  value.killed = false;
  value.unref = () => {};
  return value;
}

test('control-plane launcher starts one detached task runner and suppresses duplicates', () => {
  const calls = [];
  const launched = child();
  const repository = {
    listControlTasks: () => [{ id: 'task-1', batchId: 'batch-1' }],
    listWorkerInstances: () => [],
  };
  const launcher = createControlPlaneWorkerLauncher({
    repository,
    database: 'data/jobs.sqlite',
    registry: 'data/companies.json',
    outputDirectory: 'test-output/worker',
    profileDirectory: 'data/profile',
    maxCompaniesPerRun: 20,
    timeoutMs: 12_000,
    searchDelayMs: 10_000,
    searchJitterMs: 0,
    searchEngine: 'google',
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return launched;
    },
  });

  const first = launcher.start('batch-1');
  const second = launcher.start('batch-1');

  assert.equal(first.status, 'STARTED');
  assert.equal(second.status, 'ALREADY_STARTING');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.windowsHide, true);
  assert.ok(calls[0].args.includes('task-1'));
  assert.deepEqual(
    calls[0].args.slice(calls[0].args.indexOf('--max-companies-per-run'), calls[0].args.indexOf('--max-supervisor-retries')),
    [
      '--max-companies-per-run', '20',
      '--timeout-ms', '12000',
      '--search-delay-ms', '10000',
      '--search-jitter-ms', '0',
      '--search-engine', 'google',
    ],
  );
});

test('control-plane launcher reuses a healthy recorded worker', () => {
  let spawnCalls = 0;
  const repository = {
    listControlTasks: () => [{ id: 'task-1', batchId: 'batch-1' }],
    listWorkerInstances: () => [{
      batchId: 'batch-1',
      state: 'RUNNING',
      pid: 9876,
      heartbeatAt: new Date().toISOString(),
    }],
  };
  const launcher = createControlPlaneWorkerLauncher({
    repository,
    database: 'data/jobs.sqlite',
    registry: 'data/companies.json',
    outputDirectory: 'test-output/worker',
    profileDirectory: 'data/profile',
    spawnProcess() {
      spawnCalls += 1;
      return child();
    },
  });

  const result = launcher.start('batch-1');
  assert.equal(result.status, 'ALREADY_RUNNING');
  assert.equal(result.pid, 9876);
  assert.equal(spawnCalls, 0);
});

test('control-plane launcher rejects an unknown search engine', () => {
  assert.throws(() => createControlPlaneWorkerLauncher({
    repository: {},
    database: 'data/jobs.sqlite',
    registry: 'data/companies.json',
    outputDirectory: 'test-output/worker',
    profileDirectory: 'data/profile',
    searchEngine: 'fallback-chain',
  }), /unsupported worker search engine/);
});
