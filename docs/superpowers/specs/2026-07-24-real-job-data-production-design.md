# Real Job Data Production Design

## Goal

Move Lite Job Search from a fixture-proven discovery prototype to an observable,
restartable production path for public recruitment data. The existing providers,
verification policy, and upstream extraction adapters remain unchanged.

## Selected approach

Use an incremental application layer around the existing discovery pipeline:

1. A run report records planning, search, verification, extraction, and failure
   outcomes with literal terminal states (`NOT_CONFIGURED`, `FAILED`,
   `BLOCKED`, `DEFERRED_BY_BUDGET`, `PARTIAL`, `COMPLETE`).
2. SQLite becomes the durable company knowledge base. Company identity merges
   use market plus known domain, canonical name, Chinese/English name, or alias.
3. A versioned local occupation taxonomy supplies deterministic vocabulary.
   The replaceable LLM planner may extend it, while output validation and
   exclusions remain program-controlled.
4. Quality metrics are derived from observed run events, not estimated:
   official verification rate, extraction success rate, duplicate rate, false
   positive rate, and average deterministic confidence.
5. Batch runs store item checkpoints in SQLite. A failed item is recorded and
   later items continue; rerunning the same batch skips completed items and
   retries unfinished or failed items only when requested.

## Inputs and outputs

The single-run interface accepts market, role, optional industry and location,
freshness days, and target count. The report includes planned queries, unique
candidate URLs and companies, portal decisions, extracted jobs, provider
attempts, LLM usage, quality metrics, and stage-specific failure reasons.

No run may claim live connectivity unless a provider reports an actual network
request. Missing LLM or search configuration returns `NOT_CONFIGURED`; provider
and network errors remain machine-readable failures.

## Data model changes

Company adds Chinese name, English name, country/region, and accumulated aliases,
industries, and official domains.

CareerPortal adds recruitment types and retains ATS type, page role, confidence,
status, and normalized evidence.

New tables:

- `llm_usage_logs`: task, model, prompt hash, cache state, token usage, cost, time.
- `batch_runs`: durable batch status and timestamps.
- `batch_items`: stable item key, input, attempts, status, linked discovery run,
  error, and timestamps.

Existing records are migrated in place with additive migration `002`.

## LLM boundary

The planning adapter is replaceable and accepts cache and usage-recorder ports.
Cache keys include model, task, and normalized input. Cost is calculated only
from provider-reported token usage and configured prices; unknown usage produces
`null`, never an estimate disguised as observed cost.

The LLM may only produce keywords, queries, and neutral advisory text. Official
identity, confidence, evidence weights, rejection, deduplication, quality
metrics, and database merge decisions remain deterministic.

## Quality definitions

- Official verification rate = verified portals / portals evaluated.
- Job extraction success rate = verified portals yielding accepted jobs /
  verified portals where extraction was attempted.
- Duplicate rate = duplicate candidate results / valid candidate results.
- False positive rate = rejected portals / portals evaluated.
- Average confidence score = arithmetic mean over evaluated portals.

Every rate returns both numerator/denominator and `null` when the denominator is
zero.

## Safety and operational boundaries

Only public pages are fetched. Existing SSRF, redirect, timeout, response-size,
access-control, CAPTCHA, and no-application-submission boundaries remain.
Evidence is retained for verified, review, rejected, and blocked results.
