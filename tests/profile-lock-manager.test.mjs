import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acquireProfileLock } from '../src/runtime/profile-lock-manager.mjs';

const NOW = '2026-07-27T00:00:00.000Z';

async function directory(t) {
  const value = await mkdtemp(path.join(os.tmpdir(), 'ljs-profile-lock-'));
  t.after(() => rm(value, { recursive: true, force: true }));
  return value;
}

function options(profilePath, overrides = {}) {
  return {
    profilePath,
    instanceId: 'worker-new',
    batchId: 'batch-new',
    pid: 200,
    hostName: 'test-host',
    processStartToken: 'new-token',
    now: () => NOW,
    ...overrides,
  };
}

test('same live process identity cannot share one profile', async (t) => {
  const profilePath = await directory(t);
  const owner = await acquireProfileLock(options(profilePath, {
    instanceId: 'worker-owner',
    pid: 100,
    processStartToken: 'owner-token',
  }));
  await assert.rejects(acquireProfileLock(options(profilePath, {
    inspectOwner: async () => ({
      processExists: true,
      processStartToken: 'owner-token',
      chromeUsingProfile: false,
    }),
  })), /already owned/i);
  await owner.release();
});

test('PID reuse does not block audited stale-lock takeover', async (t) => {
  const profilePath = await directory(t);
  const owner = await acquireProfileLock(options(profilePath, {
    instanceId: 'worker-owner',
    pid: 100,
    processStartToken: 'old-token',
  }));
  const archives = [];
  const replacement = await acquireProfileLock(options(profilePath, {
    inspectOwner: async () => ({
      processExists: true,
      processStartToken: 'different-token',
      chromeUsingProfile: false,
    }),
    onStaleArchive: async (event) => archives.push(event),
  }));
  assert.equal(archives.length, 1);
  assert.equal(archives[0].existing.lockId, owner.lockId);
  assert.equal(await owner.release(), false);
  assert.equal(await replacement.release(), true);
});

test('Chrome using the profile prevents takeover even after supervisor exit', async (t) => {
  const profilePath = await directory(t);
  await acquireProfileLock(options(profilePath, {
    instanceId: 'worker-owner',
    pid: 100,
    processStartToken: 'old-token',
  }));
  await assert.rejects(acquireProfileLock(options(profilePath, {
    inspectOwner: async () => ({
      processExists: false,
      processStartToken: '',
      chromeUsingProfile: true,
    }),
  })), /already owned/i);
});

test('dead owner and unused Chrome profile can be archived and taken over', async (t) => {
  const profilePath = await directory(t);
  await acquireProfileLock(options(profilePath, {
    instanceId: 'worker-owner',
    pid: 100,
    processStartToken: 'old-token',
  }));
  const replacement = await acquireProfileLock(options(profilePath, {
    inspectOwner: async () => ({
      processExists: false,
      processStartToken: '',
      chromeUsingProfile: false,
    }),
  }));
  assert.equal(replacement.instanceId, 'worker-new');
  await replacement.release();
});

test('incomplete owner inspection never archives or takes over the profile', async (t) => {
  const profilePath = await directory(t);
  await acquireProfileLock(options(profilePath, {
    instanceId: 'worker-owner',
    pid: 100,
    processStartToken: 'old-token',
  }));
  await assert.rejects(acquireProfileLock(options(profilePath, {
    inspectOwner: async () => ({
      processExists: false,
      processStartToken: '',
      chromeUsingProfile: null,
      inspectionComplete: false,
      inspectionError: 'PROCESS_INSPECTION_TIMEOUT',
    }),
  })), (error) => (
    error.code === 'PROFILE_OWNER_UNVERIFIED'
    && error.causeCode === 'PROCESS_INSPECTION_TIMEOUT'
  ));
});

test('old owner cannot delete a replacement lock', async (t) => {
  const profilePath = await directory(t);
  const owner = await acquireProfileLock(options(profilePath));
  const lockFile = path.join(profilePath, '.lite-job-search-worker.lock');
  await writeFile(lockFile, JSON.stringify({ ...owner, lockId: 'new-owner-lock' }));
  assert.equal(await owner.release(), false);
  assert.match(await readFile(lockFile, 'utf8'), /new-owner-lock/);
});
