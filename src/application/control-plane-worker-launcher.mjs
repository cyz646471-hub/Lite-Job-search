import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';

function activeWorkerForBatch(repository, batchId) {
  return repository.listWorkerInstances().find((worker) => (
    worker.batchId === batchId
    && !['EXITED', 'CRASHED'].includes(worker.state)
    && (
      !worker.heartbeatAt
      || Date.now() - Date.parse(worker.heartbeatAt) < 120_000
    )
  )) || null;
}

export function createControlPlaneWorkerLauncher({
  repository,
  database,
  registry,
  outputDirectory,
  profileDirectory,
  runnerFile,
  maxCompaniesPerRun = 10,
  retryFailed = true,
  maxSupervisorRetries = 2,
  supervisorRetryDelayMs = 2_000,
  spawnProcess = spawn,
} = {}) {
  if (!repository || !database || !registry || !outputDirectory || !profileDirectory) {
    throw new Error('worker launcher requires repository, database, registry, output and profile');
  }
  const resolvedRunner = path.resolve(runnerFile || 'scripts/run-control-task.mjs');
  const children = new Map();

  return Object.freeze({
    start(batchId) {
      const task = repository.listControlTasks().find((item) => item.batchId === batchId);
      if (!task) throw new Error(`unknown control task batch: ${batchId}`);
      const active = activeWorkerForBatch(repository, batchId);
      if (active) {
        return Object.freeze({
          status: 'ALREADY_RUNNING',
          batchId,
          taskId: task.id,
          pid: active.pid,
        });
      }
      const previous = children.get(batchId);
      if (previous && previous.exitCode == null && !previous.killed) {
        return Object.freeze({
          status: 'ALREADY_STARTING',
          batchId,
          taskId: task.id,
          pid: previous.pid,
        });
      }

      const output = path.resolve(outputDirectory);
      mkdirSync(output, { recursive: true });
      const stdout = openSync(path.join(output, 'dashboard-worker.stdout.log'), 'a');
      const stderr = openSync(path.join(output, 'dashboard-worker.stderr.log'), 'a');
      const args = [
        resolvedRunner,
        '--task', task.id,
        '--registry', path.resolve(registry),
        '--database', path.resolve(database),
        '--output-dir', output,
        '--profile-dir', path.resolve(profileDirectory),
        '--max-companies-per-run', String(maxCompaniesPerRun),
        '--max-supervisor-retries', String(maxSupervisorRetries),
        '--supervisor-retry-delay-ms', String(supervisorRetryDelayMs),
      ];
      if (retryFailed) args.push('--retry-failed');
      let child;
      try {
        child = spawnProcess(process.execPath, args, {
          cwd: path.resolve('.'),
          detached: true,
          windowsHide: true,
          stdio: ['ignore', stdout, stderr],
        });
      } finally {
        closeSync(stdout);
        closeSync(stderr);
      }
      children.set(batchId, child);
      child.once('exit', () => children.delete(batchId));
      child.unref();
      return Object.freeze({
        status: 'STARTED',
        batchId,
        taskId: task.id,
        pid: child.pid,
      });
    },
  });
}
