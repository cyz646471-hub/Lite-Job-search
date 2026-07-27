import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { FORBIDDEN_CHROME_ARGUMENTS } from './chrome-launch-policy.mjs';

function commandLineFlags(commandLine = '') {
  return FORBIDDEN_CHROME_ARGUMENTS.filter((flag) => (
    String(commandLine).toLowerCase().includes(flag)
  ));
}

export function inspectChromeProcessRows(rows = [], profilePath = '', {
  workerPid = null,
} = {}) {
  const profile = path.resolve(profilePath).replaceAll('/', '\\').toLowerCase();
  const descendantPids = new Set();
  if (Number(workerPid)) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        const parentPid = Number(row?.ParentProcessId);
        const processId = Number(row?.ProcessId);
        if (
          processId
          && (parentPid === Number(workerPid) || descendantPids.has(parentPid))
          && !descendantPids.has(processId)
        ) {
          descendantPids.add(processId);
          changed = true;
        }
      }
    }
  }
  const matches = rows.filter((row) => {
    const commandLineMatch = String(row?.CommandLine || '')
      .replaceAll('/', '\\').toLowerCase().includes(profile);
    return commandLineMatch || descendantPids.has(Number(row?.ProcessId));
  });
  return Object.freeze(matches.map((row) => Object.freeze({
    chromePid: Number(row.ProcessId) || null,
    parentPid: Number(row.ParentProcessId) || null,
    executablePath: String(row.ExecutablePath || ''),
    commandLine: String(row.CommandLine || ''),
    matchReason: descendantPids.has(Number(row?.ProcessId))
      ? 'WORKER_PROCESS_TREE'
      : 'PROFILE_COMMAND_LINE',
    forbiddenArguments: Object.freeze(commandLineFlags(row.CommandLine)),
  })));
}

export function diagnoseWindowsChromeProcesses(profilePath, {
  workerPid = process.pid,
} = {}) {
  if (process.platform !== 'win32') {
    return Object.freeze({ status: 'NOT_SUPPORTED', processes: Object.freeze([]) });
  }
  const output = execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
  ], { encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim();
  const parsed = output ? JSON.parse(output) : [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const processes = inspectChromeProcessRows(rows, profilePath, { workerPid });
  return Object.freeze({
    status: processes.length ? 'OBSERVED' : 'NOT_FOUND',
    observedChromeProcessCount: rows.length,
    commandLineAvailableCount: rows.filter((row) => row?.CommandLine).length,
    forbiddenArgumentsDetected: processes.some((item) => item.forbiddenArguments.length),
    processes,
  });
}
