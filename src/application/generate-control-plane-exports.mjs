import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { buildStudentApplicationWorkbook } from '../../scripts/build-browser-batch-xlsx.mjs';
import { buildCompanyCollectionWorkbook } from '../../scripts/build-company-collection-xlsx.mjs';
import { buildCompanyCollectionRows } from './build-company-collection-rows.mjs';
import { buildStudentApplicationRows } from './build-student-application-rows.mjs';

function snapshot(repository) {
  return {
    companies: repository.listCompanies(),
    portals: repository.listCareerPortals(),
    events: repository.listRecruitmentEvents(),
    jobs: repository.listJobOpenings(),
  };
}

function normalizeIdentity(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function buildCurrentTaskCompanySnapshot(repository) {
  const base = snapshot(repository);
  if (
    typeof repository.listControlTasks !== 'function'
    || typeof repository.listBatchItems !== 'function'
  ) return base;
  const task = repository.listControlTasks()[0];
  if (!task?.batchId) return base;
  const items = repository.listBatchItems(task.batchId);
  if (!items.length) return base;
  const ids = new Set(items.map((item) => item.input?.companyId).filter(Boolean));
  const names = new Set(items.flatMap((item) => [
    item.input?.company,
    item.input?.canonicalName,
    item.input?.chineseName,
    item.input?.englishName,
    ...(item.input?.aliases || []),
  ]).map(normalizeIdentity).filter(Boolean));
  const companies = base.companies.filter((company) => (
    ids.has(company.id)
    || [
      company.canonicalName,
      company.chineseName,
      company.englishName,
      ...(company.aliases || []),
    ].map(normalizeIdentity).some((name) => names.has(name))
  ));
  if (!companies.length) return base;
  const companyIds = new Set(companies.map((company) => company.id));
  return {
    companies,
    portals: base.portals.filter((portal) => companyIds.has(portal.companyId)),
    events: base.events.filter((event) => companyIds.has(event.companyId)),
    jobs: base.jobs.filter((job) => companyIds.has(job.companyId)),
  };
}

export function createControlPlaneExportService({
  repository,
  outputDirectory,
} = {}) {
  if (!repository || !outputDirectory) {
    throw new Error('repository and outputDirectory are required');
  }
  const directory = path.resolve(outputDirectory);

  return Object.freeze({
    async buildStudentWorkbook() {
      const rows = buildStudentApplicationRows(snapshot(repository));
      await mkdir(directory, { recursive: true });
      const outputFile = path.join(directory, 'student-applications-current.xlsx');
      await buildStudentApplicationWorkbook({ rows, outputFile });
      return Object.freeze({ outputFile, rowCount: rows.length });
    },
    async buildCompanyWorkbook() {
      const rows = buildCompanyCollectionRows(buildCurrentTaskCompanySnapshot(repository));
      await mkdir(directory, { recursive: true });
      const outputFile = path.join(directory, 'company-collection-current.xlsx');
      await buildCompanyCollectionWorkbook({ rows, outputFile });
      return Object.freeze({ outputFile, rowCount: rows.length });
    },
  });
}
