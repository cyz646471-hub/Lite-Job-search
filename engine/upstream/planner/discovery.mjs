import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function buildScanArgs({ sinceDays = 90, limit = 100, ats = 'greenhouse,lever,ashby,workday', seeds = '', concurrency = 4, shardIndex = 0, shardCount = 1, includeUndated = false } = {}) {
  const safeSince = Math.max(1, Math.min(180, Number(sinceDays) || 90));
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 100));
  const safeConcurrency = Math.max(1, Math.min(10, Number(concurrency) || 4));
  const safeShardCount = Math.max(1, Math.min(100, Number(shardCount) || 1));
  const safeShardIndex = Math.max(0, Math.min(safeShardCount - 1, Number(shardIndex) || 0));
  const allowed = new Set(['greenhouse', 'lever', 'ashby', 'workday']);
  const safeAts = String(ats).split(',').map((value) => value.trim().toLowerCase()).filter((value) => allowed.has(value));
  const allowedSeeds = new Set(['yc', 'a16z']);
  const safeSeeds = String(seeds).split(',').map((value) => value.trim().toLowerCase()).filter((value) => allowedSeeds.has(value));
  if (!safeAts.length && !safeSeeds.length) throw new Error('No supported reverse-scan ATS or seed source selected');
  const args = ['scan-ats-full.mjs', '--json', '--dry-run', '--ignore-history', '--since', String(safeSince), '--limit', String(safeLimit), '--concurrency', String(safeConcurrency), '--shard-index', String(safeShardIndex), '--shard-count', String(safeShardCount)];
  if (includeUndated) args.push('--include-undated');
  if (safeAts.length) args.push('--ats', safeAts.join(','));
  if (safeSeeds.length) args.push('--seeds', safeSeeds.join(','));
  return args;
}

export function parseScannerJson(stdout = '') {
  const lines = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try { return { result: JSON.parse(lines[index]), stdoutDiagnostics: lines.slice(0, index).join('\n') }; } catch {}
  }
  throw new Error(`ATS scanner returned invalid JSON: ${String(stdout).slice(0, 300)}`);
}

export async function runAtsDiscovery({ rootDir, configPath, sinceDays, limit, ats, seeds, concurrency, shardIndex, shardCount, includeUndated }) {
  const args = buildScanArgs({ sinceDays, limit, ats, seeds, concurrency, shardIndex, shardCount, includeUndated });
  const { stdout, stderr } = await execFileAsync(process.execPath, args, {
    cwd: rootDir,
    env: { ...process.env, CAREER_OPS_PORTALS: configPath, DOTENV_CONFIG_QUIET: 'true' },
    timeout: 30 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  const { result, stdoutDiagnostics } = parseScannerJson(stdout);
  return { ...result, diagnostics: [stdoutDiagnostics, stderr.trim()].filter(Boolean).join('\n') };
}
