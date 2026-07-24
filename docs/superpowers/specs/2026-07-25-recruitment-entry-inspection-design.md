# Recruitment Entry Inspection Design

## Goal

Make recruitment-page inspection a required step after candidate discovery.
Finding a search result is not sufficient: the system must open the candidate,
verify its identity, discover the company's social, campus, graduate,
internship, and general job-list entry points, inspect each accessible entry,
extract current openings, and preserve the outcome in SQLite.

The change must preserve existing providers, domain models, database schema,
and CLI arguments.

## Current gap

The production market-discovery pipeline already supports candidate fetching,
deterministic verification, job extraction, and SQLite storage. The browser
company-discovery runner opens the initial candidate and discovers recruitment
navigation links, but child links are currently emitted with
`pageStatus: DISCOVERED`. They are not necessarily visited, and therefore do
not establish whether recruiting is active.

This design separates these states:

- `DISCOVERED`: a candidate URL was found but not inspected;
- `VERIFIED`: official identity and recruitment role passed deterministic
  verification;
- `ACTIVE`: at least one current opening was extracted;
- `NO_OPENINGS`: the inspected page explicitly reports no openings;
- `UNKNOWN`: recruitment structure exists but vacancy state cannot be proved;
- `BLOCKED`: access control, CAPTCHA, login, or rate limiting prevented review;
- `FAILED`: navigation, network, or parsing failed.

## Approaches considered

### Extend only the browser script

This is the smallest change, but it would duplicate verification, extraction,
and persistence rules outside the application pipeline. It is not selected.

### Add a recruitment-entry traversal component

The browser runner discovers and inspects related entry points, while the
existing verification engine remains the sole authority for official identity.
The existing extractor and repository remain responsible for jobs and storage.
This is the selected approach.

### Make the job extractor discover entry points

This reduces the number of components but mixes navigation, identity
verification, and job parsing. It is not selected.

## Architecture

Add a focused recruitment-entry traversal component with two boundaries:

1. A pure link classifier accepts a base portal and observed links, resolves
   canonical URLs, assigns recruitment types, rejects unsafe or irrelevant
   links, and deduplicates them.
2. A traversal orchestrator accepts an initial candidate and a page-inspection
   function. It visits eligible recruitment entries breadth-first, within
   depth and visit budgets, and returns immutable page observations.

The component does not declare a URL official. Every inspected observation is
still passed to the existing deterministic verification engine. Verified
observations can then be passed to the existing job extractor and SQLite
repository.

The browser runner remains an adapter and report producer. Provider contracts
and `engine/upstream/providers/**` are unchanged.

## Navigation rules

- Inspect the initial candidate URL.
- Discover social, campus, graduate, internship, and general job-list links.
- Traverse at most two navigation levels from the initial candidate.
- Visit each canonical URL at most once.
- Prefer breadth-first traversal so top-level recruitment categories are
  inspected before deeper job details.
- Follow first-party links on the same registrable official domain.
- Follow ATS links only after the existing identity/tenant evidence confirms
  their relationship to the company.
- Do not follow advertisements, news, universities, government pages,
  training providers, or recruitment aggregators as official portals.
- Preserve matching ATS, BOSS, Liepin, and similar pages as degraded leads when
  no official portal is available.
- Never bypass CAPTCHA, login, access controls, rate limits, or browser
  fingerprint checks.

## Page observations

Each inspected entry records:

- source candidate URL and final URL;
- recruitment type;
- navigation depth and parent URL;
- page status and failure reason;
- title and bounded visible-text evidence;
- detected job-list structure;
- explicit empty-state evidence;
- extracted job count;
- inspection timestamp.

Recruitment navigation alone does not prove active recruiting. `ACTIVE`
requires one or more successfully extracted current openings.
`NO_OPENINGS` requires explicit page evidence. A page that merely fails to
render or parse remains `UNKNOWN`, `BLOCKED`, or `FAILED`.

## Job-detail policy

The system should prefer list-page extraction. It opens an individual job
detail only when required to obtain an actionable apply URL, publication date,
job status, title, or location. Detail traversal stops when the requested job
count is reached.

Job details are not treated as peer recruitment portals. Their relationship to
the parent `CareerPortal` remains explicit through existing job-opening fields.

## Data flow

```text
Search Provider or browser search
  -> candidate URL (DISCOVERED)
  -> recruitment-entry traversal
  -> page observations
  -> deterministic verification
  -> CareerPortal upsert and evidence replacement
  -> verified page job extraction
  -> JobOpening upsert
  -> DiscoveryLog outcome
  -> run and quality report
```

Existing URL roles remain distinct:

`companyCareerHomeUrl -> campaignLandingUrl -> jobListUrl -> jobDetailUrl -> applyUrl`

One URL must not be copied into every role.

## SQLite behavior

No migration is required.

- `CareerPortal` stores each canonical social, campus, internship, graduate, or
  general recruitment entry independently, including recruitment type,
  verification status, confidence, and evidence.
- `JobOpening` stores openings extracted from the corresponding verified portal.
- `DiscoveryLog` records visits and terminal outcomes such as
  `VERIFIED_PORTAL`, `JOBS_EXTRACTED`, `NO_RECENT_JOBS`, `REVIEW_REQUIRED`,
  fetch failure, blocked access, and rejected candidates.
- Existing canonical URL and company merge behavior handles reruns
  idempotently.

## Browser report changes

The browser report should distinguish:

- candidate URLs discovered;
- recruitment entries inspected;
- entries verified;
- active entries;
- explicit no-opening entries;
- unknown entries;
- blocked entries;
- failed entries;
- jobs extracted.

The summary must never count `DISCOVERED` as inspected or verified.

## Failure handling

- Search challenge: company status is `BLOCKED`.
- Child entry challenge: that entry is `BLOCKED`; sibling entries continue.
- Navigation or parsing error: that entry is `FAILED`; sibling entries continue.
- Dynamic page with no conclusive job state: `UNKNOWN`.
- Explicit empty state: `NO_OPENINGS`.
- Cross-domain or irrelevant navigation: reject with bounded evidence.
- A single child failure does not fail the company or batch.

## Testing

Use test-driven development.

Unit tests cover:

- recruitment-type classification;
- canonical URL deduplication;
- breadth-first traversal and maximum depth;
- same-domain and verified-ATS boundaries;
- explicit empty, unknown, blocked, and failed states;
- no duplicate visits.

Integration tests cover:

- a social portal discovering campus and internship siblings;
- every discovered sibling being inspected rather than left `DISCOVERED`;
- verified portals and extracted openings written to SQLite;
- rerun idempotency;
- one blocked child not stopping sibling inspection;
- existing CLI and provider-contract behavior remaining unchanged.

After deterministic tests pass, run a single-company live Meituan Canary. The
report must disclose network, CAPTCHA, dynamic-rendering, verification, and
extraction failures exactly as observed. Only then resume browser batches of
twenty companies.

## Acceptance criteria

- A discovered recruitment entry is visited before it can be reported as
  inspected, active, empty, or verified.
- Meituan social recruitment discovery also checks accessible campus,
  internship, and general recruitment entries.
- An existing navigation link alone never produces `ACTIVE`.
- Successful extraction writes jobs to SQLite with their source portal.
- Blocked and failed pages are not reported as empty searches.
- No existing provider, domain model, migration, or CLI argument changes.
- The complete existing test suite remains green.
