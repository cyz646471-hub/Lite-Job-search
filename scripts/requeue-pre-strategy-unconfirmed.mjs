import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';

import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const CONFIRMED_RECRUITMENT_PAGE_TYPES = new Set([
  'CAREER_HOME',
  'CAMPAIGN',
  'JOB_LIST',
  'JOB_DETAIL',
  'APPLY',
]);

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

function normalized(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function companyIdentityValues(company = {}) {
  return [
    company.id,
    company.canonicalName,
    company.chineseName,
    company.englishName,
    ...(company.aliases || []),
    ...(company.officialDomains || []),
  ].map(normalized).filter(Boolean);
}

function itemIdentityValues(item = {}) {
  return [
    item.input?.companyId,
    item.input?.company,
    item.input?.canonicalName,
    item.input?.chineseName,
    item.input?.englishName,
    item.input?.officialDomain,
    ...(item.input?.officialDomains || []),
  ].map(normalized).filter(Boolean);
}

export function buildPreStrategyRecheckPlan({
  items = [],
  companies = [],
  portals = [],
  effectiveAt,
} = {}) {
  const effectiveTime = Date.parse(effectiveAt || '');
  if (!Number.isFinite(effectiveTime)) throw new Error('effectiveAt must be a valid timestamp');

  const companyByIdentity = new Map();
  for (const company of companies) {
    for (const identity of companyIdentityValues(company)) {
      if (!companyByIdentity.has(identity)) companyByIdentity.set(identity, company);
    }
  }
  const confirmedCompanyIds = new Set(portals.filter((portal) => (
    portal.verificationStatus === 'VERIFIED'
    && portal.officialIdentityConfirmed === true
    && CONFIRMED_RECRUITMENT_PAGE_TYPES.has(portal.pageType)
  )).map((portal) => portal.companyId));

  const rows = items.map((item) => {
    const company = itemIdentityValues(item)
      .map((identity) => companyByIdentity.get(identity))
      .find(Boolean) || null;
    const completedTime = Date.parse(item.completedAt || '');
    const startedTime = Date.parse(item.startedAt || '');
    const completedBeforeStrategy = Number.isFinite(completedTime)
      && completedTime < effectiveTime;
    const orphanedPreStrategyRun = item.status === 'RUNNING'
      && !Number.isFinite(completedTime)
      && Number.isFinite(startedTime)
      && startedTime < effectiveTime;
    const confirmedRecruitmentPortal = Boolean(
      company && confirmedCompanyIds.has(company.id),
    );
    return Object.freeze({
      item,
      company,
      completedBeforeStrategy,
      orphanedPreStrategyRun,
      confirmedRecruitmentPortal,
      shouldRequeue: (
        completedBeforeStrategy || orphanedPreStrategyRun
      ) && !confirmedRecruitmentPortal,
    });
  });

  return Object.freeze({
    effectiveAt: new Date(effectiveTime).toISOString(),
    rows: Object.freeze(rows),
    selected: Object.freeze(rows.filter((row) => row.shouldRequeue)),
    confirmedOrphans: Object.freeze(rows.filter((row) => (
      row.orphanedPreStrategyRun && row.confirmedRecruitmentPortal
    ))),
  });
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseFile = path.resolve(args.database || 'data/lite-job-search.sqlite');
  const batchId = String(args['batch-id'] || '').trim();
  const effectiveAt = String(args['effective-at'] || '').trim();
  const apply = args.apply === true;
  const outputFile = path.resolve(
    args.output || 'test-output/pre-strategy-recheck/requeue-report.json',
  );
  if (!batchId) throw new Error('--batch-id is required');
  if (!effectiveAt) throw new Error('--effective-at is required');

  const repository = openSqliteMarketDiscoveryRepository({ file: databaseFile });
  repository.migrate();
  const batch = repository.getBatchRun(batchId);
  const latestWorker = repository.listWorkerInstances()
    .filter((worker) => worker.batchId === batchId)
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0]
    || null;
  const plan = buildPreStrategyRecheckPlan({
    items: repository.listBatchItems(batchId),
    companies: repository.listCompanies(),
    portals: repository.listCareerPortals(),
    effectiveAt,
  });
  repository.close();

  if (!batch) throw new Error(`unknown batch: ${batchId}`);
  if (apply && !['STOPPED', 'PAUSED'].includes(batch.status)) {
    throw new Error(`batch must be STOPPED or PAUSED before apply; received ${batch.status}`);
  }
  if (apply && latestWorker && !['EXITED', 'CRASHED'].includes(latestWorker.state)) {
    throw new Error(`latest worker must be terminal before apply; received ${latestWorker.state}`);
  }

  const statusCounts = Object.fromEntries([...plan.selected.reduce((counts, row) => {
    counts.set(row.item.status, (counts.get(row.item.status) || 0) + 1);
    return counts;
  }, new Map())]);
  const report = {
    status: apply ? 'APPLIED' : 'DRY_RUN',
    generatedAt: new Date().toISOString(),
    database: databaseFile,
    batchId,
    effectiveAt: plan.effectiveAt,
    policy: {
      requeue: 'completed before effectiveAt without a verified identity-confirmed recruitment portal',
      preserve: 'verified recruitment portal, post-strategy result, or never-processed pending item',
      recruitmentPageTypes: [...CONFIRMED_RECRUITMENT_PAGE_TYPES],
    },
    totals: {
      batchItems: plan.rows.length,
      completedBeforeStrategy: plan.rows.filter(
        (row) => row.completedBeforeStrategy,
      ).length,
      orphanedPreStrategyRuns: plan.rows.filter(
        (row) => row.orphanedPreStrategyRun,
      ).length,
      confirmedBeforeStrategy: plan.rows.filter(
        (row) => row.completedBeforeStrategy && row.confirmedRecruitmentPortal,
      ).length,
      requeued: plan.selected.length,
      settledConfirmedOrphans: plan.confirmedOrphans.length,
      preservedPostStrategy: plan.rows.filter((row) => (
        row.item.completedAt && !row.completedBeforeStrategy
      )).length,
      pendingNeverProcessed: plan.rows.filter((row) => (
        row.item.status === 'PENDING' && !row.item.completedAt
      )).length,
    },
    requeuedByPreviousStatus: statusCounts,
    items: plan.selected.map((row) => ({
      itemKey: row.item.itemKey,
      company: row.item.input?.company || row.company?.canonicalName || row.item.itemKey,
      previousStatus: row.item.status,
      previousResultStatus: row.item.resultStatus,
      previousCompletedAt: row.item.completedAt,
    })),
    settledItems: plan.confirmedOrphans.map((row) => ({
      itemKey: row.item.itemKey,
      company: row.item.input?.company || row.company?.canonicalName || row.item.itemKey,
      previousStatus: row.item.status,
      verifiedCompanyId: row.company?.id || null,
    })),
  };

  if (apply && (plan.selected.length || plan.confirmedOrphans.length)) {
    const database = new Database(databaseFile);
    try {
      const reset = database.prepare(`
        UPDATE batch_items
        SET status = 'PENDING',
            result_status = NULL,
            discovery_run_id = NULL,
            error_message = NULL,
            retry_class = NULL,
            deferred_until = NULL,
            defer_reason = NULL,
            started_at = NULL,
            completed_at = NULL
        WHERE batch_id = ? AND item_key = ?
      `);
      const settleConfirmed = database.prepare(`
        UPDATE batch_items
        SET status = 'SUCCEEDED',
            result_status = COALESCE(result_status, 'PARTIAL'),
            error_message = NULL,
            retry_class = NULL,
            deferred_until = NULL,
            defer_reason = NULL,
            completed_at = ?
        WHERE batch_id = ? AND item_key = ? AND status = 'RUNNING'
      `);
      database.transaction(() => {
        for (const row of plan.selected) {
          const result = reset.run(batchId, row.item.itemKey);
          if (result.changes !== 1) {
            throw new Error(`failed to requeue batch item: ${row.item.itemKey}`);
          }
        }
        for (const row of plan.confirmedOrphans) {
          const result = settleConfirmed.run(report.generatedAt, batchId, row.item.itemKey);
          if (result.changes !== 1) {
            throw new Error(`failed to settle confirmed batch item: ${row.item.itemKey}`);
          }
        }
      })();
    } finally {
      database.close();
    }
    const auditRepository = openSqliteMarketDiscoveryRepository({ file: databaseFile });
    auditRepository.migrate();
    auditRepository.appendAuditLog({
      id: randomUUID(),
      action: 'REQUEUE_PRE_STRATEGY_UNCONFIRMED',
      targetType: 'BATCH',
      targetId: batchId,
      actor: 'codex-maintenance',
      details: {
        effectiveAt: plan.effectiveAt,
        requeued: plan.selected.length,
        settledConfirmedOrphans: plan.confirmedOrphans.length,
        report: outputFile,
      },
      createdAt: report.generatedAt,
    });
    auditRepository.close();
  }

  await writeJsonAtomic(outputFile, report);
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    batchId,
    effectiveAt: plan.effectiveAt,
    requeued: plan.selected.length,
    settledConfirmedOrphans: plan.confirmedOrphans.length,
    outputFile,
  }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
