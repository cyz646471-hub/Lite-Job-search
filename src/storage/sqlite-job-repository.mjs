import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { createJobOpening } from '../domain/job-opening.mjs';
import { createRecruitmentEvent } from '../domain/recruitment-event.mjs';
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
    openedReason: row.opened_reason || row.reason_code || null,
    openedAt: row.opened_at || null,
    openUntil: row.open_until || null,
    nextProbeAt: row.next_probe_at || null,
    lastHealthyAt: row.last_healthy_at || null,
    manualActionRequired: row.manual_action_required === 1,
    manualAcknowledgedAt: row.manual_acknowledged_at || null,
    probeOwnerId: row.probe_owner_id || null,
    probeLeaseUntil: row.probe_lease_until || null,
    lastProbeAt: row.last_probe_at || null,
    lastSuccessAt: row.last_success_at || row.last_healthy_at || null,
    consecutiveFailures: Number(row.consecutive_failures) || 0,
    version: Number(row.version) || 0,
    updatedAt: row.updated_at,
  };
}

function mapWorkerInstance(row) {
  if (!row) return null;
  return {
    instanceId: row.instance_id,
    batchId: row.batch_id,
    profileKey: row.profile_key,
    hostName: row.host_name,
    pid: row.pid,
    processStartToken: row.process_start_token,
    state: row.state,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    currentCompanyId: row.current_company_id || null,
    lastCompletedCompanyId: row.last_completed_company_id || null,
    stopRequestedAt: row.stop_requested_at || null,
    exitedAt: row.exited_at || null,
    exitCode: row.exit_code,
    lastError: row.last_error || null,
  };
}

function mapControlTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id,
    location: row.location || null,
    roleKeywords: decode(row.role_keywords_json, []),
    industry: row.industry || null,
    absoluteDateFrom: row.absolute_date_from,
    absoluteDateTo: row.absolute_date_to,
    targetCount: row.target_count,
    selectionMode: row.selection_mode,
    targetUnit: row.target_unit,
    allowBaiduFallback: row.allow_baidu_fallback === 1,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWebKnowledge(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    knowledgeType: row.knowledge_type,
    value: row.value,
    verificationStatus: row.verification_status,
    evidenceSource: row.evidence_source,
    firstSeenAt: row.first_seen_at,
    lastVerifiedAt: row.last_verified_at || null,
    expiresAt: row.expires_at || null,
    rejectionReason: row.rejection_reason || null,
  };
}

function mapSearchCache(row) {
  if (!row) return null;
  return {
    cacheKey: row.cache_key,
    engine: row.engine,
    normalizedQuery: row.normalized_query,
    locale: row.locale,
    absoluteDateFrom: row.absolute_date_from || null,
    absoluteDateTo: row.absolute_date_to || null,
    strategyVersion: row.strategy_version,
    outcome: row.outcome,
    result: decode(row.result_json, {}),
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
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
        VALUES (@id, @inputHash, @status, @startedAt)
        ON CONFLICT(id) DO UPDATE SET
          status = @status,
          completed_at = NULL
      `),
      batchById: database.prepare(`
        SELECT input_hash FROM batch_runs WHERE id = ?
      `),
      ensureBatchItem: database.prepare(`
        INSERT OR IGNORE INTO batch_items (
          batch_id, item_key, position, input_json, status, queue_type, created_at
        ) VALUES (
          @batchId, @itemKey, @position, @inputJson, 'PENDING', @queueType, @createdAt
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
            defer_reason = @deferReason, error_message = @errorMessage,
            completed_at = @completedAt
        WHERE batch_id = @batchId AND item_key = @itemKey
      `),
      completeBatch: database.prepare(`
        UPDATE batch_runs SET status = @status, completed_at = @completedAt
        WHERE id = @id
      `),
      upsertProviderCircuitState: database.prepare(`
        INSERT INTO provider_circuit_states (
          provider, state, reason_code, opened_at, next_probe_at,
          last_healthy_at, updated_at, opened_reason, open_until,
          manual_action_required, manual_acknowledged_at, probe_owner_id,
          probe_lease_until, last_probe_at, last_success_at,
          consecutive_failures, version
        ) VALUES (
          @provider, @state, @reasonCode, @openedAt, @nextProbeAt,
          @lastHealthyAt, @updatedAt, @openedReason, @openUntil,
          @manualActionRequired, @manualAcknowledgedAt, @probeOwnerId,
          @probeLeaseUntil, @lastProbeAt, @lastSuccessAt,
          @consecutiveFailures, @version
        )
        ON CONFLICT(provider) DO UPDATE SET
          state = excluded.state,
          reason_code = excluded.reason_code,
          opened_at = excluded.opened_at,
          next_probe_at = excluded.next_probe_at,
          last_healthy_at = excluded.last_healthy_at,
          opened_reason = excluded.opened_reason,
          open_until = excluded.open_until,
          manual_action_required = excluded.manual_action_required,
          manual_acknowledged_at = excluded.manual_acknowledged_at,
          probe_owner_id = excluded.probe_owner_id,
          probe_lease_until = excluded.probe_lease_until,
          last_probe_at = excluded.last_probe_at,
          last_success_at = excluded.last_success_at,
          consecutive_failures = excluded.consecutive_failures,
          version = excluded.version,
          updated_at = excluded.updated_at
      `),
      providerCircuitState: database.prepare(`
        SELECT * FROM provider_circuit_states WHERE provider = ?
      `),
      batchById: database.prepare('SELECT * FROM batch_runs WHERE id = ?'),
      requestBatchStop: database.prepare(`
        UPDATE batch_runs SET stop_requested_at = @requestedAt, status = 'STOP_REQUESTED'
        WHERE id = @batchId
      `),
      resumeBatch: database.prepare(`
        UPDATE batch_runs
        SET stop_requested_at = NULL, resumed_at = @resumedAt, status = 'PENDING',
            completed_at = NULL
        WHERE id = @batchId
      `),
      registerWorker: database.prepare(`
        INSERT INTO worker_instances (
          instance_id, batch_id, profile_key, host_name, pid, process_start_token,
          state, started_at, heartbeat_at, current_company_id,
          last_completed_company_id, stop_requested_at, exited_at, exit_code,
          last_error
        ) VALUES (
          @instanceId, @batchId, @profileKey, @hostName, @pid, @processStartToken,
          @state, @startedAt, @heartbeatAt, @currentCompanyId,
          @lastCompletedCompanyId, NULL, NULL, NULL, NULL
        )
        ON CONFLICT(instance_id) DO UPDATE SET
          state = excluded.state,
          heartbeat_at = excluded.heartbeat_at,
          current_company_id = excluded.current_company_id,
          last_completed_company_id = excluded.last_completed_company_id
      `),
      heartbeatWorker: database.prepare(`
        UPDATE worker_instances
        SET state = @state, heartbeat_at = @heartbeatAt,
            current_company_id = @currentCompanyId,
            last_completed_company_id = COALESCE(
              @lastCompletedCompanyId, last_completed_company_id
            ),
            last_error = @lastError
        WHERE instance_id = @instanceId
      `),
      requestWorkerStop: database.prepare(`
        UPDATE worker_instances
        SET stop_requested_at = @requestedAt, state = 'STOP_REQUESTED'
        WHERE instance_id = @instanceId AND state NOT IN ('EXITED', 'CRASHED')
      `),
      exitWorker: database.prepare(`
        UPDATE worker_instances
        SET state = @state, heartbeat_at = @exitedAt, exited_at = @exitedAt,
            exit_code = @exitCode, last_error = @lastError,
            current_company_id = NULL
        WHERE instance_id = @instanceId
      `),
      workerById: database.prepare(`
        SELECT * FROM worker_instances WHERE instance_id = ?
      `),
      profileLockByKey: database.prepare(`
        SELECT * FROM profile_locks WHERE profile_key = ?
      `),
      upsertProfileLock: database.prepare(`
        INSERT INTO profile_locks (
          profile_key, lock_id, instance_id, batch_id, profile_real_path,
          host_name, pid, process_start_token, started_at, heartbeat_at
        ) VALUES (
          @profileKey, @lockId, @instanceId, @batchId, @profileRealPath,
          @hostName, @pid, @processStartToken, @startedAt, @heartbeatAt
        )
        ON CONFLICT(profile_key) DO UPDATE SET
          lock_id = excluded.lock_id,
          instance_id = excluded.instance_id,
          batch_id = excluded.batch_id,
          profile_real_path = excluded.profile_real_path,
          host_name = excluded.host_name,
          pid = excluded.pid,
          process_start_token = excluded.process_start_token,
          started_at = excluded.started_at,
          heartbeat_at = excluded.heartbeat_at
      `),
      deleteProfileLock: database.prepare(`
        DELETE FROM profile_locks WHERE profile_key = @profileKey AND lock_id = @lockId
      `),
      upsertWebKnowledge: database.prepare(`
        INSERT INTO company_web_knowledge (
          id, company_id, knowledge_type, value, verification_status,
          evidence_source, first_seen_at, last_verified_at, expires_at,
          rejection_reason
        ) VALUES (
          @id, @companyId, @knowledgeType, @value, @verificationStatus,
          @evidenceSource, @firstSeenAt, @lastVerifiedAt, @expiresAt,
          @rejectionReason
        )
        ON CONFLICT(company_id, knowledge_type, value) DO UPDATE SET
          verification_status = excluded.verification_status,
          evidence_source = excluded.evidence_source,
          last_verified_at = excluded.last_verified_at,
          expires_at = excluded.expires_at,
          rejection_reason = excluded.rejection_reason
      `),
      searchCacheByKey: database.prepare(`
        SELECT * FROM search_cache WHERE cache_key = ?
      `),
      upsertSearchCache: database.prepare(`
        INSERT INTO search_cache (
          cache_key, engine, normalized_query, locale, absolute_date_from,
          absolute_date_to, strategy_version, outcome, result_json,
          created_at, expires_at
        ) VALUES (
          @cacheKey, @engine, @normalizedQuery, @locale, @absoluteDateFrom,
          @absoluteDateTo, @strategyVersion, @outcome, @resultJson,
          @createdAt, @expiresAt
        )
        ON CONFLICT(cache_key) DO UPDATE SET
          outcome = excluded.outcome,
          result_json = excluded.result_json,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `),
      createControlTask: database.prepare(`
        INSERT INTO control_tasks (
          id, batch_id, location, role_keywords_json, industry,
          absolute_date_from, absolute_date_to, target_count,
          selection_mode, target_unit, allow_baidu_fallback, state,
          created_at, updated_at
        ) VALUES (
          @id, @batchId, @location, @roleKeywordsJson, @industry,
          @absoluteDateFrom, @absoluteDateTo, @targetCount,
          @selectionMode, @targetUnit, @allowBaiduFallback, @state,
          @createdAt, @updatedAt
        )
      `),
      appendAuditLog: database.prepare(`
        INSERT INTO audit_logs (
          id, action, target_type, target_id, actor, details_json, created_at
        ) VALUES (
          @id, @action, @targetType, @targetId, @actor, @detailsJson, @createdAt
        )
      `),
      supersedePlatformPortals: database.prepare(`
        UPDATE career_portals
        SET superseded_by_portal_id = @officialPortalId
        WHERE company_id = @companyId
          AND source_tier = 'PLATFORM_ONLY'
          AND id != @officialPortalId
          AND (
            superseded_by_portal_id IS NULL
            OR superseded_by_portal_id != @officialPortalId
          )
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
      if (!company?.id || !portal?.id || portal.companyId !== company.id) {
        throw new Error('snapshot portal company must match snapshot company');
      }
      for (const event of events) {
        if (event.companyId !== company.id || event.careerPortalId !== portal.id) {
          throw new Error('snapshot RecruitmentEvent company and portal must match');
        }
      }
      const eventIds = new Set(events.map((event) => event.id));
      for (const opening of openings) {
        if (opening.companyId !== company.id || opening.careerPortalId !== portal.id) {
          throw new Error('snapshot JobOpening company and portal must match');
        }
        if (opening.recruitmentEventId
          && !eventIds.has(opening.recruitmentEventId)) {
          throw new Error('snapshot JobOpening RecruitmentEvent is missing');
        }
      }

      const storedCompany = upsertCompany(company);
      const storedPortal = {
        ...portal,
        companyId: storedCompany.id,
      };
      upsertCareerPortal(storedPortal);
      replaceVerificationEvidence(storedPortal.id, evidence);
      const eventIdMap = new Map();
      const normalizedEvents = [];
      for (const event of events) {
        const normalizedEvent = createRecruitmentEvent({
          ...event,
          id: storedCompany.id === company.id ? event.id : undefined,
          companyId: storedCompany.id,
          careerPortalId: storedPortal.id,
        });
        eventIdMap.set(event.id, normalizedEvent.id);
        normalizedEvents.push(normalizedEvent);
        upsertRecruitmentEvent(normalizedEvent);
      }
      for (const opening of openings) {
        const recruitmentEventId = opening.recruitmentEventId
          ? eventIdMap.get(opening.recruitmentEventId)
          : null;
        const identityChanged = storedCompany.id !== company.id
          || recruitmentEventId !== opening.recruitmentEventId;
        const storedOpening = createJobOpening({
          ...opening,
          id: identityChanged ? undefined : opening.id,
          companyId: storedCompany.id,
          careerPortalId: storedPortal.id,
          recruitmentEventId,
          sourceTier: opening.sourceTier || storedPortal.sourceTier,
        });
        if (storedOpening.sourceTier === 'PLATFORM_ONLY') {
          upsertPlatformJobOpening(storedOpening);
        } else {
          upsertJobOpening(storedOpening);
        }
      }
      if (storedPortal.sourceTier !== 'PLATFORM_ONLY' && normalizedEvents.length > 0) {
        statements.supersedePlatformPortals.run({
          companyId: storedCompany.id,
          officialPortalId: storedPortal.id,
        });
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
      queueType: row.queue_type || 'LOCAL_OR_DIRECT_VERIFICATION',
      deferReason: row.defer_reason || null,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  function beginBatch(batch) {
    requireMigration();
    let existing = statements.batchById.get(batch.id);
    if (
      existing
      && existing.input_hash !== batch.inputHash
      && String(existing.input_hash).startsWith('UNMATERIALIZED:')
    ) {
      database.prepare(`
        UPDATE batch_runs SET input_hash = ? WHERE id = ? AND input_hash = ?
      `).run(batch.inputHash, batch.id, existing.input_hash);
      existing = statements.batchById.get(batch.id);
    }
    if (existing && existing.input_hash !== batch.inputHash) {
      throw new Error('batch input hash mismatch');
    }
    statements.beginBatch.run({
      ...batch,
      status: batch.status || 'RUNNING',
    });
    return batch;
  }

  function ensureBatchItem(item) {
    requireMigration();
    statements.ensureBatchItem.run({
      ...item,
      inputJson: encode(item.input, {}),
      queueType: item.queueType || item.input?.queueType || 'LOCAL_OR_DIRECT_VERIFICATION',
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
      deferReason: item.deferReason ?? item.retryClass ?? null,
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

  function listDeferredBatchItems() {
    requireMigration();
    return database.prepare(`
      SELECT * FROM batch_items
      WHERE status = 'DEFERRED'
      ORDER BY batch_id, position, item_key
    `).all().map(mapBatchItem);
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
      openedReason: record.openedReason ?? record.reasonCode ?? null,
      openedAt: record.openedAt ?? null,
      openUntil: record.openUntil ?? null,
      nextProbeAt: record.nextProbeAt ?? null,
      lastHealthyAt: record.lastHealthyAt ?? null,
      manualActionRequired: record.manualActionRequired ? 1 : 0,
      manualAcknowledgedAt: record.manualAcknowledgedAt ?? null,
      probeOwnerId: record.probeOwnerId ?? null,
      probeLeaseUntil: record.probeLeaseUntil ?? null,
      lastProbeAt: record.lastProbeAt ?? null,
      lastSuccessAt: record.lastSuccessAt ?? record.lastHealthyAt ?? null,
      consecutiveFailures: Number(record.consecutiveFailures) || 0,
      version: Number(record.version) || 0,
    });
    return getProviderCircuitState(record.provider);
  }

  function listProviderCircuitStates() {
    requireMigration();
    return database.prepare(`
      SELECT * FROM provider_circuit_states ORDER BY provider
    `).all().map(mapProviderCircuitState);
  }

  function acknowledgeProviderCircuit({ provider, acknowledgedAt }) {
    requireMigration();
    return withTransaction(() => {
      const current = getProviderCircuitState(provider);
      if (!current || current.state !== 'OPEN') {
        throw new Error('provider circuit must be OPEN before manual acknowledgement');
      }
      database.prepare(`
        UPDATE provider_circuit_states
        SET manual_acknowledged_at = ?, updated_at = ?, version = version + 1
        WHERE provider = ? AND state = 'OPEN'
      `).run(acknowledgedAt, acknowledgedAt, provider);
      return getProviderCircuitState(provider);
    });
  }

  function acquireProviderProbeLease({
    provider,
    ownerId,
    acquiredAt,
    leaseUntil,
  }) {
    requireMigration();
    return withTransaction(() => {
      let current = getProviderCircuitState(provider);
      if (
        current?.state === 'HALF_OPEN'
        && current.probeLeaseUntil
        && current.probeLeaseUntil <= acquiredAt
      ) {
        database.prepare(`
          UPDATE provider_circuit_states
          SET state = 'OPEN', probe_owner_id = NULL, probe_lease_until = NULL,
              updated_at = ?, version = version + 1
          WHERE provider = ? AND state = 'HALF_OPEN' AND probe_lease_until <= ?
        `).run(acquiredAt, provider, acquiredAt);
        current = getProviderCircuitState(provider);
      }
      if (!current || current.state !== 'OPEN' || !current.manualAcknowledgedAt) return null;
      const result = database.prepare(`
        UPDATE provider_circuit_states
        SET state = 'HALF_OPEN', probe_owner_id = @ownerId,
            probe_lease_until = @leaseUntil, last_probe_at = @acquiredAt,
            updated_at = @acquiredAt, version = version + 1
        WHERE provider = @provider AND state = 'OPEN'
          AND manual_acknowledged_at IS NOT NULL
      `).run({ provider, ownerId, acquiredAt, leaseUntil });
      return result.changes === 1 ? getProviderCircuitState(provider) : null;
    });
  }

  function completeProviderProbe({
    provider,
    ownerId,
    healthy,
    reasonCode = null,
    completedAt,
  }) {
    requireMigration();
    return withTransaction(() => {
      const current = getProviderCircuitState(provider);
      if (!current || current.state !== 'HALF_OPEN' || current.probeOwnerId !== ownerId) {
        throw new Error('provider probe lease is not owned by this worker');
      }
      const nextState = healthy ? 'CLOSED' : 'OPEN';
      database.prepare(`
        UPDATE provider_circuit_states
        SET state = @nextState,
            reason_code = @reasonCode,
            opened_reason = @reasonCode,
            opened_at = CASE WHEN @healthy = 1 THEN NULL ELSE COALESCE(opened_at, @completedAt) END,
            manual_action_required = CASE WHEN @healthy = 1 THEN 0 ELSE 1 END,
            manual_acknowledged_at = NULL,
            probe_owner_id = NULL,
            probe_lease_until = NULL,
            last_success_at = CASE WHEN @healthy = 1 THEN @completedAt ELSE last_success_at END,
            last_healthy_at = CASE WHEN @healthy = 1 THEN @completedAt ELSE last_healthy_at END,
            consecutive_failures = CASE WHEN @healthy = 1 THEN 0 ELSE consecutive_failures + 1 END,
            updated_at = @completedAt,
            version = version + 1
        WHERE provider = @provider AND state = 'HALF_OPEN' AND probe_owner_id = @ownerId
      `).run({
        provider,
        ownerId,
        healthy: healthy ? 1 : 0,
        nextState,
        reasonCode: healthy ? null : (reasonCode || 'health_probe_failed'),
        completedAt,
      });
      return getProviderCircuitState(provider);
    });
  }

  function getBatchRun(batchId) {
    requireMigration();
    const row = statements.batchById.get(batchId);
    return row ? {
      id: row.id,
      inputHash: row.input_hash,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at || null,
      stopRequestedAt: row.stop_requested_at || null,
      resumedAt: row.resumed_at || null,
    } : null;
  }

  function listBatchRuns() {
    requireMigration();
    return database.prepare(`
      SELECT * FROM batch_runs ORDER BY started_at DESC, id
    `).all().map((row) => ({
      id: row.id,
      inputHash: row.input_hash,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at || null,
      stopRequestedAt: row.stop_requested_at || null,
      resumedAt: row.resumed_at || null,
    }));
  }

  function requestBatchStop({ batchId, requestedAt }) {
    requireMigration();
    if (statements.requestBatchStop.run({ batchId, requestedAt }).changes !== 1) {
      throw new Error(`unknown batch: ${batchId}`);
    }
    database.prepare(`
      UPDATE control_tasks SET state = 'STOP_REQUESTED', updated_at = ?
      WHERE batch_id = ?
    `).run(requestedAt, batchId);
    return getBatchRun(batchId);
  }

  function resumeBatch({ batchId, resumedAt }) {
    requireMigration();
    if (statements.resumeBatch.run({ batchId, resumedAt }).changes !== 1) {
      throw new Error(`unknown batch: ${batchId}`);
    }
    database.prepare(`
      UPDATE control_tasks SET state = 'PENDING', updated_at = ?
      WHERE batch_id = ?
    `).run(resumedAt, batchId);
    return getBatchRun(batchId);
  }

  function isBatchStopRequested(batchId) {
    return Boolean(getBatchRun(batchId)?.stopRequestedAt);
  }

  function registerWorker(record) {
    requireMigration();
    statements.registerWorker.run({
      ...record,
      state: record.state || 'STARTING',
      currentCompanyId: record.currentCompanyId ?? null,
      lastCompletedCompanyId: record.lastCompletedCompanyId ?? null,
    });
    return statements.workerById.get(record.instanceId)
      ? mapWorkerInstance(statements.workerById.get(record.instanceId))
      : null;
  }

  function heartbeatWorker(record) {
    requireMigration();
    const current = statements.workerById.get(record.instanceId);
    if (!current) throw new Error(`unknown worker: ${record.instanceId}`);
    statements.heartbeatWorker.run({
      instanceId: record.instanceId,
      state: record.state || current.state,
      heartbeatAt: record.heartbeatAt,
      currentCompanyId: record.currentCompanyId ?? null,
      lastCompletedCompanyId: record.lastCompletedCompanyId ?? null,
      lastError: record.lastError ?? null,
    });
    return mapWorkerInstance(statements.workerById.get(record.instanceId));
  }

  function requestWorkerStop({ instanceId, requestedAt }) {
    requireMigration();
    if (statements.requestWorkerStop.run({ instanceId, requestedAt }).changes !== 1) {
      throw new Error(`worker cannot be stopped: ${instanceId}`);
    }
    return mapWorkerInstance(statements.workerById.get(instanceId));
  }

  function exitWorker(record) {
    requireMigration();
    if (statements.exitWorker.run({
      instanceId: record.instanceId,
      state: record.state || (record.exitCode === 0 ? 'EXITED' : 'CRASHED'),
      exitedAt: record.exitedAt,
      exitCode: record.exitCode ?? null,
      lastError: record.lastError ?? null,
    }).changes !== 1) {
      throw new Error(`unknown worker: ${record.instanceId}`);
    }
    return mapWorkerInstance(statements.workerById.get(record.instanceId));
  }

  function getWorkerInstance(instanceId) {
    requireMigration();
    return mapWorkerInstance(statements.workerById.get(instanceId));
  }

  function listWorkerInstances() {
    requireMigration();
    return database.prepare(`
      SELECT * FROM worker_instances ORDER BY started_at DESC, instance_id
    `).all().map(mapWorkerInstance);
  }

  function saveProfileLock(record) {
    requireMigration();
    statements.upsertProfileLock.run(record);
    return getProfileLock(record.profileKey);
  }

  function getProfileLock(profileKey) {
    requireMigration();
    const row = statements.profileLockByKey.get(profileKey);
    return row ? {
      profileKey: row.profile_key,
      lockId: row.lock_id,
      instanceId: row.instance_id,
      batchId: row.batch_id,
      profileRealPath: row.profile_real_path,
      hostName: row.host_name,
      pid: row.pid,
      processStartToken: row.process_start_token,
      startedAt: row.started_at,
      heartbeatAt: row.heartbeat_at,
    } : null;
  }

  function releaseProfileLock({ profileKey, lockId }) {
    requireMigration();
    return statements.deleteProfileLock.run({ profileKey, lockId }).changes === 1;
  }

  function upsertCompanyWebKnowledge(record) {
    requireMigration();
    statements.upsertWebKnowledge.run({
      ...record,
      lastVerifiedAt: record.lastVerifiedAt ?? null,
      expiresAt: record.expiresAt ?? null,
      rejectionReason: record.rejectionReason ?? null,
    });
    return mapWebKnowledge(database.prepare(`
      SELECT * FROM company_web_knowledge
      WHERE company_id = ? AND knowledge_type = ? AND value = ?
    `).get(record.companyId, record.knowledgeType, record.value));
  }

  function listCompanyWebKnowledge(companyId = null) {
    requireMigration();
    const rows = companyId
      ? database.prepare(`
          SELECT * FROM company_web_knowledge
          WHERE company_id = ? ORDER BY knowledge_type, value
        `).all(companyId)
      : database.prepare(`
          SELECT * FROM company_web_knowledge
          ORDER BY company_id, knowledge_type, value
        `).all();
    return rows.map(mapWebKnowledge);
  }

  function putSearchCache(record) {
    requireMigration();
    statements.upsertSearchCache.run({
      ...record,
      absoluteDateFrom: record.absoluteDateFrom ?? null,
      absoluteDateTo: record.absoluteDateTo ?? null,
      resultJson: encode(record.result, {}),
      expiresAt: record.expiresAt ?? null,
    });
    return mapSearchCache(statements.searchCacheByKey.get(record.cacheKey));
  }

  function getReusableSearchCache(cacheKey, at = new Date().toISOString()) {
    requireMigration();
    const cached = mapSearchCache(statements.searchCacheByKey.get(cacheKey));
    if (!cached || !['SUCCESS', 'VERIFIED_NO_RESULTS'].includes(cached.outcome)) return null;
    if (cached.expiresAt && cached.expiresAt <= at) return null;
    return cached;
  }

  function createControlTask(record) {
    requireMigration();
    statements.createControlTask.run({
      ...record,
      location: record.location ?? null,
      roleKeywordsJson: encode(record.roleKeywords, []),
      industry: record.industry ?? null,
      allowBaiduFallback: record.allowBaiduFallback ? 1 : 0,
      state: record.state || 'PENDING',
    });
    return getControlTask(record.id);
  }

  function getControlTask(id) {
    requireMigration();
    return mapControlTask(database.prepare(`
      SELECT * FROM control_tasks WHERE id = ?
    `).get(id));
  }

  function listControlTasks() {
    requireMigration();
    return database.prepare(`
      SELECT * FROM control_tasks ORDER BY created_at DESC, id
    `).all().map(mapControlTask);
  }

  function updateControlTaskState({ id, state, updatedAt }) {
    requireMigration();
    const result = database.prepare(`
      UPDATE control_tasks SET state = ?, updated_at = ? WHERE id = ?
    `).run(state, updatedAt, id);
    if (result.changes !== 1) throw new Error(`unknown control task: ${id}`);
    return getControlTask(id);
  }

  function appendAuditLog(record) {
    requireMigration();
    statements.appendAuditLog.run({
      ...record,
      detailsJson: encode(record.details, {}),
    });
    return record;
  }

  function listAuditLogs({ targetType = null, targetId = null } = {}) {
    requireMigration();
    const rows = targetType && targetId
      ? database.prepare(`
          SELECT * FROM audit_logs
          WHERE target_type = ? AND target_id = ?
          ORDER BY created_at DESC
        `).all(targetType, targetId)
      : database.prepare(`
          SELECT * FROM audit_logs ORDER BY created_at DESC
        `).all();
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      actor: row.actor,
      details: decode(row.details_json, {}),
      createdAt: row.created_at,
    }));
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
    listDeferredBatchItems,
    completeBatch,
    getProviderCircuitState,
    saveProviderCircuitState,
    listProviderCircuitStates,
    acknowledgeProviderCircuit,
    acquireProviderProbeLease,
    completeProviderProbe,
    getBatchRun,
    listBatchRuns,
    requestBatchStop,
    resumeBatch,
    isBatchStopRequested,
    registerWorker,
    heartbeatWorker,
    requestWorkerStop,
    exitWorker,
    getWorkerInstance,
    listWorkerInstances,
    saveProfileLock,
    getProfileLock,
    releaseProfileLock,
    upsertCompanyWebKnowledge,
    listCompanyWebKnowledge,
    putSearchCache,
    getReusableSearchCache,
    createControlTask,
    getControlTask,
    listControlTasks,
    updateControlTaskState,
    appendAuditLog,
    listAuditLogs,
    close,
  };

  return assertMarketDiscoveryRepository(repository);
}
