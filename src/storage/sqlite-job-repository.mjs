import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { assertMarketDiscoveryRepository } from '../ports/job-repository.mjs';

const MIGRATION_DIRECTORY = fileURLToPath(new URL('./migrations/', import.meta.url));

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
    chineseName: row.chinese_name || null,
    englishName: row.english_name || null,
    aliases,
    primaryOfficialDomain: row.primary_official_domain,
    officialDomains: domains,
    industryTags: decode(row.industry_tags_json, []),
    countryRegion: row.country_region || null,
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
    sourceTier: row.source_tier || (row.ats_type ? 'OFFICIAL_ATS' : 'OFFICIAL_SITE'),
    officialIdentityConfirmed: row.official_identity_confirmed === 1,
    platformIdentityConfirmed: row.platform_identity_confirmed === 1,
    hiringAvailability: row.hiring_availability || 'UNKNOWN',
    fallbackReason: row.fallback_reason || null,
    searchCoverage: row.search_coverage || 'PARTIAL',
    supersededByPortalId: row.superseded_by_portal_id || null,
    recruitmentTypes: decode(row.recruitment_types_json, []),
    evidence,
    firstSeenAt: row.first_seen_at,
    lastVerifiedAt: row.last_verified_at,
    lastCheckedAt: row.last_checked_at || null,
  };
}

function mapRecruitmentEvent(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    careerPortalId: row.career_portal_id,
    sourceTier: row.source_tier,
    recruitmentType: row.recruitment_type,
    cohort: row.cohort || null,
    campaignName: row.campaign_name || null,
    status: row.status,
    startAt: row.start_at,
    closesAt: row.closes_at,
    directoryUrl: row.directory_url,
    locations: decode(row.locations_json, []),
    publicationClass: row.publication_class,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastVerifiedAt: row.last_verified_at,
  };
}

function mapOpening(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    careerPortalId: row.career_portal_id,
    recruitmentEventId: row.recruitment_event_id || null,
    sourceTier: row.source_tier || 'OFFICIAL_SITE',
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

function mapProviderCircuitState(row) {
  if (!row) return null;
  return {
    provider: row.provider,
    state: row.state,
    reasonCode: row.reason_code || null,
    openedAt: row.opened_at || null,
    nextProbeAt: row.next_probe_at || null,
    lastHealthyAt: row.last_healthy_at || null,
    updatedAt: row.updated_at,
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
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const applied = database.prepare('SELECT name FROM schema_migrations');
    const markApplied = database.prepare(`
      INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)
    `);
    const appliedNames = new Set(applied.all().map((row) => row.name));
    for (const name of readdirSync(MIGRATION_DIRECTORY)
      .filter((entry) => entry.endsWith('.sql'))
      .sort()) {
      if (appliedNames.has(name)) continue;
      database.transaction(() => {
        database.exec(readFileSync(path.join(MIGRATION_DIRECTORY, name), 'utf8'));
        markApplied.run(name, new Date().toISOString());
      })();
    }
    statements = {
      upsertCompany: database.prepare(`
        INSERT INTO companies (
          id, canonical_name, chinese_name, english_name, market,
          primary_official_domain, industry_tags_json, country_region,
          created_at, updated_at
        ) VALUES (
          @id, @canonicalName, @chineseName, @englishName, @market,
          @primaryOfficialDomain, @industryTagsJson, @countryRegion,
          @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          canonical_name = excluded.canonical_name,
          chinese_name = COALESCE(companies.chinese_name, excluded.chinese_name),
          english_name = COALESCE(companies.english_name, excluded.english_name),
          market = excluded.market,
          primary_official_domain = COALESCE(
            excluded.primary_official_domain,
            companies.primary_official_domain
          ),
          industry_tags_json = excluded.industry_tags_json,
          country_region = COALESCE(companies.country_region, excluded.country_region),
          updated_at = excluded.updated_at
      `),
      companyById: database.prepare('SELECT * FROM companies WHERE id = ?'),
      insertAlias: database.prepare(`
        INSERT OR IGNORE INTO company_aliases (company_id, alias) VALUES (?, ?)
      `),
      insertDomain: database.prepare(`
        INSERT OR IGNORE INTO company_domains (company_id, domain, market) VALUES (?, ?, ?)
      `),
      upsertPortal: database.prepare(`
        INSERT INTO career_portals (
          id, company_id, url, canonical_url, registrable_domain, ats_type,
          page_type, verification_status, confidence_score, recruitment_types_json,
          source_tier, official_identity_confirmed, platform_identity_confirmed,
          hiring_availability, fallback_reason, search_coverage,
          superseded_by_portal_id, first_seen_at, last_verified_at, last_checked_at
        ) VALUES (
          @id, @companyId, @url, @canonicalUrl, @registrableDomain, @atsType,
          @pageType, @verificationStatus, @confidenceScore, @recruitmentTypesJson,
          @sourceTier, @officialIdentityConfirmed, @platformIdentityConfirmed,
          @hiringAvailability, @fallbackReason, @searchCoverage,
          @supersededByPortalId, @firstSeenAt, @lastVerifiedAt, @lastCheckedAt
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
          recruitment_types_json = excluded.recruitment_types_json,
          source_tier = excluded.source_tier,
          official_identity_confirmed = excluded.official_identity_confirmed,
          platform_identity_confirmed = excluded.platform_identity_confirmed,
          hiring_availability = excluded.hiring_availability,
          fallback_reason = excluded.fallback_reason,
          search_coverage = excluded.search_coverage,
          superseded_by_portal_id = excluded.superseded_by_portal_id,
          last_verified_at = excluded.last_verified_at,
          last_checked_at = excluded.last_checked_at
      `),
      portalStatus: database.prepare(`
        SELECT company_id, verification_status, source_tier,
               platform_identity_confirmed, hiring_availability
        FROM career_portals WHERE id = ?
      `),
      portalIdentity: database.prepare(`
        SELECT id, company_id FROM career_portals
        WHERE id = ? OR canonical_url = ?
        LIMIT 1
      `),
      deletePortalOpenings: database.prepare(`
        DELETE FROM job_openings WHERE career_portal_id = ?
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
      upsertRecruitmentEvent: database.prepare(`
        INSERT INTO recruitment_events (
          id, company_id, career_portal_id, source_tier, recruitment_type,
          cohort, campaign_name, status, start_at, closes_at, directory_url,
          locations_json, publication_class, first_seen_at, last_seen_at,
          last_verified_at
        ) VALUES (
          @id, @companyId, @careerPortalId, @sourceTier, @recruitmentType,
          @cohort, @campaignName, @status, @startAt, @closesAt, @directoryUrl,
          @locationsJson, @publicationClass, @firstSeenAt, @lastSeenAt,
          @lastVerifiedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          company_id = excluded.company_id,
          career_portal_id = excluded.career_portal_id,
          source_tier = excluded.source_tier,
          recruitment_type = excluded.recruitment_type,
          cohort = excluded.cohort,
          campaign_name = excluded.campaign_name,
          status = excluded.status,
          start_at = excluded.start_at,
          closes_at = excluded.closes_at,
          directory_url = excluded.directory_url,
          locations_json = excluded.locations_json,
          publication_class = excluded.publication_class,
          last_seen_at = excluded.last_seen_at,
          last_verified_at = excluded.last_verified_at
      `),
      recruitmentEventById: database.prepare(`
        SELECT * FROM recruitment_events WHERE id = ?
      `),
      upsertOpening: database.prepare(`
        INSERT INTO job_openings (
          id, company_id, career_portal_id, recruitment_event_id, source_tier,
          source_job_id, title, normalized_title, role_family, locations_json,
          employment_type, published_at, closes_at, job_detail_url, apply_url,
          status, source_url, first_seen_at, last_seen_at
        ) VALUES (
          @id, @companyId, @careerPortalId, @recruitmentEventId, @sourceTier,
          @sourceJobId, @title, @normalizedTitle, @roleFamily, @locationsJson,
          @employmentType, @publishedAt, @closesAt, @jobDetailUrl, @applyUrl,
          @status, @sourceUrl, @firstSeenAt, @lastSeenAt
        )
        ON CONFLICT(id) DO UPDATE SET
          company_id = excluded.company_id,
          career_portal_id = excluded.career_portal_id,
          recruitment_event_id = excluded.recruitment_event_id,
          source_tier = excluded.source_tier,
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
      recordLlmUsage: database.prepare(`
        INSERT INTO llm_usage_logs (
          id, run_id, task, provider, model, prompt_hash, cache_hit,
          input_tokens, output_tokens, cost_usd, status, error_message, created_at
        ) VALUES (
          @id, @runId, @task, @provider, @model, @promptHash, @cacheHit,
          @inputTokens, @outputTokens, @costUsd, @status, @errorMessage, @createdAt
        )
      `),
      beginBatch: database.prepare(`
        INSERT INTO batch_runs (id, input_hash, status, started_at)
        VALUES (@id, @inputHash, 'RUNNING', @startedAt)
        ON CONFLICT(id) DO UPDATE SET
          status = 'RUNNING',
          completed_at = NULL
      `),
      batchById: database.prepare(`
        SELECT input_hash FROM batch_runs WHERE id = ?
      `),
      ensureBatchItem: database.prepare(`
        INSERT OR IGNORE INTO batch_items (
          batch_id, item_key, position, input_json, status, created_at
        ) VALUES (
          @batchId, @itemKey, @position, @inputJson, 'PENDING', @createdAt
        )
      `),
      batchItem: database.prepare(`
        SELECT * FROM batch_items WHERE batch_id = ? AND item_key = ?
      `),
      startBatchItem: database.prepare(`
        UPDATE batch_items
        SET status = 'RUNNING', attempt_count = attempt_count + 1,
            started_at = @startedAt, completed_at = NULL, error_message = NULL
        WHERE batch_id = @batchId AND item_key = @itemKey
      `),
      completeBatchItem: database.prepare(`
        UPDATE batch_items
        SET status = @status, result_status = @resultStatus,
            discovery_run_id = @discoveryRunId, error_message = @errorMessage,
            completed_at = @completedAt
        WHERE batch_id = @batchId AND item_key = @itemKey
      `),
      deferBatchItem: database.prepare(`
        UPDATE batch_items
        SET status = 'DEFERRED', result_status = @resultStatus,
            retry_class = @retryClass, deferred_until = @deferredUntil,
            error_message = @errorMessage, completed_at = @completedAt
        WHERE batch_id = @batchId AND item_key = @itemKey
      `),
      completeBatch: database.prepare(`
        UPDATE batch_runs SET status = @status, completed_at = @completedAt
        WHERE id = @id
      `),
      upsertProviderCircuitState: database.prepare(`
        INSERT INTO provider_circuit_states (
          provider, state, reason_code, opened_at, next_probe_at,
          last_healthy_at, updated_at
        ) VALUES (
          @provider, @state, @reasonCode, @openedAt, @nextProbeAt,
          @lastHealthyAt, @updatedAt
        )
        ON CONFLICT(provider) DO UPDATE SET
          state = excluded.state,
          reason_code = excluded.reason_code,
          opened_at = excluded.opened_at,
          next_probe_at = excluded.next_probe_at,
          last_healthy_at = excluded.last_healthy_at,
          updated_at = excluded.updated_at
      `),
      providerCircuitState: database.prepare(`
        SELECT * FROM provider_circuit_states WHERE provider = ?
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
      const normalized = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();
      const incomingCanonicalNames = new Set([
        company.canonicalName,
        company.chineseName,
        company.englishName,
      ].map(normalized).filter(Boolean));
      const incomingAliases = new Set((company.aliases || []).map(normalized).filter(Boolean));
      const incomingDomains = new Set(
        (company.officialDomains || []).map(normalized).filter(Boolean),
      );
      const candidates = listCompanies().filter((item) => item.market === company.market);
      const matchGroups = [
        candidates.filter((item) => item.id === company.id),
        candidates.filter((item) => (
          item.officialDomains.some((domain) => incomingDomains.has(normalized(domain)))
        )),
        candidates.filter((item) => [
          item.canonicalName,
          item.chineseName,
          item.englishName,
        ].map(normalized).some((name) => incomingCanonicalNames.has(name))),
        candidates.filter((item) => {
          const itemAliases = new Set((item.aliases || []).map(normalized).filter(Boolean));
          const itemCanonicalNames = new Set([
            item.canonicalName,
            item.chineseName,
            item.englishName,
          ].map(normalized).filter(Boolean));
          return [...incomingAliases].some((alias) => itemAliases.has(alias))
            || [...incomingAliases].some((alias) => itemCanonicalNames.has(alias))
            || [...incomingCanonicalNames].some((name) => itemAliases.has(name));
        }),
      ].filter((group) => group.length > 0);
      const matchedIds = new Set(matchGroups.flat().map((item) => item.id));
      if (matchGroups.some((group) => new Set(group.map((item) => item.id)).size > 1)
        || matchedIds.size > 1) {
        const error = new Error('company merge conflict');
        error.code = 'COMPANY_MERGE_CONFLICT';
        throw error;
      }
      const mergeTarget = matchGroups[0]?.[0] || null;
      const targetId = mergeTarget?.id || company.id;
      const existing = statements.companyById.get(targetId);
      const industryTags = [
        ...new Set([
          ...decode(existing?.industry_tags_json, []),
          ...(company.industryTags || []),
        ]),
      ];
      statements.upsertCompany.run({
        id: targetId,
        canonicalName: mergeTarget?.canonicalName || company.canonicalName,
        chineseName: mergeTarget?.chineseName || company.chineseName || null,
        englishName: mergeTarget?.englishName || company.englishName || null,
        market: company.market,
        primaryOfficialDomain: company.primaryOfficialDomain ?? null,
        industryTagsJson: encode(industryTags, []),
        countryRegion: mergeTarget?.countryRegion || company.countryRegion || null,
        createdAt: mergeTarget?.createdAt || company.createdAt,
        updatedAt: company.updatedAt,
      });
      const aliases = [
        ...(company.aliases || []),
        ...(mergeTarget && normalized(company.canonicalName) !== normalized(mergeTarget.canonicalName)
          ? [company.canonicalName]
          : []),
      ];
      for (const alias of [...new Set(aliases)]) {
        statements.insertAlias.run(targetId, alias);
      }
      for (const domain of [...new Set(company.officialDomains || [])]) {
        statements.insertDomain.run(targetId, domain, company.market);
      }
      return listCompanies().find((item) => item.id === targetId);
    });
  }

  function upsertCareerPortal(portal) {
    requireMigration();
    return withTransaction(() => {
      const sourceTier = portal.sourceTier || (
        portal.atsType ? 'OFFICIAL_ATS' : 'OFFICIAL_SITE'
      );
      const officialIdentityConfirmed = (
        portal.officialIdentityConfirmed ?? portal.verificationStatus === 'VERIFIED'
      ) === true;
      const platformIdentityConfirmed = portal.platformIdentityConfirmed === true;
      const hiringAvailability = portal.hiringAvailability || 'UNKNOWN';
      const confidenceScore = Math.max(
        0,
        Math.min(100, Number(portal.confidenceScore) || 0),
      );
      if (!['OFFICIAL_SITE', 'OFFICIAL_ATS', 'PLATFORM_ONLY'].includes(sourceTier)) {
        throw new Error('unsupported CareerPortal sourceTier');
      }
      if (sourceTier === 'PLATFORM_ONLY') {
        if (portal.verificationStatus === 'VERIFIED') {
          throw new Error('PLATFORM_ONLY CareerPortal cannot be VERIFIED');
        }
        if (confidenceScore > 49) {
          throw new Error('PLATFORM_ONLY CareerPortal confidence cannot exceed 49');
        }
        if (officialIdentityConfirmed) {
          throw new Error('PLATFORM_ONLY CareerPortal cannot confirm official identity');
        }
        if (hiringAvailability === 'OPENINGS_FOUND' && !platformIdentityConfirmed) {
          throw new Error('PLATFORM_ONLY openings require confirmed platform identity');
        }
      } else if (portal.verificationStatus === 'VERIFIED' && !officialIdentityConfirmed) {
        throw new Error('VERIFIED CareerPortal requires confirmed official identity');
      }

      const existing = statements.portalIdentity.get(portal.id, portal.canonicalUrl);
      if (existing && existing.company_id !== portal.companyId) {
        throw new Error('CareerPortal canonical URL conflicts with another company');
      }
      if (existing && existing.id !== portal.id) {
        throw new Error('CareerPortal canonical URL already has a different stable id');
      }
      statements.upsertPortal.run({
        ...portal,
        atsType: portal.atsType || '',
        confidenceScore,
        sourceTier,
        officialIdentityConfirmed: officialIdentityConfirmed ? 1 : 0,
        platformIdentityConfirmed: platformIdentityConfirmed ? 1 : 0,
        hiringAvailability,
        fallbackReason: portal.fallbackReason ?? null,
        searchCoverage: portal.searchCoverage || 'PARTIAL',
        supersededByPortalId: portal.supersededByPortalId ?? null,
        recruitmentTypesJson: encode(portal.recruitmentTypes, []),
        lastVerifiedAt: portal.lastVerifiedAt ?? null,
        lastCheckedAt: portal.lastCheckedAt ?? null,
      });
      const validPlatformPortal = sourceTier === 'PLATFORM_ONLY'
        && platformIdentityConfirmed
        && hiringAvailability === 'OPENINGS_FOUND';
      if (portal.verificationStatus !== 'VERIFIED' && !validPlatformPortal) {
        statements.deletePortalOpenings.run(portal.id);
      }
      return portal;
    });
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

  function upsertRecruitmentEvent(event) {
    requireMigration();
    const portal = statements.portalStatus.get(event.careerPortalId);
    if (!portal) throw new Error('RecruitmentEvent requires a CareerPortal');
    if (portal.company_id !== event.companyId) {
      throw new Error('RecruitmentEvent company must match its CareerPortal');
    }

    const sourceTier = event.sourceTier || portal.source_tier || 'OFFICIAL_SITE';
    if (sourceTier !== portal.source_tier) {
      throw new Error('RecruitmentEvent sourceTier must match its CareerPortal');
    }
    if (sourceTier === 'PLATFORM_ONLY') {
      if (event.publicationClass !== 'PLATFORM_ONLY') {
        throw new Error('PLATFORM_ONLY RecruitmentEvent requires PLATFORM_ONLY publicationClass');
      }
      if (portal.platform_identity_confirmed !== 1) {
        throw new Error('PLATFORM_ONLY RecruitmentEvent requires confirmed platform identity');
      }
    } else if (portal.verification_status !== 'VERIFIED') {
      throw new Error('RecruitmentEvent requires a verified official CareerPortal');
    }

    statements.upsertRecruitmentEvent.run({
      ...event,
      sourceTier,
      cohort: event.cohort ?? null,
      campaignName: event.campaignName || '',
      startAt: event.startAt ?? null,
      closesAt: event.closesAt ?? null,
      locationsJson: encode(event.locations, []),
      publicationClass: event.publicationClass || 'UNKNOWN',
      lastVerifiedAt: event.lastVerifiedAt ?? null,
    });
    return event;
  }

  function requireOpeningEvent(opening, portal, expectedTier = null) {
    const eventId = opening.recruitmentEventId || null;
    if (!eventId) return null;
    const event = statements.recruitmentEventById.get(eventId);
    if (!event) throw new Error('JobOpening requires an existing RecruitmentEvent');
    if (event.company_id !== opening.companyId
      || event.career_portal_id !== opening.careerPortalId) {
      throw new Error('JobOpening must match its RecruitmentEvent');
    }
    if (expectedTier && event.source_tier !== expectedTier) {
      throw new Error(`JobOpening RecruitmentEvent must be ${expectedTier}`);
    }
    if (portal.company_id !== event.company_id) {
      throw new Error('JobOpening company must match its CareerPortal');
    }
    return event;
  }

  function writeOpening(opening, sourceTier) {
    statements.upsertOpening.run({
      ...opening,
      recruitmentEventId: opening.recruitmentEventId ?? null,
      sourceTier,
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

  function upsertJobOpening(opening) {
    requireMigration();
    const portal = statements.portalStatus.get(opening.careerPortalId);
    if (!portal || portal.verification_status !== 'VERIFIED'
      || portal.source_tier === 'PLATFORM_ONLY') {
      throw new Error('JobOpening requires a verified CareerPortal');
    }
    if (portal.company_id !== opening.companyId) {
      throw new Error('JobOpening company must match its CareerPortal');
    }
    const event = requireOpeningEvent(opening, portal);
    const sourceTier = event?.source_tier || portal.source_tier || 'OFFICIAL_SITE';
    if (sourceTier === 'PLATFORM_ONLY') {
      throw new Error('official JobOpening cannot use PLATFORM_ONLY source');
    }
    return writeOpening(opening, sourceTier);
  }

  function upsertPlatformJobOpening(opening) {
    requireMigration();
    const portal = statements.portalStatus.get(opening.careerPortalId);
    if (!portal || portal.source_tier !== 'PLATFORM_ONLY'
      || portal.platform_identity_confirmed !== 1
      || portal.hiring_availability !== 'OPENINGS_FOUND') {
      throw new Error('PLATFORM_ONLY JobOpening requires an eligible platform CareerPortal');
    }
    if (opening.sourceTier !== 'PLATFORM_ONLY') {
      throw new Error('PLATFORM_ONLY JobOpening must declare PLATFORM_ONLY sourceTier');
    }
    if (portal.company_id !== opening.companyId) {
      throw new Error('PLATFORM_ONLY JobOpening company must match its CareerPortal');
    }
    const event = requireOpeningEvent(opening, portal, 'PLATFORM_ONLY');
    if (!event || event.publication_class !== 'PLATFORM_ONLY') {
      throw new Error('PLATFORM_ONLY JobOpening requires a PLATFORM_ONLY RecruitmentEvent');
    }
    return writeOpening(opening, 'PLATFORM_ONLY');
  }

  function persistCompanySnapshot({
    company,
    portal,
    evidence = [],
    events = [],
    openings = [],
  } = {}) {
    requireMigration();
    return withTransaction(() => {
      const storedCompany = upsertCompany(company);
      const storedPortal = {
        ...portal,
        companyId: storedCompany.id,
      };
      upsertCareerPortal(storedPortal);
      replaceVerificationEvidence(storedPortal.id, evidence);
      for (const event of events) {
        upsertRecruitmentEvent({
          ...event,
          companyId: storedCompany.id,
          careerPortalId: storedPortal.id,
        });
      }
      for (const opening of openings) {
        const storedOpening = {
          ...opening,
          companyId: storedCompany.id,
          careerPortalId: storedPortal.id,
        };
        if (storedOpening.sourceTier === 'PLATFORM_ONLY') {
          upsertPlatformJobOpening(storedOpening);
        } else {
          upsertJobOpening(storedOpening);
        }
      }
      return storedCompany;
    });
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

  function listRecruitmentEvents() {
    requireMigration();
    return database.prepare(`
      SELECT * FROM recruitment_events
      ORDER BY company_id, recruitment_type, cohort, directory_url, id
    `).all().map(mapRecruitmentEvent);
  }

  function listJobOpenings() {
    requireMigration();
    return database.prepare(`
      SELECT jobs.*
      FROM job_openings AS jobs
      INNER JOIN career_portals AS portals ON portals.id = jobs.career_portal_id
      WHERE (
        jobs.source_tier IN ('OFFICIAL_SITE', 'OFFICIAL_ATS')
        AND portals.verification_status = 'VERIFIED'
      ) OR (
        jobs.source_tier = 'PLATFORM_ONLY'
        AND portals.source_tier = 'PLATFORM_ONLY'
        AND portals.platform_identity_confirmed = 1
        AND portals.hiring_availability = 'OPENINGS_FOUND'
      )
      ORDER BY jobs.title, jobs.id
    `).all().map(mapOpening);
  }

  function listDiscoveryLogs() {
    requireMigration();
    return database.prepare(`
      SELECT * FROM discovery_logs ORDER BY searched_at, id
    `).all().map(mapLog);
  }

  function recordLlmUsage(record) {
    requireMigration();
    statements.recordLlmUsage.run({
      ...record,
      runId: record.runId ?? null,
      cacheHit: record.cacheHit ? 1 : 0,
      inputTokens: record.inputTokens ?? null,
      outputTokens: record.outputTokens ?? null,
      costUsd: record.costUsd ?? null,
      status: record.status || 'SUCCESS',
      errorMessage: record.errorMessage ?? null,
    });
    return record;
  }

  function listLlmUsage() {
    requireMigration();
    return database.prepare(`
      SELECT * FROM llm_usage_logs ORDER BY created_at, id
    `).all().map((row) => ({
      id: row.id,
      runId: row.run_id,
      task: row.task,
      provider: row.provider,
      model: row.model,
      promptHash: row.prompt_hash,
      cacheHit: row.cache_hit === 1,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }));
  }

  function mapBatchItem(row) {
    return {
      batchId: row.batch_id,
      itemKey: row.item_key,
      position: row.position,
      input: decode(row.input_json, {}),
      status: row.status,
      resultStatus: row.result_status,
      attemptCount: row.attempt_count,
      discoveryRunId: row.discovery_run_id,
      errorMessage: row.error_message,
      retryClass: row.retry_class || null,
      deferredUntil: row.deferred_until || null,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  function beginBatch(batch) {
    requireMigration();
    const existing = statements.batchById.get(batch.id);
    if (existing && existing.input_hash !== batch.inputHash) {
      throw new Error('batch input hash mismatch');
    }
    statements.beginBatch.run(batch);
    return batch;
  }

  function ensureBatchItem(item) {
    requireMigration();
    statements.ensureBatchItem.run({
      ...item,
      inputJson: encode(item.input, {}),
    });
    return mapBatchItem(statements.batchItem.get(item.batchId, item.itemKey));
  }

  function startBatchItem(item) {
    requireMigration();
    statements.startBatchItem.run(item);
    return mapBatchItem(statements.batchItem.get(item.batchId, item.itemKey));
  }

  function completeBatchItem(item) {
    requireMigration();
    statements.completeBatchItem.run({
      ...item,
      discoveryRunId: item.discoveryRunId ?? null,
      errorMessage: item.errorMessage ?? null,
    });
    return mapBatchItem(statements.batchItem.get(item.batchId, item.itemKey));
  }

  function deferBatchItem(item) {
    requireMigration();
    const result = statements.deferBatchItem.run({
      ...item,
      resultStatus: item.resultStatus || 'BLOCKED',
      retryClass: item.retryClass || 'PROVIDER_BLOCKED',
      deferredUntil: item.deferredUntil ?? null,
      errorMessage: item.errorMessage ?? null,
    });
    if (result.changes !== 1) {
      throw new Error(`unknown batch item: ${item.batchId}/${item.itemKey}`);
    }
    return mapBatchItem(statements.batchItem.get(item.batchId, item.itemKey));
  }

  function listBatchItems(batchId) {
    requireMigration();
    return database.prepare(`
      SELECT * FROM batch_items WHERE batch_id = ? ORDER BY position, item_key
    `).all(batchId).map(mapBatchItem);
  }

  function completeBatch(batch) {
    requireMigration();
    statements.completeBatch.run(batch);
    return batch;
  }

  function getProviderCircuitState(provider) {
    requireMigration();
    return mapProviderCircuitState(statements.providerCircuitState.get(provider));
  }

  function saveProviderCircuitState(record) {
    requireMigration();
    statements.upsertProviderCircuitState.run({
      ...record,
      reasonCode: record.reasonCode ?? null,
      openedAt: record.openedAt ?? null,
      nextProbeAt: record.nextProbeAt ?? null,
      lastHealthyAt: record.lastHealthyAt ?? null,
    });
    return getProviderCircuitState(record.provider);
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
    upsertRecruitmentEvent,
    upsertJobOpening,
    upsertPlatformJobOpening,
    persistCompanySnapshot,
    appendDiscoveryLog,
    listCompanies,
    listCareerPortals,
    listRecruitmentEvents,
    listJobOpenings,
    listDiscoveryLogs,
    recordLlmUsage,
    listLlmUsage,
    beginBatch,
    ensureBatchItem,
    startBatchItem,
    completeBatchItem,
    deferBatchItem,
    listBatchItems,
    completeBatch,
    getProviderCircuitState,
    saveProviderCircuitState,
    close,
  };

  return assertMarketDiscoveryRepository(repository);
}
