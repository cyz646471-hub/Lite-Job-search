import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createControlPlaneService } from '../src/application/control-plane-service.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

function parseArgs(argv) {
  const values = { createTask: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'create-task') {
      values.createTask = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing value for ${token}`);
    values[key] = next;
    index += 1;
  }
  return values;
}

function isoDate(value, fallback) {
  const date = String(value || fallback).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('dates must be YYYY-MM-DD');
  return date;
}

function atomicJson(file, value) {
  return writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const DOMESTIC_CHINA_REGIONS = new Set([
  'china',
  'cn',
  '中国',
  '中国大陆',
  'mainland china',
]);

export function isDomesticChinaCompany(company = {}) {
  return DOMESTIC_CHINA_REGIONS.has(
    String(company.countryRegion || company.country_region || '').trim().toLowerCase(),
  );
}

export function buildFullFlowQueue({ companies, portals, jobs }) {
  const portalsByCompany = new Map();
  const jobsByCompany = new Map();
  for (const portal of portals) {
    const entries = portalsByCompany.get(portal.companyId) || [];
    entries.push(portal);
    portalsByCompany.set(portal.companyId, entries);
  }
  for (const job of jobs) {
    const entries = jobsByCompany.get(job.companyId) || [];
    entries.push(job);
    jobsByCompany.set(job.companyId, entries);
  }

  return companies.flatMap((company) => {
    const companyPortals = portalsByCompany.get(company.id) || [];
    const companyJobs = jobsByCompany.get(company.id) || [];
    const verifiedPortals = companyPortals.filter((portal) => portal.verificationStatus === 'VERIFIED');
    const reasons = [];
    if (!verifiedPortals.length) reasons.push('OFFICIAL_PORTAL_NOT_VERIFIED');
    if (verifiedPortals.length && !companyJobs.length) {
      reasons.push('NO_FORMAL_JOB_OPENING_RECORDED');
    }
    if (!reasons.length) return [];
    return [{
      id: company.id,
      company: company.canonicalName,
      chineseName: company.chineseName,
      englishName: company.englishName,
      aliases: company.aliases,
      market: company.market,
      countryRegion: company.countryRegion,
      industry: company.industryTags,
      officialDomain: company.primaryOfficialDomain,
      officialDomains: company.officialDomains,
      maintenanceReasons: reasons,
      snapshot: {
        portalCount: companyPortals.length,
        verifiedPortalCount: verifiedPortals.length,
        formalJobCount: companyJobs.length,
        lastCheckedAt: companyPortals.map((portal) => portal.lastCheckedAt).filter(Boolean)
          .sort().at(-1) || null,
      },
    }];
  });
}

function createReadme({ queueCount, fromDate, toDate, outputDir, taskCreated }) {
  return `# 全库未完成企业检索准备包

本目录由 \`prepare:full-recheck\` 生成。队列中的企业满足以下至少一项：

- 没有 \`VERIFIED\` 官方招聘门户；
- 已有 \`VERIFIED\` 门户，但没有已存的正式岗位记录。

这不是“无岗位”结论。\`NO_FORMAL_JOB_OPENING_RECORDED\` 表示需要按当前
Direct HTTP → ATS → Playwright → 百度最后兜底流程重新核验，且保留无法访问、
验证码和无开放岗位等真实结果。

队列数：${queueCount}
时间范围：${fromDate} 至 ${toDate}
已创建任务：${taskCreated ? taskCreated.id : '否（先审阅 task-request.json）'}

## 开始执行

先启动本地控制面：

\`\`\`powershell
npm.cmd run web -- --database data/lite-job-search.sqlite --port 4317
\`\`\`

若尚未创建任务，使用控制面 API 提交 \`task-request.json\`（需确认头），或重新运行：

\`\`\`powershell
npm.cmd run prepare:full-recheck -- --database data/lite-job-search.sqlite \
  --output-dir ${outputDir} --from ${fromDate} --to ${toDate} --create-task
\`\`\`

拿到 task id 后，以 10 家短批次执行：

\`\`\`powershell
npm.cmd run task:run -- --task <task-id> --registry ${path.join(outputDir, 'full-flow-company-queue.json')} \
  --database data/lite-job-search.sqlite --output-dir ${path.join(outputDir, 'run')} \
  --profile-dir data/browser-profiles/career-op-main --max-companies-per-run 10
\`\`\`

百度出现安全验证时，保持人工验证边界；本地官网、已知 ATS 和缓存队列可继续，
百度项等待人工确认后由唯一 HALF_OPEN 探针恢复。
`;
}

export async function prepareFullDatabaseMaintenance({
  database,
  outputDir,
  from,
  to,
  limit = null,
  countryScope = 'all',
  createTask = false,
  now = () => new Date(),
} = {}) {
  if (!database || !outputDir) throw new Error('database and output-dir are required');
  const current = now();
  const toDate = isoDate(to, current.toISOString());
  const fromFallback = new Date(current);
  fromFallback.setUTCDate(fromFallback.getUTCDate() - 90);
  const fromDate = isoDate(from, fromFallback.toISOString());
  if (fromDate > toDate) throw new Error('from must not be after to');

  const repository = openSqliteMarketDiscoveryRepository({ file: path.resolve(database) });
  repository.migrate();
  try {
    const companies = repository.listCompanies();
    const portals = repository.listCareerPortals();
    const jobs = repository.listJobOpenings();
    const unfilteredQueue = buildFullFlowQueue({ companies, portals, jobs });
    const fullQueue = countryScope === 'domestic-china'
      ? unfilteredQueue.filter(isDomesticChinaCompany)
      : unfilteredQueue;
    if (!['all', 'domestic-china'].includes(countryScope)) {
      throw new Error('country-scope must be all or domestic-china');
    }
    const requestedLimit = limit == null ? fullQueue.length : Number(limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new Error('limit must be a positive integer');
    }
    const queue = fullQueue.slice(0, requestedLimit);
    const legacyRunningBatches = repository.listBatchRuns()
      .filter((batch) => batch.status === 'RUNNING')
      .map((batch) => ({
        id: batch.id,
        startedAt: batch.startedAt,
        runningItemCount: repository.listBatchItems(batch.id)
          .filter((item) => item.status === 'RUNNING').length,
        pendingItemCount: repository.listBatchItems(batch.id)
          .filter((item) => item.status === 'PENDING').length,
      }));
    const preflight = {
      generatedAt: current.toISOString(),
      database: path.resolve(database),
      scope: countryScope === 'domestic-china'
        ? 'DOMESTIC_CHINA_COMPANIES_WITHOUT_VERIFIED_PORTAL_OR_FORMAL_JOB_RECORD'
        : 'COMPANIES_WITHOUT_VERIFIED_PORTAL_OR_FORMAL_JOB_RECORD',
      totalCompanies: companies.length,
      countryScope,
      excludedByCountryScope: unfilteredQueue.length - fullQueue.length,
      availableQueueCompanies: fullQueue.length,
      queuedCompanies: queue.length,
      alreadyCompleteCompanies: companies.length - queue.length,
      queueReasons: Object.fromEntries([
        'OFFICIAL_PORTAL_NOT_VERIFIED',
        'NO_FORMAL_JOB_OPENING_RECORDED',
      ].map((reason) => [reason, queue.filter((company) => (
        company.maintenanceReasons.includes(reason)
      )).length])),
      timeRange: { from: fromDate, to: toDate },
      executionPolicy: {
        selectionMode: 'RECHECK_EXISTING_AND_NEW',
        targetUnit: 'COMPANIES_PROCESSED',
        allowBaiduFallback: true,
        maxCompaniesPerRun: 10,
        preserveEvidence: true,
        noCaptchaBypass: true,
      },
      legacyRunWarnings: legacyRunningBatches,
    };
    const taskRequest = {
      role_keywords: ['公开招聘岗位'],
      industry: '',
      location: countryScope === 'domestic-china' ? '中国大陆' : '',
      absolute_date_from: fromDate,
      absolute_date_to: toDate,
      target_count: queue.length,
      selection_mode: 'RECHECK_EXISTING_AND_NEW',
      target_unit: 'COMPANIES_PROCESSED',
      allow_baidu_fallback: true,
    };
    const service = createControlPlaneService({ repository, now: () => current.toISOString() });
    const task = createTask ? service.createTask(taskRequest) : null;
    await mkdir(outputDir, { recursive: true });
    await Promise.all([
      atomicJson(path.join(outputDir, 'full-flow-company-queue.json'), queue),
      atomicJson(path.join(outputDir, 'preflight.json'), { ...preflight, task }),
      atomicJson(path.join(outputDir, 'task-request.json'), taskRequest),
      writeFile(path.join(outputDir, 'README.md'), createReadme({
        queueCount: queue.length,
        fromDate,
        toDate,
        outputDir: path.resolve(outputDir),
        taskCreated: task,
      }), 'utf8'),
    ]);
    return { ...preflight, task, outputDir: path.resolve(outputDir) };
  } finally {
    repository.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  prepareFullDatabaseMaintenance({
    database: args.database,
    outputDir: args['output-dir'],
    from: args.from,
    to: args.to,
    limit: args.limit,
    countryScope: args['country-scope'] || 'all',
    createTask: args.createTask,
  }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ status: 'FAILED', error: String(error.message || error) })}\n`);
      process.exitCode = 2;
    });
}
