import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { assertMarketDiscoveryRepository } from '../ports/job-repository.mjs';

const MIGRATION_FILE = fileURLToPath(
  new URL('./migrations/001-market-discovery.sql', import.meta.url),
);

function encode(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function decode(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ensureParentDirectory(file) {
  if (file === ':memory:' || String(file).startsWith('file:')) return;
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
}

function mapCompany(row, aliases = [], domains = []) {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    aliases,
    primaryOfficialDomain: row.primary_official_domain,
    officialDomains: domains,
    industryTags: decode(row.industry_tags_json, []),
    market: row.market,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvidence(row) {
  return {
    code: row.code,
    direction: row.direction,
    weight: row.weight,
    observedValue: row.observed_value,
    sourceUrl: row.source_url || null,
    observedAt: row.observed_at,
  };
}

function mapPortal(row, evidence = []) {
  return {
    id: row.id,
    companyId: row.company_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    registrableDomain: row.registrable_domain,
    atsType: row.ats_type,
    pageType: row.page_type,
    verificationStatus: row.verification_status,
    confidenceScore: row.confidence_score,
    evidence,
    firstSeenAt: row.first_seen_at,
    lastVerifiedAt: row.last_verified_at,
  };
}

function mapOpening(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    careerPortalId: row.career_portal_id,
    sourceJobId: row.source_job_id,
    title: row.title,
    normalizedTitle: row.normalized_title,
    roleFamily: row.role_family,
    locations: decode(row.locations_json, []),
    employmentType: row.employment_type,
    publishedAt: row.published_at,
    closesAt: row.closes_at,
    jobDetailUrl: row.job_detail_url,
    applyUrl: row.apply_url,
    status: row.status,
    sourceUrl: row.source_url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function mapLog(row) {
  return {
    id: row.id,
    runId: row.run_id,
    searchIntentId: row.search_intent_id,
    query: row.query,
    expandedKeywords: decode(row.expanded_keywords_json, []),
    searchSource: row.search_source,
    searchedAt: row.searched_at,
    resultUrl: row.result_url,
    resultRank: row.result_rank,
    outcome: row.outcome,
    metadata: decode(row.metadata_json, {}),
  };
}

export function openSqliteMarketDiscoveryRepository({ file } = {}) {
  if (!file) throw new Error('SQLite database file is required');
  ensureParentDirectory(file);

  const database = new Database(file);
  database.pragma('foreign_keys = ON');
  if (file !== ':memory:') database.pragma('journal_mode = WAL');

  let statements;

  function migrate() {
    database.exec(readFileSync(MIGRATION_FILE, 'utf8'));
    statements = {
      upsertCompany: database.prepare(`
        INSERT INTO companies (
          id, canonical_name, market, primary_official_domain,
          industry_tags_json, created_at, updated_at
        ) VALUES (
          @id, @canonicalName, @market, @primaryOfficialDomain,
          @industryTagsJson, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          canonical_name = excluded.canonical_name,
          market = excluded.market,
          primary_official_domain = excluded.primary_official_domain,
          industry_tags_json = excluded.industry_tags_json,
          updated_at = excluded.updated_at
      `),
      deleteAliases: database.prepare('DELETE FROM company_aliases WHERE company_id = ?'),
      insertAlias: database.prepare(`
        INSERT OR IGNORE INTO company_aliases (company_id, alias) VALUES (?, ?)
      `),
      deleteDomains: database.prepare('DELETE FROM company_domains WHERE company_id = ?'),
      insertDomain: database.prepare(`
        INSERT OR IGNORE INTO company_domains (company_id, domain, market) VALUES (?, ?, ?)
      `),
      upsertPortal: database.prepare(`
        INSERT INTO career_portals (
          id, company_id, url, canonical_url, registrable_domain, ats_type,
          page_type, verification_status, confidence_score, first_seen_at, last_verified_at
        ) VALUES (
          @id, @companyId, @url, @canonicalUrl, @registrableDomain, @atsType,
          @pageType, @verificationStatus, @confidenceScore, @firstSeenAt, @lastVerifiedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          company_id = excluded.company_id,
          url = excluded.url,
          canonical_url = excluded.canonical_url,
          registrable_domain = excluded.registrable_domain,
          ats_type = excluded.ats_type,
          page_type = excluded.page_type,
          verification_status = excluded.verification_status,
          confidence_score = excluded.confidence_score,
          last_verified_at = excluded.last_verified_at
      `),
      portalStatus: database.prepare(`
        SELECT company_id, verification_status FROM career_portals WHERE id = ?
      `),
      deleteEvidence: database.prepare(`
        DELETE FROM verification_evidence WHERE career_portal_id = ?
      `),
      insertEvidence: database.prepare(`
        INSERT INTO verification_evidence (
          career_portal_id, code, direction, weight, observed_value, source_url, observed_at
        ) VALUES (
          @careerPortalId, @code, @direction, @weight, @observedValue, @sourceUrl, @observedAt
        )
      `),
      upsertOpening: database.prepare(`
        INSERT INTO job_openings (
          id, company_id, career_portal_id, source_job_id, title, normalized_title,
          role_family, locations_json, employment_type, published_at, closes_at,
          job_detail_url, apply_url, status, source_url, first_seen_at, last_seen_at
        ) VALUES (
          @id, @companyId, @careerPortalId, @sourceJobId, @title, @normalizedTitle,
          @roleFamily, @locationsJson, @employmentType, @publishedAt, @closesAt,
          @jobDetailUrl, @applyUrl, @status, @sourceUrl, @firstSeenAt, @lastSeenAt
        )
        ON CONFLICT(id) DO UPDATE SET
          company_id = excluded.company_id,
          career_portal_id = excluded.career_portal_id,
          source_job_id = excluded.source_job_id,
          title = excluded.title,
          normalized_title = excluded.normalized_title,
          role_family = excluded.role_family,
          locations_json = excluded.locations_json,
          employment_type = excluded.employment_type,
          published_at = excluded.published_at,
          closes_at = excluded.closes_at,
          job_detail_url = excluded.job_detail_url,
          apply_url = excluded.apply_url,
          status = excluded.status,
          source_url = excluded.source_url,
          last_seen_at = excluded.last_seen_at
      `),
      beginRun: database.prepare(`
        INSERT INTO discovery_runs (id, intent_json, status, started_at)
        VALUES (@id, @intentJson, 'RUNNING', @startedAt)
        ON CONFLICT(id) DO UPDATE SET
          intent_json = excluded.intent_json,
          status = 'RUNNING',
          started_at = excluded.started_at,
          completed_at = NULL,
          error_message = NULL
      `),
      completeRun: database.prepare(`
        UPDATE discovery_runs
        SET status = @status, completed_at = @completedAt, error_message = @errorMessage
        WHERE id = @id
      `),
      appendLog: database.prepare(`
        INSERT INTO discovery_logs (
          id, run_id, search_intent_id, query, expanded_keywords_json, search_source,
          searched_at, result_url, result_rank, outcome, metadata_json
        ) VALUES (
          @id, @runId, @searchIntentId, @query, @expandedKeywordsJson, @searchSource,
          @searchedAt, @resultUrl, @resultRank, @outcome, @metadataJson
        )
        ON CONFLICT(id) DO UPDATE SET
          query = excluded.query,
          expanded_keywords_json = excluded.expanded_keywords_json,
          search_source = excluded.search_source,
          searched_at = excluded.searched_at,
          result_url = excluded.result_url,
          result_rank = excluded.result_rank,
          outcome = excluded.outcome,
          metadata_json = excluded.metadata_json
      `),
    };
    return repository;
  }

  function requireMigration() {
    if (!statements) throw new Error('repository.migrate() must be called first');
  }

  function withTransaction(callback) {
    requireMigration();
    return database.transaction(callback)();
  }

  function upsertCompany(company) {
    requireMigration();
    return withTransaction(() => {
      statements.upsertCompany.run({
        id: company.id,
        canonicalName: company.canonicalName,
        market: company.market,
        primaryOfficialDomain: company.primaryOfficialDomain ?? null,
        industryTagsJson: encode(company.industryTags, []),
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
      });
      statements.deleteAliases.run(company.id);
      for (const alias of [...new Set(company.aliases || [])]) {
        statements.insertAlias.run(company.id, alias);
      }
      statements.deleteDomains.run(company.id);
      for (const domain of [...new Set(company.officialDomains || [])]) {
        statements.insertDomain.run(company.id, domain, company.market);
      }
      return company;
    });
  }

  function upsertCareerPortal(portal) {
    requireMigration();
    statements.upsertPortal.run({
      ...portal,
      atsType: portal.atsType || '',
      lastVerifiedAt: portal.lastVerifiedAt ?? null,
    });
    return portal;
  }

  function replaceVerificationEvidence(careerPortalId, evidence = []) {
    requireMigration();
    return withTransaction(() => {
      statements.deleteEvidence.run(careerPortalId);
      for (const item of evidence) {
        statements.insertEvidence.run({
          careerPortalId,
          code: item.code,
          direction: item.direction,
          weight: item.weight,
          observedValue: item.observedValue ?? null,
          sourceUrl: item.sourceUrl || '',
          observedAt: item.observedAt,
        });
      }
      return evidence;
    });
  }

  function upsertJobOpening(opening) {
    requireMigration();
    const portal = statements.portalStatus.get(opening.careerPortalId);
    if (!portal || portal.verification_status !== 'VERIFIED') {
      throw new Error('JobOpening requires a verified CareerPortal');
    }
    if (portal.company_id !== opening.companyId) {
      throw new Error('JobOpening company must match its CareerPortal');
    }
    statements.upsertOpening.run({
      ...opening,
      sourceJobId: opening.sourceJobId ?? null,
      locationsJson: encode(opening.locations, []),
      employmentType: opening.employmentType ?? null,
      publishedAt: opening.publishedAt ?? null,
      closesAt: opening.closesAt ?? null,
      jobDetailUrl: opening.jobDetailUrl ?? null,
      applyUrl: opening.applyUrl ?? null,
    });
    return opening;
  }

  function beginRun(run) {
    requireMigration();
    statements.beginRun.run({
      id: run.id,
      intentJson: encode(run.intent, {}),
      startedAt: run.startedAt,
    });
    return run;
  }

  function completeRun(run) {
    requireMigration();
    const errorMessage = run.error == null
      ? null
      : String(run.error?.message || run.error);
    const result = statements.completeRun.run({
      id: run.id,
      status: run.status,
      completedAt: run.completedAt,
      errorMessage,
    });
    if (result.changes !== 1) throw new Error(`unknown discovery run: ${run.id}`);
    return run;
  }

  function appendDiscoveryLog(log) {
    requireMigration();
    statements.appendLog.run({
      ...log,
      expandedKeywordsJson: encode(log.expandedKeywords, []),
      resultUrl: log.resultUrl ?? null,
      resultRank: log.resultRank ?? null,
      metadataJson: encode(log.metadata, {}),
    });
    return log;
  }

  function listCompanies() {
    requireMigration();
    const aliases = database.prepare(`
      SELECT alias FROM company_aliases WHERE company_id = ? ORDER BY alias
    `);
    const domains = database.prepare(`
      SELECT domain FROM company_domains WHERE company_id = ? ORDER BY domain
    `);
    return database.prepare('SELECT * FROM companies ORDER BY canonical_name, id').all()
      .map((row) => mapCompany(
        row,
        aliases.all(row.id).map((item) => item.alias),
        domains.all(row.id).map((item) => item.domain),
      ));
  }

  function listCareerPortals() {
    requireMigration();
    const evidence = database.prepare(`
      SELECT * FROM verification_evidence
      WHERE career_portal_id = ?
      ORDER BY code, source_url
    `);
    return database.prepare('SELECT * FROM career_portals ORDER BY canonical_url, id').all()
      .map((row) => mapPortal(row, evidence.all(row.id).map(mapEvidence)));
  }

  function listJobOpenings() {
    requireMigration();
    return database.prepare('SELECT * FROM job_openings ORDER BY title, id').all().map(mapOpening);
  }

  function listDiscoveryLogs() {
    requireMigration();
    return database.prepare(`
      SELECT * FROM discovery_logs ORDER BY searched_at, id
    `).all().map(mapLog);
  }

  function close() {
    if (database.open) database.close();
  }

  const repository = {
    migrate,
    withTransaction,
    beginRun,
    completeRun,
    upsertCompany,
    upsertCareerPortal,
    replaceVerificationEvidence,
    upsertJobOpening,
    appendDiscoveryLog,
    listCompanies,
    listCareerPortals,
    listJobOpenings,
    listDiscoveryLogs,
    close,
  };

  return assertMarketDiscoveryRepository(repository);
}
