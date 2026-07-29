import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createCompany } from '../src/domain/company.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

function parseArgs(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') {
      options.apply = true;
      continue;
    }
    if (!value.startsWith('--')) throw new Error(`unexpected argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing value for ${value}`);
    options[value.slice(2)] = next;
    index += 1;
  }
  return options;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeIdentity(value) {
  return clean(value).normalize('NFKC').toLowerCase()
    .replace(/[（）()[\]【】{}《》〈〉“”"'`·・,，、.。:：;；/\\_\-—\s]/g, '');
}

function normalizeLegalIdentity(value) {
  return normalizeIdentity(value)
    .replace(/(有限责任公司|股份有限公司|集团有限公司|有限公司|集团公司)$/g, '');
}

function normalizeDomain(value) {
  const input = clean(value).toLowerCase();
  if (!input) return '';
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(hostname)) {
    throw new Error(`invalid domain: ${value}`);
  }
  return hostname;
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function intersects(left, right) {
  return [...left].some((value) => right.has(value));
}

function stableCompanyId(name) {
  const digest = createHash('sha256').update(`CN|${name}`).digest('hex').slice(0, 24);
  return `company-${digest}`;
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(value) {
    if (this.parent[value] !== value) this.parent[value] = this.find(this.parent[value]);
    return this.parent[value];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}

function sanitizeRegistry(rawRegistry) {
  const invalidRecords = [];
  const invalidDomains = [];
  const records = [];

  rawRegistry.forEach((raw, sourceIndex) => {
    const chineseName = clean(raw.name_cn);
    const englishName = clean(raw.name_en);
    if (!chineseName && !englishName) {
      invalidRecords.push({ sourceIndex, reason: 'MISSING_COMPANY_NAME', raw });
      return;
    }

    const domains = [];
    for (const value of raw.official_domains ?? []) {
      try {
        const domain = normalizeDomain(value);
        if (domain) domains.push(domain);
      } catch (error) {
        invalidDomains.push({
          sourceIndex,
          company: chineseName || englishName,
          value,
          reason: error.message,
        });
      }
    }

    records.push({
      sourceIndex,
      chineseName,
      englishName,
      aliases: unique(raw.aliases ?? []),
      industryTags: unique(raw.industry ?? []).filter((value) => value !== 'pending'),
      countryRegion: clean(raw.country_region) || 'China',
      officialDomains: unique(domains),
      sources: unique(raw.sources ?? []),
      incomplete: raw.incomplete === true,
    });
  });

  return { records, invalidRecords, invalidDomains };
}

function deduplicateRegistry(records) {
  const unionFind = new UnionFind(records.length);
  const domainOwner = new Map();
  const sameNameConflicts = [];

  records.forEach((record, index) => {
    for (const domain of record.officialDomains) {
      if (domainOwner.has(domain)) unionFind.union(index, domainOwner.get(domain));
      else domainOwner.set(domain, index);
    }
  });

  const nameOwners = new Map();
  records.forEach((record, index) => {
    for (const name of [record.chineseName, record.englishName]) {
      const key = normalizeIdentity(name);
      if (!key) continue;
      const owners = nameOwners.get(key) ?? [];
      for (const owner of owners) {
        const leftDomains = new Set(record.officialDomains);
        const rightDomains = new Set(records[owner].officialDomains);
        const hasConflictingDomains = leftDomains.size > 0
          && rightDomains.size > 0
          && !intersects(leftDomains, rightDomains);
        if (hasConflictingDomains) {
          sameNameConflicts.push({
            key,
            companies: [records[owner].chineseName || records[owner].englishName,
              record.chineseName || record.englishName],
            domains: [[...rightDomains], [...leftDomains]],
          });
        } else {
          unionFind.union(index, owner);
        }
      }
      owners.push(index);
      nameOwners.set(key, owners);
    }
  });

  const incompleteAliasMerges = [];
  records.forEach((record, index) => {
    if (!record.incomplete || record.officialDomains.length > 0) return;
    const key = normalizeLegalIdentity(record.chineseName || record.englishName);
    if (!key) return;
    const candidateRoots = new Set();
    records.forEach((candidate, candidateIndex) => {
      if (candidateIndex === index || candidate.officialDomains.length === 0) return;
      const candidateKeys = [
        candidate.chineseName,
        candidate.englishName,
        ...candidate.aliases,
      ].map(normalizeLegalIdentity).filter(Boolean);
      if (candidateKeys.includes(key)) candidateRoots.add(unionFind.find(candidateIndex));
    });
    if (candidateRoots.size !== 1) return;
    const targetRoot = [...candidateRoots][0];
    incompleteAliasMerges.push({
      incomplete: record.chineseName || record.englishName,
      complete: records[targetRoot].chineseName || records[targetRoot].englishName,
      key,
    });
    unionFind.union(index, targetRoot);
  });

  const clusters = new Map();
  records.forEach((record, index) => {
    const root = unionFind.find(index);
    const bucket = clusters.get(root) ?? [];
    bucket.push(record);
    clusters.set(root, bucket);
  });

  const merged = [...clusters.values()].map((items) => {
    const ranked = [...items].sort((left, right) => {
      const score = (item) => (
        item.officialDomains.length * 100
        + (item.incomplete ? 0 : 20)
        + item.industryTags.length * 3
        + item.aliases.length
      );
      return score(right) - score(left) || left.sourceIndex - right.sourceIndex;
    });
    const best = ranked[0];
    const chineseName = best.chineseName || ranked.find((item) => item.chineseName)?.chineseName || '';
    const englishName = best.englishName || ranked.find((item) => item.englishName)?.englishName || '';
    const canonicalKeys = new Set(
      [chineseName, englishName].map(normalizeIdentity).filter(Boolean),
    );
    const aliases = unique(items.flatMap((item) => [
      ...item.aliases,
      item.chineseName,
      item.englishName,
    ])).filter((alias) => !canonicalKeys.has(normalizeIdentity(alias)));
    return {
      name_cn: chineseName || null,
      name_en: englishName || null,
      aliases,
      industry: unique(items.flatMap((item) => item.industryTags)),
      country_region: best.countryRegion || 'China',
      official_domains: unique(items.flatMap((item) => item.officialDomains)),
      sources: unique(items.flatMap((item) => item.sources)),
      incomplete: items.every((item) => item.incomplete),
      source_indexes: items.map((item) => item.sourceIndex),
    };
  });

  const identityOwners = new Map();
  merged.forEach((record, index) => {
    for (const value of [record.name_cn, record.name_en, ...record.aliases]) {
      const key = normalizeIdentity(value);
      if (!key) continue;
      const owners = identityOwners.get(key) ?? new Set();
      owners.add(index);
      identityOwners.set(key, owners);
    }
  });
  const ambiguousAliasKeys = new Set(
    [...identityOwners].filter(([, owners]) => owners.size > 1).map(([key]) => key),
  );
  const excludedAmbiguousAliases = [];
  const databaseAliases = merged.map((record) => record.aliases.filter((alias) => {
    const excluded = ambiguousAliasKeys.has(normalizeIdentity(alias));
    if (excluded) {
      excludedAmbiguousAliases.push({
        company: record.name_cn || record.name_en,
        alias,
        key: normalizeIdentity(alias),
      });
    }
    return !excluded;
  }));

  return {
    merged,
    databaseAliases,
    sameNameConflicts,
    incompleteAliasMerges,
    excludedAmbiguousAliases,
  };
}

function buildExistingIndexes(companies) {
  const domainToIds = new Map();
  const identityToIds = new Map();
  const add = (map, key, id) => {
    if (!key) return;
    const ids = map.get(key) ?? new Set();
    ids.add(id);
    map.set(key, ids);
  };
  for (const company of companies) {
    for (const domain of company.officialDomains ?? []) add(domainToIds, domain, company.id);
    for (const name of [
      company.canonicalName,
      company.chineseName,
      company.englishName,
      ...(company.aliases ?? []),
    ]) add(identityToIds, normalizeIdentity(name), company.id);
  }
  return { domainToIds, identityToIds };
}

function resolveExistingIds(record, aliases, indexes) {
  const ids = new Set();
  for (const domain of record.official_domains) {
    for (const id of indexes.domainToIds.get(domain) ?? []) ids.add(id);
  }
  for (const value of [record.name_cn, record.name_en, ...aliases]) {
    const key = normalizeIdentity(value);
    for (const id of indexes.identityToIds.get(key) ?? []) ids.add(id);
  }
  return ids;
}

const args = parseArgs(process.argv.slice(2));
if (!args.registry || !args.database || !args.report) {
  throw new Error(
    'usage: node scripts/register-company-registry.mjs '
    + '--registry <companies.json> --database <jobs.sqlite> --report <report.json> '
    + '[--normalized-output <companies.json>] [--apply]',
  );
}

const registryPath = path.resolve(args.registry);
const databasePath = path.resolve(args.database);
const reportPath = path.resolve(args.report);
const sourceBytes = await readFile(registryPath);
const rawRegistry = JSON.parse(sourceBytes.toString('utf8'));
if (!Array.isArray(rawRegistry)) throw new Error('registry root must be an array');

const sanitized = sanitizeRegistry(rawRegistry);
const deduplicated = deduplicateRegistry(sanitized.records);
if (args['normalized-output']) {
  const normalizedPath = path.resolve(args['normalized-output']);
  await mkdir(path.dirname(normalizedPath), { recursive: true });
  const normalizedRows = deduplicated.merged.map(({ source_indexes: ignored, ...record }) => record);
  await writeFile(normalizedPath, `${JSON.stringify(normalizedRows, null, 2)}\n`, 'utf8');
}

const repository = openSqliteMarketDiscoveryRepository({ file: databasePath });
repository.migrate();
const beforeCompanies = repository.listCompanies();
const existingById = new Map(beforeCompanies.map((company) => [company.id, company]));
const indexes = buildExistingIndexes(beforeCompanies);
const planned = [];
const conflicts = [];

deduplicated.merged.forEach((record, index) => {
  const aliases = deduplicated.databaseAliases[index];
  const matchedIds = resolveExistingIds(record, aliases, indexes);
  if (matchedIds.size > 1) {
    conflicts.push({
      company: record.name_cn || record.name_en,
      reason: 'MULTIPLE_DATABASE_IDENTITIES',
      matchedCompanyIds: [...matchedIds],
    });
    return;
  }
  planned.push({
    record,
    aliases,
    existingId: [...matchedIds][0] ?? null,
  });
});

const applied = [];
const failures = [];
if (args.apply) {
  for (const item of planned) {
    const existing = item.existingId ? existingById.get(item.existingId) : null;
    const canonicalName = existing?.canonicalName || item.record.name_cn || item.record.name_en;
    try {
      const company = createCompany({
        id: existing?.id || stableCompanyId(canonicalName),
        canonicalName,
        chineseName: existing?.chineseName || item.record.name_cn,
        englishName: existing?.englishName || item.record.name_en,
        aliases: unique([
          ...(existing?.aliases ?? []),
          ...item.aliases,
          ...(canonicalName !== item.record.name_cn ? [item.record.name_cn] : []),
          ...(canonicalName !== item.record.name_en ? [item.record.name_en] : []),
        ]),
        primaryOfficialDomain: existing?.primaryOfficialDomain
          || item.record.official_domains[0]
          || null,
        officialDomains: unique([
          ...(existing?.officialDomains ?? []),
          ...item.record.official_domains,
        ]),
        industryTags: unique([
          ...(existing?.industryTags ?? []),
          ...item.record.industry,
        ]),
        countryRegion: existing?.countryRegion || item.record.country_region,
        market: 'CN',
        createdAt: existing?.createdAt,
      });
      const stored = repository.upsertCompany(company);
      applied.push({
        company: stored.canonicalName,
        companyId: stored.id,
        action: existing ? 'ENRICHED_EXISTING' : 'INSERTED',
      });
    } catch (error) {
      failures.push({
        company: canonicalName,
        code: error.code ?? null,
        error: error.message,
      });
    }
  }
}

const afterCompanies = repository.listCompanies();
repository.close();

const report = {
  generatedAt: new Date().toISOString(),
  mode: args.apply ? 'APPLY' : 'DRY_RUN',
  source: {
    path: registryPath,
    sha256: createHash('sha256').update(sourceBytes).digest('hex'),
    records: rawRegistry.length,
  },
  audit: {
    validRecords: sanitized.records.length,
    normalizedRecords: deduplicated.merged.length,
    duplicateRecordsMerged: sanitized.records.length - deduplicated.merged.length,
    invalidRecordCount: sanitized.invalidRecords.length,
    invalidDomainCount: sanitized.invalidDomains.length,
    incompleteAliasMergeCount: deduplicated.incompleteAliasMerges.length,
    sameNameConflictCount: deduplicated.sameNameConflicts.length,
    ambiguousAliasExcludedCount: deduplicated.excludedAmbiguousAliases.length,
  },
  database: {
    beforeCompanyCount: beforeCompanies.length,
    plannedExistingEnrichmentCount: planned.filter((item) => item.existingId).length,
    plannedInsertCount: planned.filter((item) => !item.existingId).length,
    conflictCount: conflicts.length,
    appliedCount: applied.length,
    insertedCount: applied.filter((item) => item.action === 'INSERTED').length,
    enrichedExistingCount: applied.filter((item) => item.action === 'ENRICHED_EXISTING').length,
    failureCount: failures.length,
    afterCompanyCount: afterCompanies.length,
  },
  details: {
    invalidRecords: sanitized.invalidRecords,
    invalidDomains: sanitized.invalidDomains,
    incompleteAliasMerges: deduplicated.incompleteAliasMerges,
    sameNameConflicts: deduplicated.sameNameConflicts,
    excludedAmbiguousAliases: deduplicated.excludedAmbiguousAliases,
    databaseConflicts: conflicts,
    failures,
    applied,
  },
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  mode: report.mode,
  sourceRecords: report.source.records,
  normalizedRecords: report.audit.normalizedRecords,
  duplicateRecordsMerged: report.audit.duplicateRecordsMerged,
  invalidRecordCount: report.audit.invalidRecordCount,
  invalidDomainCount: report.audit.invalidDomainCount,
  beforeCompanyCount: report.database.beforeCompanyCount,
  plannedExistingEnrichmentCount: report.database.plannedExistingEnrichmentCount,
  plannedInsertCount: report.database.plannedInsertCount,
  conflictCount: report.database.conflictCount,
  insertedCount: report.database.insertedCount,
  enrichedExistingCount: report.database.enrichedExistingCount,
  failureCount: report.database.failureCount,
  afterCompanyCount: report.database.afterCompanyCount,
  reportPath,
}, null, 2));
