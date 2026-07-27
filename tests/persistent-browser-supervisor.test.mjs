import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runPersistentBrowserSupervisor } from '../scripts/run-persistent-browser-supervisor.mjs';

async function createInput(directory) {
  const input = path.join(directory, 'companies.json');
  await writeFile(input, JSON.stringify([{ company: 'Example Company', market: 'CN' }]));
  return input;
}

test('persistent supervisor rejects the daily Chrome profile before launching Playwright', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-persistent-profile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = await createInput(directory);

  await assert.rejects(
    runPersistentBrowserSupervisor({
      input,
      outputDir: path.join(directory, 'output'),
      database: path.join(directory, 'jobs.sqlite'),
      profileDir: path.join(directory, 'Google', 'Chrome', 'User Data'),
    }),
    /dedicated automation profile/i,
  );
});

test('persistent supervisor also rejects a named daily Chrome subprofile', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-persistent-subprofile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = await createInput(directory);

  await assert.rejects(
    runPersistentBrowserSupervisor({
      input,
      outputDir: path.join(directory, 'output'),
      database: path.join(directory, 'jobs.sqlite'),
      profileDir: path.join(directory, 'Google', 'Chrome', 'User Data', 'Profile 1'),
    }),
    /dedicated automation profile/i,
  );
});

test('persistent supervisor fails closed while its dedicated profile is locked', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-persistent-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = await createInput(directory);
  const profileDir = path.join(directory, 'automation-profile');
  await mkdir(profileDir, { recursive: true });
  await writeFile(path.join(profileDir, '.lite-job-search-worker.lock'), 'owned');

  await assert.rejects(
    runPersistentBrowserSupervisor({
      input,
      outputDir: path.join(directory, 'output'),
      database: path.join(directory, 'jobs.sqlite'),
      profileDir,
    }),
    /already owned/i,
  );
});
