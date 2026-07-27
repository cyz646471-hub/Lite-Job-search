import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverCompanyLocally } from '../src/application/discover-company-locally.mjs';
import { ingestBrowserCompanyResult } from '../src/application/ingest-browser-company-result.mjs';
import { buildStudentApplicationRows } from '../src/application/build-student-application-rows.mjs';
import { planCompanyDiscovery } from '../src/application/local-first-discovery-planner.mjs';
import { runBrowserCompanyBatch } from '../src/application/run-browser-company-batch.mjs';
import { createAdaptiveSearchIntervalGate } from '../src/application/browser-search-circuit-breaker.mjs';
import { acquireProfileLock } from '../src/runtime/profile-lock-manager.mjs';
import { currentHostName, currentProcessStartToken } from '../src/runtime/process-identity.mjs';
import { createPageFetcher } from '../src/runtime/fetch-page.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';
import { createBrowserRuntime } from './chrome-extension-browser-adapter.mjs';
import { normalizePublicSearchEngine } from '../src/adapters/browser/public-search-page-adapter.mjs';
import {
  buildBrowserRunReport,
  buildDiscoveryReport,
  browserDiscoveryLimits,
  discoverCompanyWithBrowser,
  normalizeBrowserCompanyInput,
} from './company-browser-discovery.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values[key] = true;
    else { values[key] = next; index += 1; }
  }
  return values;
}

function bounded(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : fallback;
}

function inputHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertDedicatedProfile(profileDir) {
  const normalized = path.resolve(profileDir).replaceAll('/', '\\').toLowerCase();
  if (/(^|\\)google\\chrome\\user data(?:\\|$)/.test(normalized)) {
    throw new Error('profile-dir must be a dedicated automation profile, not the daily Chrome User Data profile');
  }
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

async function observeCandidateWithBrowser(browser, url, timeoutMs) {
  const page = await browser.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    return page.observeCareerPage({
      requestedUrl: url,
      response,
      renderWaitMs: 3_000,
    });
  } finally {
    await page.close();
  }
}

function usage() {
  return 'Usage: node scripts/run-persistent-browser-supervisor.mjs --input companies.json --output-dir output --database data/lite-job-search.sqlite [--profile-dir data/browser-profiles/career-op-main] [--search-engine baidu] [--batch-id id] [--target-count 100] [--max-companies-per-run 100]';
}

export async function runPersistentBrowserSupervisor({
  input,
  outputDir,
  database,
  profileDir = path.join('data', 'browser-profiles', 'career-op-main'),
  batchId = '',
  batchInputHash = '',
  targetCount = 100,
  role = '公开招聘岗位',
  industry = '',
  location = '',
  freshnessDays = 90,
  maxCompaniesPerRun = 100,
  maxResults = 10,
  maxCandidates = 3,
  maxCareerEntries = 5,
  maxDepth = 2,
  timeoutMs = 15_000,
  searchDelayMs = 10_000,
  searchJitterMs = 4_000,
  headless = false,
  retryFailed = false,
  xlsxOutput = '',
  writeArtifacts = true,
  searchEngine = 'baidu',
  instanceId = '',
  allowBaiduFallback = true,
  heartbeatIntervalMs = 15_000,
} = {}) {
  if (!input || !outputDir || !database) throw new Error(usage());
  const rawInput = JSON.parse(await readFile(input, 'utf8'));
  const companies = normalizeBrowserCompanyInput(rawInput).slice(0, bounded(targetCount, 100, 1, 10_000));
  if (!companies.length) throw new Error('input has no usable companies');
  const selectedSearchEngine = normalizePublicSearchEngine(searchEngine);
  if (selectedSearchEngine !== 'baidu') {
    throw new Error('production supervisor supports only baidu as the final search fallback');
  }
  const dedicatedProfile = path.resolve(profileDir);
  assertDedicatedProfile(dedicatedProfile);
  const id = batchId || `persistent-${inputHash(companies).slice(0, 16)}`;
  const workerId = instanceId || `worker-${randomUUID()}`;
  const processStartToken = currentProcessStartToken();
  const hostName = currentHostName();
  const repository = openSqliteMarketDiscoveryRepository({ file: path.resolve(database) });
  repository.migrate();
  let profileLock;
  try {
    profileLock = await acquireProfileLock({
      profilePath: dedicatedProfile,
      instanceId: workerId,
      batchId: id,
      processStartToken,
      hostName,
      onStaleArchive: async (event) => {
        repository.appendAuditLog({
          id: randomUUID(),
          action: 'PROFILE_STALE_LOCK_ARCHIVED',
          targetType: 'PROFILE',
          targetId: dedicatedProfile,
          actor: workerId,
          details: event,
          createdAt: new Date().toISOString(),
        });
      },
    });
  } catch (error) {
    repository.close();
    throw error;
  }
  repository.saveProfileLock(profileLock);
  repository.registerWorker({
    instanceId: workerId,
    batchId: id,
    profileKey: profileLock.profileKey,
    hostName,
    pid: process.pid,
    processStartToken,
    state: 'STARTING',
    startedAt: profileLock.startedAt,
    heartbeatAt: profileLock.heartbeatAt,
  });

  let browser;
  let heartbeatTimer;
  let exitCode = 0;
  let exitState = 'EXITED';
  let lastError = null;
  try {
    const ensureBrowser = async () => {
      if (browser) return browser;
      const { chromium } = await import('playwright');
      browser = await createBrowserRuntime({
        mode: 'persistent-chrome',
        chromium,
        profileDir: dedicatedProfile,
        headless: headless === true,
      });
      return browser;
    };
    repository.heartbeatWorker({
      instanceId: workerId,
      state: 'RUNNING',
      heartbeatAt: new Date().toISOString(),
    });
    heartbeatTimer = setInterval(() => {
      const heartbeatAt = new Date().toISOString();
      try {
        repository.heartbeatWorker({
          instanceId: workerId,
          state: repository.getWorkerInstance(workerId)?.state || 'RUNNING',
          heartbeatAt,
        });
        profileLock.heartbeat(heartbeatAt).catch(() => {});
      } catch {
        // The foreground worker reports repository failures through its normal path.
      }
    }, bounded(heartbeatIntervalMs, 15_000, 1_000, 60_000));
    heartbeatTimer.unref?.();

    const limits = browserDiscoveryLimits({
      'max-results': maxResults, 'max-candidates': maxCandidates,
      'max-career-entries': maxCareerEntries, 'max-depth': maxDepth,
      'timeout-ms': timeoutMs, 'search-delay-ms': searchDelayMs,
      'search-jitter-ms': searchJitterMs, 'max-companies-per-run': maxCompaniesPerRun,
    });
    const gate = createAdaptiveSearchIntervalGate({
      minimumIntervalMs: limits.searchDelayMs,
      jitterMs: limits.searchJitterMs,
    });
    const storedCompanies = repository.listCompanies();
    const normalizedName = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();
    const absoluteDateTo = new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - (Number(freshnessDays) || 90));
    const absoluteDateFrom = fromDate.toISOString().slice(0, 10);
    const plannedCompanies = companies.map((company) => {
      const stored = storedCompanies.find((candidate) => (
        [
          candidate.canonicalName,
          candidate.chineseName,
          candidate.englishName,
          ...(candidate.aliases || []),
        ].some((name) => normalizedName(name) === normalizedName(company.company))
      ));
      const planningCompany = stored || {
        id: company.id || `company-plan-${inputHash([company]).slice(0, 24)}`,
        canonicalName: company.company,
        chineseName: company.chineseName,
        englishName: company.englishName,
        aliases: company.aliases || [],
        officialDomains: company.officialDomain ? [company.officialDomain] : [],
        primaryOfficialDomain: company.officialDomain || null,
      };
      const discoveryPlan = planCompanyDiscovery({
        company: planningCompany,
        roleKeywords: [role],
        locale: company.market === 'NA' ? 'en-US' : 'zh-CN',
        absoluteDateFrom,
        absoluteDateTo,
        allowBaiduFallback: allowBaiduFallback === true,
        confirmedPortalsOnly: company.fixedPool === true,
      }, { repository });
      return {
        ...company,
        id: company.id || planningCompany.id,
        queueType: discoveryPlan.queueType,
        discoveryPlan,
      };
    });
    const directFetcher = createPageFetcher({ timeoutMs: limits.timeoutMs });
    const batch = await runBrowserCompanyBatch({
      batchId: id,
      batchInputHash: batchInputHash || id,
      companies: plannedCompanies,
      retryFailed: retryFailed === true,
      maxCompaniesPerRun: limits.maxCompaniesPerRun,
      runOptions: { role, industry, location, freshnessDays: Number(freshnessDays) || 90, targetCount: plannedCompanies.length },
      provider: selectedSearchEngine,
    }, {
      repository,
      discoverCompany: async (company) => {
        repository.heartbeatWorker({
          instanceId: workerId,
          state: 'RUNNING',
          heartbeatAt: new Date().toISOString(),
          currentCompanyId: company.id,
        });
        const discovered = company.queueType === 'LOCAL_OR_DIRECT_VERIFICATION'
          ? await discoverCompanyLocally({
              company,
              plan: company.discoveryPlan,
              fetchPage: directFetcher,
              observeWithBrowser: async (url) => observeCandidateWithBrowser(
                await ensureBrowser(),
                url,
                limits.timeoutMs,
              ),
            })
          : await discoverCompanyWithBrowser({
              company: company.company,
              chineseName: company.chineseName,
              englishName: company.englishName,
              officialDomain: company.officialDomain,
              market: company.market || 'CN',
              browser: await ensureBrowser(),
              searchEngine: selectedSearchEngine,
              beforeSearchQuery: gate,
              ...limits,
            });
        if (company.queueType === 'BAIDU_DISCOVERY_REQUIRED') {
          const candidates = (discovered.officialCandidates || []).map((item) => item.url);
          const outcome = discovered.status === 'BLOCKED'
            ? 'CHALLENGE'
            : discovered.status === 'FAILED'
              ? 'TRANSIENT_ERROR'
              : candidates.length
                ? 'SUCCESS'
                : null;
          if (outcome) {
            const createdAt = new Date().toISOString();
            const expiresAt = outcome === 'SUCCESS'
              ? new Date(Date.parse(createdAt) + 7 * 24 * 60 * 60 * 1000).toISOString()
              : null;
            repository.putSearchCache({
              cacheKey: company.discoveryPlan.cacheKey,
              engine: 'baidu',
              normalizedQuery: company.discoveryPlan.query.toLowerCase(),
              locale: company.market === 'NA' ? 'en-US' : 'zh-CN',
              absoluteDateFrom,
              absoluteDateTo,
              strategyVersion: 'local-first-v1',
              outcome,
              result: {
                candidates,
                finalStatus: discovered.status,
                reasonCode: discovered.reasonCode || null,
              },
              createdAt,
              expiresAt,
            });
          }
        }
        repository.heartbeatWorker({
          instanceId: workerId,
          state: 'RUNNING',
          heartbeatAt: new Date().toISOString(),
          currentCompanyId: null,
          lastCompletedCompanyId: company.id,
        });
        return {
          ...company,
          ...discovered,
          discoveryProvider: company.queueType === 'BAIDU_DISCOVERY_REQUIRED'
            ? 'chrome_baidu_visible_search'
            : discovered.discoveryProvider || 'local_direct_verification',
          liveSearchExecuted: company.queueType === 'BAIDU_DISCOVERY_REQUIRED',
        };
      },
      ingestCompany: async (options) => {
        const result = await ingestBrowserCompanyResult({
          ...options,
          industry: options.industry || options.companyResult.industry || [],
        }, { repository });
        const stored = repository.listCompanies().find((candidate) => (
          normalizedName(candidate.canonicalName)
          === normalizedName(options.companyResult.company)
        ));
        if (stored) {
          const observedAt = new Date().toISOString();
          for (const domain of stored.officialDomains || []) {
            repository.upsertCompanyWebKnowledge({
              id: `knowledge-${inputHash([stored.id, 'OFFICIAL_DOMAIN', domain]).slice(0, 24)}`,
              companyId: stored.id,
              knowledgeType: 'OFFICIAL_DOMAIN',
              value: domain,
              verificationStatus: 'VERIFIED',
              evidenceSource: 'company_registry_and_verification_pipeline',
              firstSeenAt: observedAt,
              lastVerifiedAt: observedAt,
            });
          }
          for (const portal of repository.listCareerPortals().filter((item) => (
            item.companyId === stored.id && item.verificationStatus === 'VERIFIED'
          ))) {
            repository.upsertCompanyWebKnowledge({
              id: `knowledge-${inputHash([stored.id, 'CAREER_PORTAL', portal.canonicalUrl]).slice(0, 24)}`,
              companyId: stored.id,
              knowledgeType: 'CAREER_PORTAL',
              value: portal.canonicalUrl,
              verificationStatus: 'VERIFIED',
              evidenceSource: 'deterministic_verification_engine',
              firstSeenAt: observedAt,
              lastVerifiedAt: observedAt,
            });
          }
          for (const rejected of options.companyResult.rejected || []) {
            if (!rejected.url) continue;
            repository.upsertCompanyWebKnowledge({
              id: `knowledge-${inputHash([stored.id, 'REJECTED_PORTAL', rejected.url]).slice(0, 24)}`,
              companyId: stored.id,
              knowledgeType: 'REJECTED_PORTAL',
              value: rejected.url,
              verificationStatus: 'REJECTED',
              evidenceSource: rejected.reasonCode || 'source_policy',
              firstSeenAt: observedAt,
              lastVerifiedAt: observedAt,
              rejectionReason: rejected.reasonCode || 'invalid_recruitment_source',
            });
          }
        }
        return result;
      },
    });
    const companyResults = batch.companyResults;
    const report = buildBrowserRunReport({ batch, companyResults, discoveryRuns: batch.discoveryRuns });
    const studentRows = buildStudentApplicationRows({
      companies: repository.listCompanies(),
      portals: repository.listCareerPortals(),
      events: repository.listRecruitmentEvents(),
      jobs: repository.listJobOpenings(),
    });
    if (writeArtifacts) {
      await mkdir(outputDir, { recursive: true });
      await Promise.all([
        atomicJson(path.join(outputDir, 'run-report.json'), report),
        atomicJson(path.join(outputDir, 'report.json'), buildDiscoveryReport(companyResults)),
        atomicJson(path.join(outputDir, 'candidates.json'), companyResults.flatMap((item) => item.officialCandidates || [])),
        atomicJson(path.join(outputDir, 'leads.json'), companyResults.flatMap((item) => item.leads || [])),
        atomicJson(path.join(outputDir, 'student-application-rows.json'), studentRows),
        atomicJson(path.join(outputDir, 'supervisor.json'), {
          mode: 'PERSISTENT_CHROME_SUPERVISOR', batchId: id, profileDir: dedicatedProfile,
          instanceId: workerId, inputHash: inputHash(companies),
          completedAt: new Date().toISOString(), batch: report.batch,
          providerCircuit: report.providerCircuit,
          environment: {
            sandbox_requested: Boolean(browser),
            sandbox_request_status: browser ? 'REQUESTED' : 'NOT_REQUESTED',
            sandbox_verified: 'NOT_OS_VERIFIED',
            profile_persistent: true,
            profile_lock_acquired: true,
            automation_mode: browser ? 'playwright_persistent_context' : 'direct_http_only',
            browser_channel: browser ? 'chrome' : null,
          },
        }),
      ]);
    }
    let writtenXlsx = null;
    if (writeArtifacts && xlsxOutput) {
      const { buildStudentApplicationWorkbook } = await import('./build-browser-batch-xlsx.mjs');
      writtenXlsx = path.resolve(xlsxOutput);
      await buildStudentApplicationWorkbook({ rows: studentRows, outputFile: writtenXlsx });
    }
    return { status: report.status, batchId: id, instanceId: workerId, profileDir: dedicatedProfile, xlsxOutput: writtenXlsx, report };
  } catch (error) {
    exitCode = 2;
    exitState = 'CRASHED';
    lastError = String(error?.message || error).slice(0, 500);
    throw error;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await browser?.close();
    try {
      repository.exitWorker({
        instanceId: workerId,
        state: exitState,
        exitedAt: new Date().toISOString(),
        exitCode,
        lastError,
      });
      repository.releaseProfileLock({
        profileKey: profileLock.profileKey,
        lockId: profileLock.lockId,
      });
    } finally {
      await profileLock.release();
      repository.close();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input || !args['output-dir'] || !args.database) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = args.help ? 0 : 2;
  } else {
    runPersistentBrowserSupervisor({
      input: args.input, outputDir: args['output-dir'], database: args.database,
      profileDir: args['profile-dir'], batchId: args['batch-id'], targetCount: args['target-count'],
      role: args.role, industry: args.industry, location: args.location,
      freshnessDays: args['freshness-days'], maxCompaniesPerRun: args['max-companies-per-run'],
      maxResults: args['max-results'], maxCandidates: args['max-candidates'],
      maxCareerEntries: args['max-career-entries'], maxDepth: args['max-depth'],
      timeoutMs: args['timeout-ms'], searchDelayMs: args['search-delay-ms'],
      searchJitterMs: args['search-jitter-ms'], headless: args.headless === true,
      retryFailed: args['retry-failed'] === true, xlsxOutput: args['xlsx-output'],
      searchEngine: args['search-engine'],
      instanceId: args['instance-id'],
      allowBaiduFallback: args['no-baidu-fallback'] === true
        ? false
        : args['allow-baidu-fallback'] === true || undefined,
      heartbeatIntervalMs: args['heartbeat-interval-ms'],
    }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => { process.stderr.write(`${JSON.stringify({ status: 'FAILED', reasonCode: 'persistent_supervisor_failed', error: String(error.message || error) })}\n`); process.exitCode = 2; });
  }
}
