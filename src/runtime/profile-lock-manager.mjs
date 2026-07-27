import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  currentHostName,
  currentProcessStartToken,
  inspectProfileOwner,
} from './process-identity.mjs';

const LOCK_NAME = '.lite-job-search-worker.lock';

async function readLock(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    const wrapped = new Error(`persistent profile is already owned by an unreadable lock: ${file}`);
    wrapped.code = 'PROFILE_LOCK_UNREADABLE';
    throw wrapped;
  }
}

async function atomicWrite(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

export async function acquireProfileLock({
  profilePath,
  instanceId,
  batchId,
  now = () => new Date().toISOString(),
  pid = process.pid,
  hostName = currentHostName(),
  processStartToken = currentProcessStartToken(pid),
  inspectOwner = inspectProfileOwner,
  onStaleArchive = async () => {},
} = {}) {
  if (!profilePath || !instanceId || !batchId || !processStartToken) {
    throw new Error('profilePath, instanceId, batchId and processStartToken are required');
  }
  const profileRealPath = path.resolve(profilePath);
  await mkdir(profileRealPath, { recursive: true });
  const lockFile = path.join(profileRealPath, LOCK_NAME);
  const existing = await readLock(lockFile);
  if (existing) {
    const owner = await inspectOwner({
      pid: existing.pid,
      profilePath: profileRealPath,
      expectedProcessStartToken: existing.processStartToken,
    });
    const exactOwnerAlive = owner.processExists
      && owner.processStartToken
      && owner.processStartToken === existing.processStartToken;
    if (exactOwnerAlive || owner.chromeUsingProfile) {
      const error = new Error(`persistent profile is already owned: ${lockFile}`);
      error.code = 'PROFILE_IN_USE';
      error.owner = existing;
      throw error;
    }
    if (owner.processExists && !owner.processStartToken) {
      const error = new Error(`profile owner identity cannot be verified: ${lockFile}`);
      error.code = 'PROFILE_OWNER_UNVERIFIED';
      throw error;
    }
    const archive = `${lockFile}.stale.${Date.now()}.${existing.lockId || 'unknown'}.json`;
    await rename(lockFile, archive);
    await onStaleArchive({ lockFile, archive, existing, owner, archivedAt: now() });
  }

  const lock = {
    lockId: randomUUID(),
    instanceId,
    batchId,
    profileKey: profileRealPath.toLowerCase(),
    profileRealPath,
    hostName,
    pid,
    processStartToken,
    startedAt: now(),
    heartbeatAt: now(),
  };
  let handle;
  try {
    handle = await open(lockFile, 'wx');
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const conflict = new Error(`persistent profile is already owned: ${lockFile}`);
      conflict.code = 'PROFILE_IN_USE';
      throw conflict;
    }
    throw error;
  } finally {
    await handle?.close();
  }

  return Object.freeze({
    ...lock,
    lockFile,
    async heartbeat(heartbeatAt = now()) {
      const current = await readLock(lockFile);
      if (!current || current.lockId !== lock.lockId) {
        throw new Error('profile lock ownership changed');
      }
      const updated = { ...current, heartbeatAt };
      await atomicWrite(lockFile, updated);
      return updated;
    },
    async release() {
      const current = await readLock(lockFile);
      if (!current) return false;
      if (current.lockId !== lock.lockId) return false;
      await unlink(lockFile);
      return true;
    },
  });
}
