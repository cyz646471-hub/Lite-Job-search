import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { canonicalRecruitmentUrl } from '../core/canonical-recruitment-url.mjs';

import { createJobAssignment } from '../domain/job-assignment.mjs';
import { createJobRevision } from '../domain/job-revision.mjs';
import { createJobOpening } from '../domain/job-opening.mjs';
import { evaluateJobPublication } from '../domain/job-publication.mjs';
import { createFetchObservation } from '../domain/fetch-observation.mjs';
import { createMonitorPolicy, deriveMonitorSchedule } from '../domain/monitor-policy.mjs';
import { createPageSnapshot } from '../domain/page-snapshot.mjs';
import { createRecruitmentEvent } from '../domain/recruitment-event.mjs';
import { createReviewTask } from '../domain/review-task.mjs';
import { createSourceEndpoint } from '../domain/source-endpoint.mjs';
import { createUserAction } from '../domain/user-action.mjs';
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
    channelType: row.channel_type || (row.ats_type ? 'ATS' : 'WEB_PORTAL'),
    officialAccountName: row.official_account_name || null,
    officialAccountId: row.official_account_id || null,
    verifiedSubject: row.verified_subject || null,
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
    qualityGrade: row.quality_grade || 'C',
    publicationStatus: row.publication_status || 'CANDIDATE',
    qualityReasons: decode(row.quality_reasons_json, []),
    applicationVerifiedAt: row.application_verified_at || null,
    dedupeFingerprint: row.dedupe_fingerprint || null,
    consecutiveMissingCount: Number(row.consecutive_missing_count) || 0,
    lastPresentAt: row.last_present_at || row.last_seen_at,
    closedEvidence: decode(row.closed_evidence_json, []),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function mapReviewTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    reviewType: row.review_type,
    targetType: row.target_type,
    targetId: row.target_id,
    status: row.status,
    systemDecision: row.system_decision || null,
    aiAdvice: row.ai_advice || null,
    reviewer: row.reviewer || null,
    result: row.result || null,
    structuredChanges: decode(row.structured_changes_json, {}),
    reasonCodes: decode(row.reason_codes_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at || null,
  };
}

function mapJobAssignment(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    assigneeType: row.assignee_type,
    assigneeId: row.assignee_id,
    assignedBy: row.assigned_by,
    status: row.status,
    note: row.note || null,
    assignedAt: row.assigned_at,
    updatedAt: row.updated_at,
  };
}

function mapUserAction(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorId: row.actor_id,
    studentId: row.student_id || null,
    jobId: row.job_id || null,
    actionType: row.action_type,
    note: row.note || null,
    triggersReverification: row.triggers_reverification === 1,
    createdAt: row.created_at,
  };
}

function mapSourceEndpoint(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    careerPortalId: row.career_portal_id || null,
    url: row.url,
    canonicalUrl: row.canonical_url,
    endpointKind: row.endpoint_kind,
    transport: row.transport,
    adapterType: row.adapter_type || null,
    state: row.state,
    intervalHours: Number(row.interval_hours),
    etag: row.etag || null,
    lastModified: row.last_modified || null,
    contentHash: row.content_hash || null,
    structureHash: row.structure_hash || null,
    lastCheckedAt: row.last_checked_at || null,
    lastSuccessAt: row.last_success_at || null,
    lastFailureAt: row.last_failure_at || null,
    lastFailureReason: row.last_failure_reason || null,
    lastHttpStatus: row.last_http_status,
    nextCheckAt: row.next_check_at || null,
    consecutiveFailures: Number(row.consecutive_failures) || 0,
    metadata: decode(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPageSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceEndpointId: row.source_endpoint_id,
    observationId: row.observation_id,
    capturedAt: row.captured_at,
    finalUrl: row.final_url || null,
    contentType: row.content_type || null,
    bodyPath: row.body_path,
    bodyBytes: Number(row.body_bytes) || 0,
    contentHash: row.content_hash,
    structureHash: row.structure_hash || null,
    metadata: decode(row.metadata_json, {}),
  };
}

function mapFetchObservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceEndpointId: row.source_endpoint_id,
    runId: row.run_id || null,
    fetchedAt: row.fetched_at,
    outcome: row.outcome,
    httpStatus: row.http_status,
    finalUrl: row.final_url || null,
    contentHash: row.content_hash || null,
    structureHash: row.structure_hash || null,
    pageRole: row.page_role,
    hiringAvailability: row.hiring_availability,
    jobCount: Number(row.job_count) || 0,
    reasonCode: row.reason_code || null,
    evidence: decode(row.evidence_json, []),
    snapshotPath: row.snapshot_path || null,
    durationMs: row.duration_ms,
    metadata: decode(row.metadata_json, {}),
  };
}

function mapJobRevision(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    observationId: row.observation_id || null,
    revisionHash: row.revision_hash,
    changeType: row.change_type,
    fields: decode(row.fields_json, {}),
    changedFields: decode(row.changed_fields_json, []),
    observedAt: row.observed_at,
  };
}

function mapMonitorPolicy(row) {
  if (!row) return null;
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    queueLane: row.queue_lane,
    priority: Number(row.priority),
    scheduleClass: row.schedule_class,
    intervalHours: Number(row.interval_hours),
    browserAllowed: row.browser_allowed === 1,
    searchAllowed: row.search_allowed === 1,
    consecutiveMissingThreshold: Number(row.consecutive_missing_threshold),
    lastScheduledAt: row.last_scheduled_at || null,
    nextDueAt: row.next_due_at || null,
    enabled: row.enabled === 1,
    reason: row.reason || null,
    studentInterestCount: Number(row.student_interest_count) || 0,
    historicalApplicationScore: Number(row.historical_application_score) || 0,
    lastOutcome: row.last_outcome || null,
    priorityReasons: decode(row.priority_reasons_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
          channel_type, official_account_name, official_account_id, verified_subject,
          superseded_by_portal_id, first_seen_at, last_verified_at, last_checked_at
        ) VALUES (
          @id, @companyId, @url, @canonicalUrl, @registrableDomain, @atsType,
          @pageType, @verificationStatus, @confidenceScore, @recruitmentTypesJson,
          @sourceTier, @officialIdentityConfirmed, @platformIdentityConfirmed,
          @hiringAvailability, @fallbackReason, @searchCoverage,
          @channelType, @officialAccountName, @officialAccountId, @verifiedSubject,
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
          channel_type = excluded.channel_type,
          official_account_name = excluded.official_account_name,
          official_account_id = excluded.official_account_id,
          verified_subject = excluded.verified_subject,
          superseded_by_portal_id = excluded.superseded_by_portal_id,
          last_verified_at = excluded.last_verified_at,
          last_checked_at = excluded.last_checked_at
      `),
      portalStatus: database.prepare(`
        SELECT company_id, verification_status, source_tier,
               official_identity_confirmed, platform_identity_confirmed,
               hiring_availability, last_verified_at
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
          status, source_url, quality_grade, publication_status,
          quality_reasons_json, application_verified_at, dedupe_fingerprint,
          consecutive_missing_count, last_present_at, closed_evidence_json,
          first_seen_at, last_seen_at
        ) VALUES (
          @id, @companyId, @careerPortalId, @recruitmentEventId, @sourceTier,
          @sourceJobId, @title, @normalizedTitle, @roleFamily, @locationsJson,
          @employmentType, @publishedAt, @closesAt, @jobDetailUrl, @applyUrl,
          @status, @sourceUrl, @qualityGrade, @publicationStatus,
          @qualityReasonsJson, @applicationVerifiedAt, @dedupeFingerprint,
          @consecutiveMissingCount, @lastPresentAt, @closedEvidenceJson,
          @firstSeenAt, @lastSeenAt
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
          quality_grade = excluded.quality_grade,
          publication_status = excluded.publication_status,
          quality_reasons_json = excluded.quality_reasons_json,
          application_verified_at = excluded.application_verified_at,
          dedupe_fingerprint = excluded.dedupe_fingerprint,
          consecutive_missing_count = excluded.consecutive_missing_count,
          last_present_at = excluded.last_present_at,
          closed_evidence_json = excluded.closed_evidence_json,
          last_seen_at = excluded.last_seen_at
      `),
      upsertReviewTask: database.prepare(`
        INSERT INTO review_tasks (
          id, review_type, target_type, target_id, status, system_decision,
          ai_advice, reviewer, result, structured_changes_json,
          reason_codes_json, created_at, updated_at, reviewed_at
        ) VALUES (
          @id, @reviewType, @targetType, @targetId, @status, @systemDecision,
          @aiAdvice, @reviewer, @result, @structuredChangesJson,
          @reasonCodesJson, @createdAt, @updatedAt, @reviewedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          system_decision = excluded.system_decision,
          ai_advice = excluded.ai_advice,
          reviewer = excluded.reviewer,
          result = excluded.result,
          structured_changes_json = excluded.structured_changes_json,
          reason_codes_json = excluded.reason_codes_json,
          updated_at = excluded.updated_at,
          reviewed_at = excluded.reviewed_at
      `),
      openReviewTaskForTarget: database.prepare(`
        SELECT * FROM review_tasks
        WHERE review_type = ? AND target_type = ? AND target_id = ? AND status = 'OPEN'
        LIMIT 1
      `),
      closeOpenPublicationReview: database.prepare(`
        UPDATE review_tasks
        SET status = 'RESOLVED',
            system_decision = @systemDecision,
            result = @result,
            updated_at = @updatedAt,
            reviewed_at = @updatedAt
        WHERE review_type = 'JOB_PUBLICATION'
          AND target_type = 'JOB_OPENING'
          AND target_id = @targetId
          AND status = 'OPEN'
      `),
      upsertJobAssignment: database.prepare(`
        INSERT INTO job_assignments (
          id, job_id, assignee_type, assignee_id, assigned_by,
          status, note, assigned_at, updated_at
        ) VALUES (
          @id, @jobId, @assigneeType, @assigneeId, @assignedBy,
          @status, @note, @assignedAt, @updatedAt
        )
        ON CONFLICT(job_id, assignee_type, assignee_id) DO UPDATE SET
          assigned_by = excluded.assigned_by,
          status = excluded.status,
          note = excluded.note,
          updated_at = excluded.updated_at
      `),
      insertUserAction: database.prepare(`
        INSERT INTO user_actions (
          id, actor_id, student_id, job_id, action_type, note,
          triggers_reverification, created_at
        ) VALUES (
          @id, @actorId, @studentId, @jobId, @actionType, @note,
          @triggersReverification, @createdAt
        )
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
      requeueDeferredBatchItems: database.prepare(`
        UPDATE batch_items
        SET status = 'PENDING', result_status = NULL,
            discovery_run_id = NULL, error_message = NULL,
            started_at = NULL, completed_at = NULL,
            retry_class = NULL, deferred_until = NULL, defer_reason = NULL
        WHERE batch_id = @batchId
          AND status = 'DEFERRED'
          AND retry_class = @retryClass
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
      const normalizedCanonicalUrl = canonicalRecruitmentUrl(portal.canonicalUrl || portal.url)
        || portal.canonicalUrl;
      const normalizedPortal = {
        ...portal,
        url: normalizedCanonicalUrl,
        canonicalUrl: normalizedCanonicalUrl,
      };
      const sourceTier = normalizedPortal.sourceTier || (
        normalizedPortal.atsType ? 'OFFICIAL_ATS' : 'OFFICIAL_SITE'
      );
      const officialIdentityConfirmed = (
        normalizedPortal.officialIdentityConfirmed ?? normalizedPortal.verificationStatus === 'VERIFIED'
      ) === true;
      const platformIdentityConfirmed = normalizedPortal.platformIdentityConfirmed === true;
      const hiringAvailability = normalizedPortal.hiringAvailability || 'UNKNOWN';
      const confidenceScore = Math.max(
        0,
        Math.min(100, Number(normalizedPortal.confidenceScore) || 0),
      );
      if (!['OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL', 'PLATFORM_ONLY'].includes(sourceTier)) {
        throw new Error('unsupported CareerPortal sourceTier');
      }
      const channelType = normalizedPortal.channelType || (
        sourceTier === 'OFFICIAL_SOCIAL'
          ? 'WECHAT_OFFICIAL_ACCOUNT'
          : normalizedPortal.atsType
            ? 'ATS'
            : 'WEB_PORTAL'
      );
      if (!['WEB_PORTAL', 'ATS', 'WECHAT_OFFICIAL_ACCOUNT'].includes(channelType)) {
        throw new Error('unsupported CareerPortal channelType');
      }
      if (sourceTier === 'OFFICIAL_SOCIAL' && channelType !== 'WECHAT_OFFICIAL_ACCOUNT') {
        throw new Error('OFFICIAL_SOCIAL CareerPortal requires WECHAT_OFFICIAL_ACCOUNT');
      }
      if (sourceTier === 'PLATFORM_ONLY') {
        if (normalizedPortal.verificationStatus === 'VERIFIED') {
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
      } else if (normalizedPortal.verificationStatus === 'VERIFIED' && !officialIdentityConfirmed) {
        throw new Error('VERIFIED CareerPortal requires confirmed official identity');
      }

      const semanticExisting = database.prepare(`
        SELECT * FROM career_portals
        WHERE company_id = ? AND superseded_by_portal_id IS NULL
      `).all(normalizedPortal.companyId).find((candidate) => (
        canonicalRecruitmentUrl(candidate.canonical_url) === normalizedCanonicalUrl
      ));
      const existing = statements.portalIdentity.get(normalizedPortal.id, normalizedCanonicalUrl)
        || semanticExisting;
      if (existing && existing.company_id !== normalizedPortal.companyId) {
        throw new Error('CareerPortal canonical URL conflicts with another company');
      }
      const targetPortalId = existing?.id || normalizedPortal.id;
      statements.upsertPortal.run({
        ...normalizedPortal,
        id: targetPortalId,
        atsType: normalizedPortal.atsType || '',
        confidenceScore,
        sourceTier,
        channelType,
        officialAccountName: normalizedPortal.officialAccountName ?? null,
        officialAccountId: normalizedPortal.officialAccountId ?? null,
        verifiedSubject: normalizedPortal.verifiedSubject ?? null,
        officialIdentityConfirmed: officialIdentityConfirmed ? 1 : 0,
        platformIdentityConfirmed: platformIdentityConfirmed ? 1 : 0,
        hiringAvailability,
        fallbackReason: normalizedPortal.fallbackReason ?? null,
        searchCoverage: normalizedPortal.searchCoverage || 'PARTIAL',
        supersededByPortalId: normalizedPortal.supersededByPortalId ?? null,
        recruitmentTypesJson: encode(normalizedPortal.recruitmentTypes, []),
        lastVerifiedAt: normalizedPortal.lastVerifiedAt ?? null,
        lastCheckedAt: normalizedPortal.lastCheckedAt ?? null,
      });
      const validPlatformPortal = sourceTier === 'PLATFORM_ONLY'
        && platformIdentityConfirmed
        && hiringAvailability === 'OPENINGS_FOUND';
      if (normalizedPortal.verificationStatus !== 'VERIFIED' && !validPlatformPortal) {
        statements.deletePortalOpenings.run(targetPortalId);
      }
      const storedPortal = listCareerPortals().find((item) => item.id === targetPortalId);
      if (
        storedPortal
        && storedPortal.sourceTier !== 'PLATFORM_ONLY'
        && !storedPortal.supersededByPortalId
        && ['VERIFIED', 'REVIEW', 'BLOCKED'].includes(storedPortal.verificationStatus)
      ) {
        const endpoint = upsertSourceEndpoint({
          companyId: storedPortal.companyId,
          careerPortalId: storedPortal.id,
          url: storedPortal.canonicalUrl,
          endpointKind: ['JOB_LIST', 'CAMPAIGN'].includes(storedPortal.pageType)
            ? 'JOB_LIST'
            : storedPortal.sourceTier === 'OFFICIAL_SOCIAL'
              ? 'OFFICIAL_SOCIAL'
              : 'CAREER_PORTAL',
          transport: storedPortal.sourceTier === 'OFFICIAL_SOCIAL'
            ? 'SOCIAL'
            : storedPortal.atsType
              ? 'ATS_ADAPTER'
              : 'HTTP',
          adapterType: storedPortal.atsType || null,
          state: storedPortal.verificationStatus === 'BLOCKED'
            ? 'BLOCKED'
            : 'ACTIVE',
          intervalHours: storedPortal.hiringAvailability === 'OPENINGS_FOUND' ? 48 : 168,
          lastCheckedAt: storedPortal.lastCheckedAt,
          lastSuccessAt: storedPortal.verificationStatus === 'VERIFIED'
            ? storedPortal.lastCheckedAt || storedPortal.lastVerifiedAt
            : null,
          nextCheckAt: storedPortal.lastCheckedAt,
          metadata: {
            sourceTier: storedPortal.sourceTier,
            pageType: storedPortal.pageType,
            verificationStatus: storedPortal.verificationStatus,
          },
          createdAt: storedPortal.firstSeenAt,
          updatedAt: storedPortal.lastCheckedAt || storedPortal.firstSeenAt,
        });
        upsertMonitorPolicy({
          targetType: 'SOURCE_ENDPOINT',
          targetId: endpoint.id,
          queueLane: storedPortal.verificationStatus === 'VERIFIED'
            ? 'PORTAL_MONITOR'
            : 'PORTAL_RECOVERY',
          priority: storedPortal.hiringAvailability === 'OPENINGS_FOUND' ? 90 : 60,
          scheduleClass: storedPortal.hiringAvailability === 'OPENINGS_FOUND'
            ? 'RECRUITING_SEASON'
            : 'STANDARD',
          intervalHours: endpoint.intervalHours,
          browserAllowed: storedPortal.verificationStatus !== 'VERIFIED'
            || endpoint.transport === 'BROWSER',
          searchAllowed: false,
          consecutiveMissingThreshold: 3,
          nextDueAt: endpoint.nextCheckAt,
          reason: 'career_portal_sync',
          createdAt: endpoint.createdAt,
          updatedAt: endpoint.updatedAt,
        });
      }
      return storedPortal;
    });
  }

  function upsertSourceEndpoint(input) {
    requireMigration();
    const endpoint = createSourceEndpoint(input);
    const company = database.prepare('SELECT id FROM companies WHERE id = ?').get(endpoint.companyId);
    if (!company) throw new Error(`unknown Company for SourceEndpoint: ${endpoint.companyId}`);
    if (endpoint.careerPortalId) {
      const portal = database.prepare(`
        SELECT id, company_id FROM career_portals WHERE id = ?
      `).get(endpoint.careerPortalId);
      if (!portal || portal.company_id !== endpoint.companyId) {
        throw new Error('SourceEndpoint CareerPortal must belong to its Company');
      }
    }
    const existing = database.prepare(`
      SELECT * FROM source_endpoints
      WHERE company_id = ? AND canonical_url = ?
    `).get(endpoint.companyId, endpoint.canonicalUrl);
    const targetId = existing?.id || endpoint.id;
    database.prepare(`
      INSERT INTO source_endpoints (
        id, company_id, career_portal_id, url, canonical_url, endpoint_kind,
        transport, adapter_type, state, interval_hours, etag, last_modified,
        content_hash, structure_hash, last_checked_at, last_success_at,
        last_failure_at, last_failure_reason, last_http_status,
        next_check_at, consecutive_failures, metadata_json, created_at, updated_at
      ) VALUES (
        @id, @companyId, @careerPortalId, @url, @canonicalUrl, @endpointKind,
        @transport, @adapterType, @state, @intervalHours, @etag, @lastModified,
        @contentHash, @structureHash, @lastCheckedAt, @lastSuccessAt,
        @lastFailureAt, @lastFailureReason, @lastHttpStatus,
        @nextCheckAt, @consecutiveFailures, @metadataJson, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        career_portal_id = COALESCE(excluded.career_portal_id, source_endpoints.career_portal_id),
        url = excluded.url,
        canonical_url = excluded.canonical_url,
        endpoint_kind = excluded.endpoint_kind,
        transport = excluded.transport,
        adapter_type = COALESCE(excluded.adapter_type, source_endpoints.adapter_type),
        state = excluded.state,
        interval_hours = excluded.interval_hours,
        etag = COALESCE(excluded.etag, source_endpoints.etag),
        last_modified = COALESCE(excluded.last_modified, source_endpoints.last_modified),
        content_hash = COALESCE(excluded.content_hash, source_endpoints.content_hash),
        structure_hash = COALESCE(excluded.structure_hash, source_endpoints.structure_hash),
        last_checked_at = COALESCE(excluded.last_checked_at, source_endpoints.last_checked_at),
        last_success_at = COALESCE(excluded.last_success_at, source_endpoints.last_success_at),
        last_failure_at = COALESCE(excluded.last_failure_at, source_endpoints.last_failure_at),
        last_failure_reason = COALESCE(
          excluded.last_failure_reason,
          source_endpoints.last_failure_reason
        ),
        last_http_status = COALESCE(excluded.last_http_status, source_endpoints.last_http_status),
        next_check_at = COALESCE(excluded.next_check_at, source_endpoints.next_check_at),
        consecutive_failures = excluded.consecutive_failures,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run({
      ...endpoint,
      id: targetId,
      metadataJson: encode(endpoint.metadata, {}),
    });
    return mapSourceEndpoint(database.prepare(`
      SELECT * FROM source_endpoints WHERE id = ?
    `).get(targetId));
  }

  function listSourceEndpoints({
    companyId = null,
    careerPortalId = null,
    state = null,
    dueAt = null,
  } = {}) {
    requireMigration();
    const clauses = [];
    const values = [];
    if (companyId) {
      clauses.push('company_id = ?');
      values.push(companyId);
    }
    if (careerPortalId) {
      clauses.push('career_portal_id = ?');
      values.push(careerPortalId);
    }
    if (state) {
      clauses.push('state = ?');
      values.push(state);
    }
    if (dueAt) {
      clauses.push('(next_check_at IS NULL OR next_check_at <= ?)');
      values.push(dueAt);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return database.prepare(`
      SELECT * FROM source_endpoints ${where}
      ORDER BY COALESCE(next_check_at, ''), company_id, canonical_url
    `).all(...values).map(mapSourceEndpoint);
  }

  function appendFetchObservation(input) {
    requireMigration();
    const observation = createFetchObservation(input);
    const endpoint = database.prepare(`
      SELECT * FROM source_endpoints WHERE id = ?
    `).get(observation.sourceEndpointId);
    if (!endpoint) throw new Error(`unknown SourceEndpoint: ${observation.sourceEndpointId}`);
    database.prepare(`
      INSERT INTO fetch_observations (
        id, source_endpoint_id, run_id, fetched_at, outcome, http_status,
        final_url, content_hash, structure_hash, page_role,
        hiring_availability, job_count, reason_code, evidence_json,
        snapshot_path, duration_ms, metadata_json
      ) VALUES (
        @id, @sourceEndpointId, @runId, @fetchedAt, @outcome, @httpStatus,
        @finalUrl, @contentHash, @structureHash, @pageRole,
        @hiringAvailability, @jobCount, @reasonCode, @evidenceJson,
        @snapshotPath, @durationMs, @metadataJson
      )
    `).run({
      ...observation,
      evidenceJson: encode(observation.evidence, []),
      metadataJson: encode(observation.metadata, {}),
    });
    const succeeded = ['SUCCESS', 'NOT_MODIFIED', 'NO_OPENINGS'].includes(
      observation.outcome,
    );
    const blocked = observation.outcome === 'BLOCKED';
    const failures = succeeded ? 0 : Number(endpoint.consecutive_failures || 0) + 1;
    const policyRow = database.prepare(`
      SELECT * FROM monitor_policies
      WHERE target_type = 'SOURCE_ENDPOINT' AND target_id = ?
    `).get(endpoint.id);
    const schedule = deriveMonitorSchedule({
      hiringAvailability: observation.hiringAvailability,
      outcome: observation.outcome,
      consecutiveFailures: failures,
      studentInterestCount: policyRow?.student_interest_count || 0,
      historicalApplicationScore: policyRow?.historical_application_score || 0,
      recruitingSeason: policyRow?.schedule_class === 'RECRUITING_SEASON',
    });
    const delayHours = schedule.intervalHours;
    const nextCheckAt = new Date(
      Date.parse(observation.fetchedAt) + delayHours * 3_600_000,
    ).toISOString();
    const verifiedPortal = endpoint.career_portal_id
      ? database.prepare(`
          SELECT verification_status
          FROM career_portals
          WHERE id = ?
        `).get(endpoint.career_portal_id)?.verification_status === 'VERIFIED'
      : false;
    const queueLane = succeeded && verifiedPortal
      ? schedule.queueLane
      : 'PORTAL_RECOVERY';
    database.prepare(`
      UPDATE source_endpoints
      SET state = @state,
          etag = COALESCE(@etag, etag),
          last_modified = COALESCE(@lastModified, last_modified),
          content_hash = COALESCE(@contentHash, content_hash),
          structure_hash = COALESCE(@structureHash, structure_hash),
          last_checked_at = @lastCheckedAt,
          last_success_at = CASE WHEN @succeeded = 1 THEN @lastCheckedAt ELSE last_success_at END,
          last_failure_at = CASE WHEN @succeeded = 0 THEN @lastCheckedAt ELSE last_failure_at END,
          last_failure_reason = CASE WHEN @succeeded = 0 THEN @lastFailureReason ELSE NULL END,
          last_http_status = @lastHttpStatus,
          next_check_at = @nextCheckAt,
          interval_hours = @intervalHours,
          consecutive_failures = @consecutiveFailures,
          updated_at = @lastCheckedAt
      WHERE id = @id
    `).run({
      id: endpoint.id,
      state: blocked ? 'BLOCKED' : endpoint.state === 'RETIRED' ? 'RETIRED' : 'ACTIVE',
      etag: observation.metadata.etag || null,
      lastModified: observation.metadata.lastModified || null,
      contentHash: observation.contentHash,
      structureHash: observation.structureHash,
      lastCheckedAt: observation.fetchedAt,
      succeeded: succeeded ? 1 : 0,
      lastFailureReason: observation.reasonCode,
      lastHttpStatus: observation.httpStatus,
      nextCheckAt,
      intervalHours: delayHours,
      consecutiveFailures: failures,
    });
    database.prepare(`
      UPDATE monitor_policies
      SET next_due_at = @nextCheckAt,
          queue_lane = @queueLane,
          browser_allowed = @browserAllowed,
          priority = @priority,
          schedule_class = @scheduleClass,
          interval_hours = @intervalHours,
          last_outcome = @lastOutcome,
          priority_reasons_json = @priorityReasonsJson,
          updated_at = @updatedAt
      WHERE target_type = 'SOURCE_ENDPOINT'
        AND target_id = @targetId
    `).run({
      nextCheckAt,
      queueLane,
      browserAllowed: queueLane === 'PORTAL_RECOVERY' ? 1 : schedule.browserAllowed ? 1 : 0,
      priority: schedule.priority,
      scheduleClass: schedule.scheduleClass,
      intervalHours: delayHours,
      lastOutcome: observation.outcome,
      priorityReasonsJson: encode(schedule.reasons, []),
      updatedAt: observation.fetchedAt,
      targetId: endpoint.id,
    });
    return mapFetchObservation(database.prepare(`
      SELECT * FROM fetch_observations WHERE id = ?
    `).get(observation.id));
  }

  function listFetchObservations({
    sourceEndpointId = null,
    outcome = null,
    limit = 500,
  } = {}) {
    requireMigration();
    const clauses = [];
    const values = [];
    if (sourceEndpointId) {
      clauses.push('source_endpoint_id = ?');
      values.push(sourceEndpointId);
    }
    if (outcome) {
      clauses.push('outcome = ?');
      values.push(outcome);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(Math.max(1, Math.min(5000, Math.trunc(Number(limit) || 500))));
    return database.prepare(`
      SELECT * FROM fetch_observations ${where}
      ORDER BY fetched_at DESC, id
      LIMIT ?
    `).all(...values).map(mapFetchObservation);
  }

  function appendPageSnapshot(input) {
    requireMigration();
    const snapshot = createPageSnapshot(input);
    const observation = database.prepare(`
      SELECT source_endpoint_id FROM fetch_observations WHERE id = ?
    `).get(snapshot.observationId);
    if (!observation || observation.source_endpoint_id !== snapshot.sourceEndpointId) {
      throw new Error('PageSnapshot must match an existing FetchObservation');
    }
    database.prepare(`
      INSERT INTO page_snapshots (
        id, source_endpoint_id, observation_id, captured_at, final_url,
        content_type, body_path, body_bytes, content_hash, structure_hash,
        metadata_json
      ) VALUES (
        @id, @sourceEndpointId, @observationId, @capturedAt, @finalUrl,
        @contentType, @bodyPath, @bodyBytes, @contentHash, @structureHash,
        @metadataJson
      )
      ON CONFLICT(observation_id) DO UPDATE SET
        final_url = excluded.final_url,
        content_type = excluded.content_type,
        body_path = excluded.body_path,
        body_bytes = excluded.body_bytes,
        content_hash = excluded.content_hash,
        structure_hash = excluded.structure_hash,
        metadata_json = excluded.metadata_json
    `).run({
      ...snapshot,
      metadataJson: encode(snapshot.metadata, {}),
    });
    return mapPageSnapshot(database.prepare(`
      SELECT * FROM page_snapshots WHERE observation_id = ?
    `).get(snapshot.observationId));
  }

  function listPageSnapshots({
    sourceEndpointId = null,
    observationId = null,
    limit = 500,
  } = {}) {
    requireMigration();
    const clauses = [];
    const values = [];
    if (sourceEndpointId) {
      clauses.push('source_endpoint_id = ?');
      values.push(sourceEndpointId);
    }
    if (observationId) {
      clauses.push('observation_id = ?');
      values.push(observationId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(Math.max(1, Math.min(5000, Math.trunc(Number(limit) || 500))));
    return database.prepare(`
      SELECT * FROM page_snapshots ${where}
      ORDER BY captured_at DESC, id
      LIMIT ?
    `).all(...values).map(mapPageSnapshot);
  }

  function appendJobRevision(input) {
    requireMigration();
    const revision = createJobRevision(input);
    if (!database.prepare('SELECT id FROM job_openings WHERE id = ?').get(revision.jobId)) {
      throw new Error(`unknown JobOpening for JobRevision: ${revision.jobId}`);
    }
    database.prepare(`
      INSERT OR IGNORE INTO job_revisions (
        id, job_id, observation_id, revision_hash, change_type,
        fields_json, changed_fields_json, observed_at
      ) VALUES (
        @id, @jobId, @observationId, @revisionHash, @changeType,
        @fieldsJson, @changedFieldsJson, @observedAt
      )
    `).run({
      ...revision,
      fieldsJson: encode(revision.fields, {}),
      changedFieldsJson: encode(revision.changedFields, []),
    });
    return database.prepare(`
      SELECT * FROM job_revisions
      WHERE job_id = ? AND revision_hash = ? AND change_type = ?
    `).all(revision.jobId, revision.revisionHash, revision.changeType)
      .map(mapJobRevision)[0] || revision;
  }

  function listJobRevisions({ jobId = null, limit = 1000 } = {}) {
    requireMigration();
    const bounded = Math.max(1, Math.min(5000, Math.trunc(Number(limit) || 1000)));
    const rows = jobId
      ? database.prepare(`
          SELECT * FROM job_revisions
          WHERE job_id = ?
          ORDER BY observed_at DESC, id
          LIMIT ?
        `).all(jobId, bounded)
      : database.prepare(`
          SELECT * FROM job_revisions
          ORDER BY observed_at DESC, id
          LIMIT ?
        `).all(bounded);
    return rows.map(mapJobRevision);
  }

  function reconcileEndpointOpenings({
    sourceEndpointId,
    observationId,
    seenJobIds = [],
    successful = false,
    explicitClosedJobIds = [],
    missingThreshold = 3,
    observedAt = new Date().toISOString(),
  } = {}) {
    requireMigration();
    if (!successful) {
      return Object.freeze({ seen: 0, missing: 0, closed: 0, skipped: true });
    }
    const endpoint = database.prepare(`
      SELECT career_portal_id FROM source_endpoints WHERE id = ?
    `).get(sourceEndpointId);
    if (!endpoint?.career_portal_id) {
      throw new Error('SourceEndpoint requires a CareerPortal for job reconciliation');
    }
    const seen = new Set(seenJobIds.map(String));
    const explicit = new Set(explicitClosedJobIds.map(String));
    const threshold = Math.max(2, Math.trunc(Number(missingThreshold) || 3));
    return withTransaction(() => {
      const rows = database.prepare(`
        SELECT * FROM job_openings
        WHERE career_portal_id = ?
          AND source_tier IN ('OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL')
      `).all(endpoint.career_portal_id);
      let seenCount = 0;
      let missingCount = 0;
      let closedCount = 0;
      for (const row of rows) {
        if (seen.has(row.id)) {
          database.prepare(`
            UPDATE job_openings
            SET consecutive_missing_count = 0,
                last_present_at = ?,
                closed_evidence_json = CASE
                  WHEN status = 'CLOSED' THEN closed_evidence_json
                  ELSE '[]'
                END
            WHERE id = ?
          `).run(observedAt, row.id);
          seenCount += 1;
          continue;
        }
        if (row.status === 'CLOSED' && !explicit.has(row.id)) continue;
        const nextMissing = Number(row.consecutive_missing_count || 0) + 1;
        const explicitClose = explicit.has(row.id);
        const shouldClose = explicitClose || nextMissing >= threshold;
        const evidence = [{
          code: explicitClose
            ? 'EXPLICIT_JOB_CLOSED'
            : 'MISSING_FROM_CONSECUTIVE_SUCCESSFUL_SNAPSHOTS',
          sourceEndpointId,
          observationId: observationId || null,
          observedAt,
          consecutiveMissingCount: nextMissing,
        }];
        database.prepare(`
          UPDATE job_openings
          SET consecutive_missing_count = ?,
              status = CASE WHEN ? = 1 THEN 'CLOSED' ELSE status END,
              closed_evidence_json = CASE WHEN ? = 1 THEN ? ELSE closed_evidence_json END
          WHERE id = ?
        `).run(
          nextMissing,
          shouldClose ? 1 : 0,
          shouldClose ? 1 : 0,
          encode(evidence, []),
          row.id,
        );
        appendJobRevision({
          jobId: row.id,
          observationId,
          changeType: shouldClose ? 'CLOSED' : 'MISSING',
          fields: {
            consecutiveMissingCount: nextMissing,
            status: shouldClose ? 'CLOSED' : row.status,
            closedEvidence: shouldClose ? evidence : [],
          },
          changedFields: shouldClose
            ? ['consecutiveMissingCount', 'status', 'closedEvidence']
            : ['consecutiveMissingCount'],
          observedAt,
        });
        missingCount += 1;
        if (shouldClose) closedCount += 1;
      }
      return Object.freeze({
        seen: seenCount,
        missing: missingCount,
        closed: closedCount,
        skipped: false,
      });
    });
  }

  function upsertMonitorPolicy(input) {
    requireMigration();
    const policy = createMonitorPolicy(input);
    const existing = database.prepare(`
      SELECT * FROM monitor_policies
      WHERE target_type = ? AND target_id = ?
    `).get(policy.targetType, policy.targetId);
    const targetId = existing?.id || policy.id;
    database.prepare(`
      INSERT INTO monitor_policies (
        id, target_type, target_id, queue_lane, priority, schedule_class,
        interval_hours, browser_allowed, search_allowed,
        consecutive_missing_threshold, last_scheduled_at, next_due_at,
        enabled, reason, student_interest_count, historical_application_score,
        last_outcome, priority_reasons_json, created_at, updated_at
      ) VALUES (
        @id, @targetType, @targetId, @queueLane, @priority, @scheduleClass,
        @intervalHours, @browserAllowed, @searchAllowed,
        @consecutiveMissingThreshold, @lastScheduledAt, @nextDueAt,
        @enabled, @reason, @studentInterestCount, @historicalApplicationScore,
        @lastOutcome, @priorityReasonsJson, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        queue_lane = excluded.queue_lane,
        priority = excluded.priority,
        schedule_class = excluded.schedule_class,
        interval_hours = excluded.interval_hours,
        browser_allowed = excluded.browser_allowed,
        search_allowed = excluded.search_allowed,
        consecutive_missing_threshold = excluded.consecutive_missing_threshold,
        last_scheduled_at = COALESCE(excluded.last_scheduled_at, monitor_policies.last_scheduled_at),
        next_due_at = COALESCE(excluded.next_due_at, monitor_policies.next_due_at),
        enabled = excluded.enabled,
        reason = excluded.reason,
        student_interest_count = MAX(
          monitor_policies.student_interest_count,
          excluded.student_interest_count
        ),
        historical_application_score = MAX(
          monitor_policies.historical_application_score,
          excluded.historical_application_score
        ),
        last_outcome = COALESCE(excluded.last_outcome, monitor_policies.last_outcome),
        priority_reasons_json = CASE
          WHEN excluded.priority_reasons_json = '[]'
            THEN monitor_policies.priority_reasons_json
          ELSE excluded.priority_reasons_json
        END,
        updated_at = excluded.updated_at
    `).run({
      ...policy,
      id: targetId,
      browserAllowed: policy.browserAllowed ? 1 : 0,
      searchAllowed: policy.searchAllowed ? 1 : 0,
      enabled: policy.enabled ? 1 : 0,
      priorityReasonsJson: encode(policy.priorityReasons, []),
    });
    return mapMonitorPolicy(database.prepare(`
      SELECT * FROM monitor_policies WHERE id = ?
    `).get(targetId));
  }

  function listMonitorPolicies({
    queueLane = null,
    enabled = null,
    dueAt = null,
  } = {}) {
    requireMigration();
    const clauses = [];
    const values = [];
    if (queueLane) {
      clauses.push('queue_lane = ?');
      values.push(queueLane);
    }
    if (enabled != null) {
      clauses.push('enabled = ?');
      values.push(enabled ? 1 : 0);
    }
    if (dueAt) {
      clauses.push('(next_due_at IS NULL OR next_due_at <= ?)');
      values.push(dueAt);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return database.prepare(`
      SELECT * FROM monitor_policies ${where}
      ORDER BY priority DESC, COALESCE(next_due_at, ''), id
    `).all(...values).map(mapMonitorPolicy);
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

  function openingRevisionFields(opening, sourceTier, policy) {
    return {
      title: opening.title,
      normalizedTitle: opening.normalizedTitle,
      roleFamily: opening.roleFamily,
      locations: [...(opening.locations || [])],
      employmentType: opening.employmentType || null,
      publishedAt: opening.publishedAt || null,
      closesAt: opening.closesAt || null,
      jobDetailUrl: opening.jobDetailUrl || null,
      applyUrl: opening.applyUrl || null,
      status: opening.status,
      sourceTier,
      recruitmentEventId: opening.recruitmentEventId || null,
      qualityGrade: policy.qualityGrade,
      publicationStatus: policy.publicationStatus,
    };
  }

  function changedOpeningFields(previous, next) {
    if (!previous) return Object.keys(next);
    const previousFields = openingRevisionFields(
      previous,
      previous.sourceTier,
      {
        qualityGrade: previous.qualityGrade,
        publicationStatus: previous.publicationStatus,
      },
    );
    return Object.keys(next).filter((key) => (
      JSON.stringify(previousFields[key]) !== JSON.stringify(next[key])
    ));
  }

  function writeOpening(opening, sourceTier, portalRow, eventRow = null) {
    const previousRow = database.prepare(`
      SELECT * FROM job_openings WHERE id = ?
    `).get(opening.id);
    const previous = previousRow ? mapOpening(previousRow) : null;
    const policy = evaluateJobPublication({
      opening: { ...opening, sourceTier },
      portal: {
        sourceTier: portalRow.source_tier,
        verificationStatus: portalRow.verification_status,
        officialIdentityConfirmed: portalRow.official_identity_confirmed === 1,
        platformIdentityConfirmed: portalRow.platform_identity_confirmed === 1,
        lastVerifiedAt: portalRow.last_verified_at || null,
      },
      event: eventRow ? mapRecruitmentEvent(eventRow) : {},
    });
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
      qualityGrade: policy.qualityGrade,
      publicationStatus: policy.publicationStatus,
      qualityReasonsJson: encode(policy.reasons, []),
      applicationVerifiedAt: policy.applicationVerifiedAt,
      dedupeFingerprint: opening.dedupeFingerprint || opening.id,
      consecutiveMissingCount: 0,
      lastPresentAt: opening.lastSeenAt || new Date().toISOString(),
      closedEvidenceJson: encode([], []),
    });
    if (policy.publicationStatus === 'REVIEW_REQUIRED') {
      const existing = statements.openReviewTaskForTarget.get(
        'JOB_PUBLICATION',
        'JOB_OPENING',
        opening.id,
      );
      if (!existing) {
        upsertReviewTask(createReviewTask({
          reviewType: 'JOB_PUBLICATION',
          targetType: 'JOB_OPENING',
          targetId: opening.id,
          systemDecision: policy.publicationStatus,
          reasonCodes: policy.reasons,
        }));
      }
    } else {
      statements.closeOpenPublicationReview.run({
        targetId: opening.id,
        systemDecision: policy.publicationStatus,
        result: 'AUTO_POLICY_REEVALUATED',
        updatedAt: opening.lastSeenAt || new Date().toISOString(),
      });
    }
    const fields = openingRevisionFields(opening, sourceTier, policy);
    const changedFields = changedOpeningFields(previous, fields);
    const changeType = !previous
      ? 'DISCOVERED'
      : previous.status === 'CLOSED' && opening.status === 'ACTIVE'
        ? 'REOPENED'
        : previous.status !== 'CLOSED' && opening.status === 'CLOSED'
          ? 'CLOSED'
          : changedFields.length
            ? 'UPDATED'
            : 'SEEN';
    appendJobRevision({
      jobId: opening.id,
      changeType,
      fields,
      changedFields,
      observedAt: opening.lastSeenAt || new Date().toISOString(),
    });
    return Object.freeze({ ...opening, ...policy, dedupeFingerprint: opening.id });
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
    return writeOpening(opening, sourceTier, portal, event);
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
    return writeOpening(opening, 'PLATFORM_ONLY', portal, event);
  }

  function upsertReviewTask(input) {
    requireMigration();
    const task = createReviewTask(input);
    statements.upsertReviewTask.run({
      ...task,
      structuredChangesJson: encode(task.structuredChanges, {}),
      reasonCodesJson: encode(task.reasonCodes, []),
    });
    return mapReviewTask(database.prepare('SELECT * FROM review_tasks WHERE id = ?').get(task.id));
  }

  function listReviewTasks({ status = null, targetType = null, targetId = null } = {}) {
    requireMigration();
    const clauses = [];
    const parameters = [];
    if (status) {
      clauses.push('status = ?');
      parameters.push(status);
    }
    if (targetType) {
      clauses.push('target_type = ?');
      parameters.push(targetType);
    }
    if (targetId) {
      clauses.push('target_id = ?');
      parameters.push(targetId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return database.prepare(`
      SELECT * FROM review_tasks ${where}
      ORDER BY
        CASE status WHEN 'OPEN' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END,
        created_at,
        id
    `).all(...parameters).map(mapReviewTask);
  }

  function upsertJobAssignment(input) {
    requireMigration();
    const assignment = createJobAssignment(input);
    const job = database.prepare(`
      SELECT id, quality_grade, publication_status
      FROM job_openings WHERE id = ?
    `).get(assignment.jobId);
    if (!job) throw new Error(`unknown JobOpening: ${assignment.jobId}`);
    if (assignment.assigneeType === 'STUDENT'
      && (job.quality_grade !== 'A' || job.publication_status !== 'PUBLISHED')) {
      throw new Error('student assignment requires an A-grade published JobOpening');
    }
    statements.upsertJobAssignment.run({
      ...assignment,
      note: assignment.note ?? null,
    });
    return mapJobAssignment(database.prepare(`
      SELECT * FROM job_assignments
      WHERE job_id = ? AND assignee_type = ? AND assignee_id = ?
    `).get(assignment.jobId, assignment.assigneeType, assignment.assigneeId));
  }

  function listJobAssignments({ assigneeType = null, assigneeId = null, jobId = null } = {}) {
    requireMigration();
    const clauses = [];
    const parameters = [];
    if (assigneeType) {
      clauses.push('assignee_type = ?');
      parameters.push(assigneeType);
    }
    if (assigneeId) {
      clauses.push('assignee_id = ?');
      parameters.push(assigneeId);
    }
    if (jobId) {
      clauses.push('job_id = ?');
      parameters.push(jobId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return database.prepare(`
      SELECT * FROM job_assignments ${where}
      ORDER BY assigned_at DESC, id
    `).all(...parameters).map(mapJobAssignment);
  }

  function appendUserAction(input) {
    requireMigration();
    const action = createUserAction(input);
    if (action.jobId
      && !database.prepare('SELECT id FROM job_openings WHERE id = ?').get(action.jobId)) {
      throw new Error(`unknown JobOpening: ${action.jobId}`);
    }
    statements.insertUserAction.run({
      ...action,
      studentId: action.studentId ?? null,
      jobId: action.jobId ?? null,
      note: action.note ?? null,
      triggersReverification: action.triggersReverification ? 1 : 0,
    });
    if (action.triggersReverification && action.jobId) {
      const existing = statements.openReviewTaskForTarget.get(
        'DATA_COMPLETENESS',
        'JOB_OPENING',
        action.jobId,
      );
      if (!existing) {
        upsertReviewTask(createReviewTask({
          reviewType: 'DATA_COMPLETENESS',
          targetType: 'JOB_OPENING',
          targetId: action.jobId,
          systemDecision: 'REVERIFY',
          reasonCodes: ['USER_REPORTED_INVALID'],
          createdAt: action.createdAt,
          updatedAt: action.createdAt,
        }));
      }
    }
    return action;
  }

  function listUserActions({ actorId = null, studentId = null, jobId = null } = {}) {
    requireMigration();
    const clauses = [];
    const parameters = [];
    if (actorId) {
      clauses.push('actor_id = ?');
      parameters.push(actorId);
    }
    if (studentId) {
      clauses.push('student_id = ?');
      parameters.push(studentId);
    }
    if (jobId) {
      clauses.push('job_id = ?');
      parameters.push(jobId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return database.prepare(`
      SELECT * FROM user_actions ${where}
      ORDER BY created_at DESC, id
    `).all(...parameters).map(mapUserAction);
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
      SELECT domains.domain
      FROM company_domains AS domains
      WHERE domains.company_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM company_web_knowledge AS knowledge
          WHERE knowledge.company_id = domains.company_id
            AND knowledge.knowledge_type = 'REJECTED_DOMAIN'
            AND knowledge.verification_status = 'REJECTED'
            AND knowledge.value = domains.domain
        )
      ORDER BY domains.domain
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
      WHERE portals.superseded_by_portal_id IS NULL
      AND ((
        jobs.source_tier IN ('OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL')
        AND portals.verification_status = 'VERIFIED'
      ) OR (
        jobs.source_tier = 'PLATFORM_ONLY'
        AND portals.source_tier = 'PLATFORM_ONLY'
        AND portals.platform_identity_confirmed = 1
        AND portals.hiring_availability = 'OPENINGS_FOUND'
      ))
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

  function requeueDeferredBatchItems({
    batchId,
    retryClass = 'PROVIDER_BLOCKED',
  } = {}) {
    requireMigration();
    if (!batchId) throw new Error('batchId is required');
    const result = statements.requeueDeferredBatchItems.run({
      batchId,
      retryClass,
    });
    return Object.freeze({
      batchId,
      retryClass,
      requeued: result.changes,
    });
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
    upsertSourceEndpoint,
    listSourceEndpoints,
    appendFetchObservation,
    listFetchObservations,
    appendPageSnapshot,
    listPageSnapshots,
    replaceVerificationEvidence,
    upsertRecruitmentEvent,
    upsertJobOpening,
    upsertPlatformJobOpening,
    appendJobRevision,
    listJobRevisions,
    reconcileEndpointOpenings,
    upsertMonitorPolicy,
    listMonitorPolicies,
    upsertReviewTask,
    listReviewTasks,
    upsertJobAssignment,
    listJobAssignments,
    appendUserAction,
    listUserActions,
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
    requeueDeferredBatchItems,
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
