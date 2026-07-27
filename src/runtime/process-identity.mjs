import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function powershellJson(command) {
  const output = execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    command,
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  }).trim();
  return output ? JSON.parse(output) : null;
}

export function currentHostName() {
  return os.hostname();
}

export function currentProcessStartToken(pid = process.pid) {
  if (process.platform === 'win32') {
    const row = powershellJson(
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" `
      + '| Select-Object ProcessId,CreationDate | ConvertTo-Json -Compress',
    );
    if (row?.CreationDate) return String(row.CreationDate);
  }
  if (Number(pid) === process.pid) {
    return `${process.pid}:${Math.trunc(Date.now() - process.uptime() * 1000)}`;
  }
  return '';
}

export function inspectProfileOwner({
  pid,
  profilePath,
} = {}) {
  const numericPid = Number(pid);
  const resolvedProfile = path.resolve(profilePath || '').replaceAll('/', '\\').toLowerCase();
  if (process.platform === 'win32') {
    const processRow = powershellJson(
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${numericPid}" `
      + '| Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine '
      + '| ConvertTo-Json -Compress',
    );
    const chromeRowsRaw = powershellJson(
      'Get-CimInstance Win32_Process -Filter "Name = \'chrome.exe\'" '
      + '| Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
    );
    const chromeRows = chromeRowsRaw
      ? (Array.isArray(chromeRowsRaw) ? chromeRowsRaw : [chromeRowsRaw])
      : [];
    return {
      processExists: Boolean(processRow?.ProcessId),
      processStartToken: String(processRow?.CreationDate || ''),
      chromeUsingProfile: chromeRows.some((row) => (
        String(row?.CommandLine || '').replaceAll('/', '\\').toLowerCase()
          .includes(resolvedProfile)
      )),
      process: processRow || null,
    };
  }
  let processExists = false;
  try {
    process.kill(numericPid, 0);
    processExists = true;
  } catch {
    processExists = false;
  }
  return {
    processExists,
    processStartToken: '',
    chromeUsingProfile: false,
    process: null,
  };
}
