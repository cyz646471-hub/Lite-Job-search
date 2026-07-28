import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const CURRENT_PROCESS_START_TOKEN = `${process.pid}:${Math.trunc(performance.timeOrigin)}`;

function powershellJson(command, {
  execute = execFileSync,
  timeoutMs = 10_000,
} = {}) {
  try {
    const output = execute('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command,
    ], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
    }).trim();
    return { value: output ? JSON.parse(output) : null, errorCode: null };
  } catch (error) {
    return {
      value: null,
      errorCode: error?.code === 'ETIMEDOUT'
        ? 'PROCESS_INSPECTION_TIMEOUT'
        : 'PROCESS_INSPECTION_FAILED',
    };
  }
}

function processExists(pid, kill = process.kill) {
  try {
    kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export function currentHostName() {
  return os.hostname();
}

export function currentProcessStartToken(pid = process.pid, dependencies = {}) {
  if (Number(pid) === process.pid) return CURRENT_PROCESS_START_TOKEN;
  if (process.platform === 'win32') {
    const result = powershellJson(
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" `
      + '| Select-Object ProcessId,CreationDate | ConvertTo-Json -Compress',
      dependencies,
    );
    const row = result.value;
    if (row?.CreationDate) return String(row.CreationDate);
  }
  return '';
}

export function inspectProfileOwner({
  pid,
  profilePath,
} = {}, dependencies = {}) {
  const numericPid = Number(pid);
  const resolvedProfile = path.resolve(profilePath || '').replaceAll('/', '\\').toLowerCase();
  if (process.platform === 'win32') {
    const processResult = powershellJson(
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${numericPid}" `
      + '| Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine '
      + '| ConvertTo-Json -Compress',
      dependencies,
    );
    const chromeResult = powershellJson(
      'Get-CimInstance Win32_Process -Filter "Name = \'chrome.exe\'" '
      + '| Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
      dependencies,
    );
    const processRow = processResult.value;
    const chromeRowsRaw = chromeResult.value;
    const chromeRows = chromeRowsRaw
      ? (Array.isArray(chromeRowsRaw) ? chromeRowsRaw : [chromeRowsRaw])
      : [];
    const inspectionError = processResult.errorCode || chromeResult.errorCode;
    return {
      processExists: Boolean(processRow?.ProcessId)
        || processExists(numericPid, dependencies.killProcess),
      processStartToken: String(processRow?.CreationDate || ''),
      chromeUsingProfile: chromeResult.errorCode
        ? null
        : chromeRows.some((row) => (
            String(row?.CommandLine || '').replaceAll('/', '\\').toLowerCase()
              .includes(resolvedProfile)
          )),
      process: processRow || null,
      inspectionComplete: !inspectionError,
      inspectionError,
    };
  }
  return {
    processExists: processExists(numericPid, dependencies.killProcess),
    processStartToken: '',
    chromeUsingProfile: false,
    process: null,
    inspectionComplete: true,
    inspectionError: null,
  };
}
