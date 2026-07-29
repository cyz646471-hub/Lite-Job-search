import path from 'node:path';

import { buildStudentApplicationRows } from '../src/application/build-student-application-rows.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

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

function counts(values, field) {
  return Object.fromEntries([...values.reduce((result, value) => {
    const key = value[field] || 'UNKNOWN';
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map()).entries()].sort());
}

export function buildProductClosureReport(repository) {
  const companies = repository.listCompanies();
  const portals = repository.listCareerPortals();
  const events = repository.listRecruitmentEvents();
  const jobs = repository.listJobOpenings();
  const reviews = repository.listReviewTasks();
  const assignments = repository.listJobAssignments();
  const actions = repository.listUserActions();
  const studentRows = buildStudentApplicationRows({
    companies,
    portals,
    events,
    jobs,
  });
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    companies: companies.length,
    portals: portals.length,
    events: events.length,
    jobs: jobs.length,
    qualityGrades: counts(jobs, 'qualityGrade'),
    publicationStatuses: counts(jobs, 'publicationStatus'),
    platformCandidates: jobs.filter((job) => job.sourceTier === 'PLATFORM_ONLY').length,
    reviewTasks: {
      total: reviews.length,
      open: reviews.filter((review) => review.status === 'OPEN').length,
      byType: counts(reviews, 'reviewType'),
    },
    assignments: assignments.length,
    userActions: actions.length,
    studentPublishedRows: studentRows.length,
  });
}

const args = parseArgs(process.argv.slice(2));
const repository = openSqliteMarketDiscoveryRepository({
  file: path.resolve(args.database || 'data/lite-job-search.sqlite'),
});
try {
  repository.migrate();
  process.stdout.write(`${JSON.stringify(buildProductClosureReport(repository), null, 2)}\n`);
} finally {
  repository.close();
}
