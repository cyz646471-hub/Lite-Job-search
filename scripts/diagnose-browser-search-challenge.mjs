import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizePublicSearchEngine, publicSearchUrl, isPublicSearchBlockedSnapshot } from '../src/adapters/browser/public-search-page-adapter.mjs';
import { assertSafeChromeArgs } from '../src/runtime/chrome-launch-policy.mjs';
import { diagnoseWindowsChromeProcesses } from '../src/runtime/chrome-process-diagnostics.mjs';
import { acquireProfileLock } from '../src/runtime/profile-lock-manager.mjs';
import { currentProcessStartToken } from '../src/runtime/process-identity.mjs';

function hash(value) { return createHash('sha256').update(String(value || '')).digest('hex'); }
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

export async function diagnoseBrowserSearchChallenge({
  engine = 'baidu', query = '招聘', variant = 'B',
  outputDir = 'test-output/browser-diagnostics', profileDir = '',
  diagnosticUrl = '',
} = {}) {
  const selectedEngine = normalizePublicSearchEngine(engine);
  const selectedVariant = String(variant).toUpperCase();
  if (!['A', 'B', 'C'].includes(selectedVariant)) throw new Error('variant must be A, B, or C');
  if (selectedVariant === 'A') {
    const report = { variant: 'A', automation_mode: 'manual_normal_chrome', total_queries: 0, status: 'MANUAL_OBSERVATION_REQUIRED', startedAt: new Date().toISOString() };
    await writeJson(path.join(outputDir, 'diagnostic.json'), report);
    return report;
  }
  if (!profileDir) throw new Error('profileDir is required for Playwright diagnostics');
  const { chromium } = await import('playwright');
  const startedAt = new Date().toISOString();
  const resolvedProfile = path.resolve(profileDir);
  const profileLock = await acquireProfileLock({
    profilePath: resolvedProfile,
    instanceId: `browser-diagnostic-${process.pid}`,
    batchId: 'browser-sandbox-diagnostic',
    processStartToken: currentProcessStartToken(),
  });
  let context;
  try {
    context = await chromium.launchPersistentContext(resolvedProfile, {
      channel: 'chrome',
      headless: false,
      chromiumSandbox: selectedVariant === 'B',
      viewport: null,
      args: assertSafeChromeArgs([]),
    });
    const page = await context.newPage();
    const searchRequest = !diagnosticUrl;
    const targetUrl = diagnosticUrl || publicSearchUrl(selectedEngine, query);
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const body = await page.locator('body').innerText().catch(() => '');
    const url = await page.url();
    const challenge = searchRequest && isPublicSearchBlockedSnapshot({ engine: selectedEngine, text: body, status: response?.status?.() || 0, url });
    const runtime = await page.evaluate(() => ({ userAgent: navigator.userAgent, navigatorWebdriver: navigator.webdriver, languages: navigator.languages, platform: navigator.platform, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, screenWidth: screen.width, screenHeight: screen.height, devicePixelRatio: devicePixelRatio }));
    const chromeProcesses = diagnoseWindowsChromeProcesses(resolvedProfile, {
      workerPid: process.pid,
    });
    const report = { variant: selectedVariant, browserChannel: 'chrome', headless: false, persistentProfile: true, profilePath: resolvedProfile, profilePathHash: hash(resolvedProfile), chromiumSandboxRequested: selectedVariant === 'B', sandbox_requested: selectedVariant === 'B', sandbox_request_status: selectedVariant === 'B' ? 'REQUESTED' : 'NOT_REQUESTED', sandbox_verified: 'NOT_OS_VERIFIED', profile_persistent: true, profile_lock_acquired: true, profileLockId: profileLock.lockId, automation_mode: 'playwright_persistent_context', browser_channel: 'chrome', workerId: `diagnostic-${process.pid}`, workerPid: process.pid, startedAt, total_queries: searchRequest ? 1 : 0, successful_queries: searchRequest && !challenge ? 1 : 0, diagnostic_navigations: searchRequest ? 0 : 1, security_challenges: challenge ? 1 : 0, captcha_count: challenge ? 1 : 0, rate_limit_count: response?.status?.() === 429 ? 1 : 0, challenge_rate: searchRequest && challenge ? 1 : 0, finalUrl: url, pageTitle: await page.title(), chromeProcesses, ...runtime };
    if (challenge) await page.screenshot({ path: path.join(outputDir, 'challenge.png') }).catch(() => {});
    await writeJson(path.join(outputDir, 'diagnostic.json'), report);
    return report;
  } finally {
    await context?.close();
    await profileLock.release();
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  diagnoseBrowserSearchChallenge({
    engine: args.engine || 'baidu',
    query: args.query || '招聘',
    variant: args.variant || 'B',
    outputDir: args['output-dir'] || 'test-output/browser-diagnostics',
    profileDir: args['profile-dir'] || '',
    diagnosticUrl: args.url || '',
  }).then((report) => {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 2;
  });
}
