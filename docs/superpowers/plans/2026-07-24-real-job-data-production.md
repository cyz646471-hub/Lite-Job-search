# Real Job Data Production Implementation Plan

**Goal:** Deliver observable live Canary runs, a merged company knowledge base,
occupation taxonomy, quality metrics, and restartable batch discovery without
rewriting existing providers.

## Task 1: Freeze report and failure-state contracts

- Add failing tests for location input, report fields, provider failures, and
  literal `NOT_CONFIGURED`/`FAILED` results.
- Add run-report aggregation and CLI options.
- Verify focused Canary and CLI tests; commit Phase 1.

## Task 2: Extend the company knowledge base

- Add failing domain and repository tests for bilingual names, regions,
  recruitment types, evidence, and cross-discovery company merging.
- Add migration `002-real-data-production.sql`.
- Extend models and repository mapping/upserts without rewriting migration 001.
- Verify repository and domain tests; commit Phase 2.

## Task 3: Add occupation taxonomy and observable LLM planning

- Add failing taxonomy tests for Product, Engineering, Marketing, AI, and 3C.
- Add the versioned taxonomy and deterministic resolver.
- Add replaceable planning cache and usage/cost recording; merge controlled
  taxonomy terms into keyword planning.
- Verify taxonomy, planner, adapter, and repository tests; commit Phase 3.

## Task 4: Add quality metrics

- Add failing tests for exact rate numerators, denominators, null handling, and
  average confidence.
- Instrument discovery events and expose a quality report.
- Verify application and CLI reports; commit Phase 4.

## Task 5: Add restartable batch discovery

- Add failing tests for checkpoints, skip-on-resume, retry behavior, and failure
  isolation.
- Add batch tables, repository methods, application runner, CLI command, and
  sample input.
- Verify batch tests and an offline four-item end-to-end run; commit Phase 5.

## Task 6: Production-readiness verification

- Run targeted tests and full `npm.cmd test`.
- Run Doctor and a real Canary only when configuration is present; otherwise
  capture the literal `NOT_CONFIGURED` report.
- Run pack dry-run, migration compatibility, secret scan, and diff checks.
- Request independent review, fix Critical/Important findings, and rerun all
  affected verification.

