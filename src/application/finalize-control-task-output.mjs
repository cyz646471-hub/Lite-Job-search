import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildStudentApplicationRows } from './build-student-application-rows.mjs';
import { buildStudentApplicationWorkbook } from '../../scripts/build-browser-batch-xlsx.mjs';
import { openSqliteMarketDiscoveryRepository } from '../storage/sqlite-job-repository.mjs';

export async function finalizeControlTaskOutput({ database, outputDir, taskId, batchId } = {}) {
  if (!database || !outputDir || !taskId || !batchId) {
    throw new Error('database, output-dir, task-id and batch-id are required');
  }
  const repository = openSqliteMarketDiscoveryRepository({ file: path.resolve(database) });
  repository.migrate();
  try {
    const companies = repository.listCompanies();
    const rows = buildStudentApplicationRows({
      companies,
      portals: repository.listCareerPortals(),
      events: repository.listRecruitmentEvents(),
      jobs: repository.listJobOpenings(),
    });
    await mkdir(outputDir, { recursive: true });
    const xlsxOutput = path.resolve(outputDir, 'student-applications.xlsx');
    await Promise.all([
      writeFile(path.join(outputDir, 'student-application-rows.json'), `${JSON.stringify(rows, null, 2)}\n`),
      buildStudentApplicationWorkbook({ rows, outputFile: xlsxOutput }),
      writeFile(path.join(outputDir, 'final-summary.json'), `${JSON.stringify({
        taskId,
        batchId,
        generatedAt: new Date().toISOString(),
        companyCount: companies.length,
        portalCount: repository.listCareerPortals().length,
        jobCount: repository.listJobOpenings().length,
        studentRowCount: rows.length,
        xlsxOutput,
      }, null, 2)}\n`),
    ]);
    return { xlsxOutput, studentRowCount: rows.length };
  } finally {
    repository.close();
  }
}
