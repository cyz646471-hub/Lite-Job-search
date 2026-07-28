import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { detectAtsFingerprint } from '../engine/upstream/planner/cn-ats-fingerprint.mjs';
import { createOfficialVerificationAdapter } from '../src/adapters/upstream/official-verification-adapter.mjs';
import { buildCurrentTaskCompanySnapshot } from '../src/application/generate-control-plane-exports.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';
import { resolveAtsTenantOwnership } from '../src/verification/ats-tenant-ownership.mjs';
import { applyVerificationPolicy } from '../src/verification/verification-policy.mjs';

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

function urlRole(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    if (/^404\./.test(host) || /\/(?:404|not-found)(?:\.html?)?(?:\/|$)/.test(pathname)) {
      return 'ERROR_PAGE';
    }
    if (/^callback\./.test(host) || /\/(?:antibot|captcha|verifycode)(?:\/|$)/.test(pathname)) {
      return 'ACCESS_CHALLENGE';
    }
    if (host.endsWith('36kr.com') && /^\/(?:p|topics)\//.test(pathname)) {
      return 'CONTENT_ARTICLE';
    }
    if (detectAtsFingerprint({ url: value })?.ats && (!pathname || pathname === '/')) {
      return 'CAREER_HOME';
    }
    if (/\/(?:job|position)s?\/[^/]+/.test(pathname)) return 'JOB_DETAIL';
    if (/\/(?:job|position)s?(?:\/|$)/.test(pathname)) return 'JOB_LIST';
    if (/\/(?:campus-recruitment|campus_apply|social-recruitment|campus)(?:\/|$)/.test(pathname)) {
      return 'CAMPAIGN';
    }
    if (
      /^(?:career|careers|job|jobs|hr|recruit|campus)\./.test(host)
      || /\/(?:career|careers|join-us|recruit|recruitment|hr)(?:\/|$)/.test(pathname)
      || /\/apply\/[^/]+/.test(pathname)
    ) return 'CAREER_HOME';
    if (!pathname || pathname === '/') return 'CORPORATE_HOME';
    return 'UNKNOWN';
  } catch {
    return 'INVALID_URL';
  }
}

function categoryFor({ portal, company, role }) {
  if (['ERROR_PAGE', 'ACCESS_CHALLENGE', 'INVALID_URL'].includes(role)) {
    return 'INVALID_PORTAL_ENDPOINT';
  }
  if (role === 'CONTENT_ARTICLE') return 'CONTENT_NOT_RECRUITMENT_PORTAL';
  if (role === 'CORPORATE_HOME') return 'CORPORATE_HOME_ONLY';
  const ats = detectAtsFingerprint({ url: portal.canonicalUrl })?.ats || portal.atsType || '';
  const ownership = ats
    ? resolveAtsTenantOwnership({ company, url: portal.canonicalUrl, atsType: ats })
    : { status: 'UNVERIFIED' };
  if (portal.verificationStatus === 'VERIFIED') return 'VERIFIED_RECRUITMENT_ENTRY';
  if (ats && ownership.status === 'VERIFIED') return 'REVIEWED_ATS_READY_FOR_RECHECK';
  if (ats && ['CAREER_HOME', 'CAMPAIGN', 'JOB_LIST', 'JOB_DETAIL'].includes(role)) {
    return 'ATS_TENANT_OWNERSHIP_MISSING';
  }
  if (portal.verificationStatus === 'BLOCKED') return 'BLOCKED_RETRY_LATER';
  if (['CAREER_HOME', 'CAMPAIGN', 'JOB_LIST', 'JOB_DETAIL'].includes(role)) {
    return 'LIKELY_RECRUITMENT_ROLE_UNDERCLASSIFIED';
  }
  if (portal.verificationStatus === 'REJECTED') return 'REJECTED_NON_RECRUITMENT';
  return 'NEEDS_MORE_EVIDENCE';
}

function compactEvidence(evidence = []) {
  return [...new Set(evidence.map((item) => item.code).filter(Boolean))];
}

function reportMarkdown(report) {
  const categoryRows = Object.entries(report.categoryCounts)
    .sort((left, right) => right[1] - left[1])
    .map(([category, count]) => `| ${category} | ${count} |`)
    .join('\n');
  const examples = report.records
    .filter((item) => !['VERIFIED_RECRUITMENT_ENTRY', 'REJECTED_NON_RECRUITMENT'].includes(item.category))
    .slice(0, 40)
    .map((item) => `| ${item.company} | ${item.category} | ${item.observedRole} | ${item.currentStatus} | ${item.url} |`)
    .join('\n');
  return `# LJS Career Portal Codex Development Audit

- Generated at: ${report.generatedAt}
- Scope: current control task company pool
- Companies: ${report.totals.companies}
- Companies with portal records: ${report.totals.companiesWithPortals}
- Portal records: ${report.totals.portals}
- Auditor: Codex development-time review (not a production LLM decision)

## Categories

| Category | Count |
| --- | ---: |
${categoryRows}

## Representative unresolved or erroneous entries

| Company | Category | Observed role | Current status | URL |
| --- | --- | --- | --- | --- |
${examples}

## Policy

Codex advice has no authority to mark an official portal. Only deterministic
company identity, reviewed ATS ownership, recruitment structure, and application
evidence may change verification status. This report is a development audit and
does not add an LLM interface to the product.
`;
}

async function recheckReviewedAts({ repository, records, companiesById, now }) {
  const adapter = createOfficialVerificationAdapter({ now: () => now });
  const updated = [];
  for (const record of records) {
    if (record.category !== 'REVIEWED_ATS_READY_FOR_RECHECK') continue;
    const portal = repository.listCareerPortals().find((item) => item.id === record.portalId);
    const company = companiesById.get(portal?.companyId);
    if (!portal || !company) continue;
    const inspected = await adapter.inspect({
      company,
      candidate: { url: portal.canonicalUrl },
      page: {
        status: 200,
        finalUrl: portal.canonicalUrl,
        html: '',
      },
    });
    const evidenceByCode = new Map([
      ...portal.evidence.map((item) => [item.code, item]),
      ...inspected.evidence.map((item) => [item.code, item]),
    ]);
    const decision = applyVerificationPolicy({
      pageType: inspected.pageType,
      evidence: [...evidenceByCode.values()],
    });
    if (decision.verificationStatus !== 'VERIFIED') continue;
    repository.upsertCareerPortal({
      ...portal,
      pageType: inspected.pageType,
      verificationStatus: decision.verificationStatus,
      confidenceScore: decision.confidenceScore,
      officialIdentityConfirmed: decision.identityAnchor,
      lastVerifiedAt: now,
      lastCheckedAt: portal.lastCheckedAt || now,
    });
    repository.replaceVerificationEvidence(portal.id, decision.evidence);
    updated.push({
      portalId: portal.id,
      company: company.canonicalName,
      url: portal.canonicalUrl,
      pageType: inspected.pageType,
      confidenceScore: decision.confidenceScore,
    });
  }
  return updated;
}

const args = parseArgs(process.argv.slice(2));
const database = path.resolve(args.database || 'data/lite-job-search.sqlite');
const outputDirectory = path.resolve(args['output-dir'] || 'test-output/portal-audit');
const applyReviewedAts = args['apply-reviewed-ats'] === true;
const repository = openSqliteMarketDiscoveryRepository({ file: database });
repository.migrate();
try {
  const now = new Date().toISOString();
  const snapshot = buildCurrentTaskCompanySnapshot(repository);
  const companiesById = new Map(snapshot.companies.map((company) => [company.id, company]));
  const records = snapshot.portals.map((portal) => {
    const company = companiesById.get(portal.companyId);
    const observedRole = urlRole(portal.canonicalUrl);
    return {
      portalId: portal.id,
      companyId: portal.companyId,
      company: company?.canonicalName || portal.companyId,
      url: portal.canonicalUrl,
      observedRole,
      category: categoryFor({ portal, company: company || {}, role: observedRole }),
      currentStatus: portal.verificationStatus,
      currentPageType: portal.pageType,
      confidenceScore: portal.confidenceScore,
      sourceTier: portal.sourceTier,
      evidence: compactEvidence(portal.evidence),
    };
  });
  const updatedReviewedAts = applyReviewedAts
    ? await recheckReviewedAts({ repository, records, companiesById, now })
    : [];
  const categoryCounts = records.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
  const report = {
    status: 'OK',
    auditType: 'CODEX_DEVELOPMENT_PORTAL_AUDIT',
    generatedAt: now,
    database,
    appliedReviewedAts: applyReviewedAts,
    updatedReviewedAts,
    totals: {
      companies: snapshot.companies.length,
      companiesWithPortals: new Set(snapshot.portals.map((portal) => portal.companyId)).size,
      portals: records.length,
    },
    categoryCounts,
    records,
  };
  await mkdir(outputDirectory, { recursive: true });
  const jsonFile = path.join(outputDirectory, 'career-portal-audit.json');
  const markdownFile = path.join(outputDirectory, 'career-portal-audit.md');
  await Promise.all([
    writeFile(jsonFile, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(markdownFile, reportMarkdown(report)),
  ]);
  repository.appendAuditLog({
    id: randomUUID(),
    action: 'CODEX_DEVELOPMENT_PORTAL_AUDIT_COMPLETED',
    targetType: 'DATABASE',
    targetId: createHash('sha256').update(database).digest('hex').slice(0, 24),
    actor: 'codex-development-auditor',
    details: {
      totals: report.totals,
      categoryCounts,
      updatedReviewedAts,
      jsonFile,
      markdownFile,
    },
    createdAt: now,
  });
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    totals: report.totals,
    categoryCounts,
    updatedReviewedAts,
    jsonFile,
    markdownFile,
  }, null, 2)}\n`);
} finally {
  repository.close();
}
