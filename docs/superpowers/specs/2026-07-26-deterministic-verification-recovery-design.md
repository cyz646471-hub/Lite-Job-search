# Deterministic Verification Recovery Design

## Goal

Increase the precision and usable yield of the China browser-discovery pipeline
without lowering the official-verification threshold, granting the LLM
verification authority, or requiring a human-review gate.

The change addresses three observed failure modes:

1. company seeds usually lack an official domain, so genuine first-party career
   pages cannot obtain an identity anchor;
2. ATS pages discovered directly from search results lack a directed,
   auditable relationship to a verified company site;
3. broad full-page keyword checks misclassify legitimate career pages as news
   reprints or commercial training providers.

## Non-goals

- Do not change `engine/upstream/providers/**`.
- Do not change Provider contracts, core Domain Models, database schema, or CLI
  arguments.
- Do not let an LLM establish official identity, ATS ownership, evidence
  weights, or verification status.
- Do not accept a candidate merely because its URL contains a company name.
- Do not make manual review part of the normal production path.
- Do not weaken exclusions for aggregators, universities, news articles,
  commercial training providers, private forms, payment risks, `jobui.com`, or
  `jobs.51job.com`.

## Chosen approach

Use a deterministic two-pass verification flow.

The first pass evaluates candidates using existing evidence. When a first-party
candidate has recruitment semantics but the company lacks an official domain,
the pipeline may establish a run-scoped official-domain anchor from independent
page identity signals. It then re-runs the existing Verification Engine with
that anchor. A verified first-party page may authorize outbound ATS tenant
links, which are inspected in a second pass.

The official-domain anchor is persisted through the existing Company upsert. No
new table or migration is required.

## Architecture

### 1. First-party official-domain bootstrap

Add a focused deterministic component under `src/verification/` that evaluates
whether an observed non-ATS candidate can establish an official company domain.

Inputs:

- normalized company name and aliases;
- candidate and final URL;
- page title, H1, visible text, and parsed links;
- page role and recruitment semantics;
- excluded-domain and ATS classification.

The component returns either:

```js
{
  status: 'CONFIRMED',
  registrableDomain: 'mihoyo.com',
  evidence: [
    { code: 'company_brand_match', observedValue: '米哈游' },
    { code: 'recruitment_structure', observedValue: 'CAREER_HOME' }
  ]
}
```

or:

```js
{
  status: 'INSUFFICIENT_EVIDENCE',
  registrableDomain: null,
  evidence: []
}
```

A domain is confirmed only when all of the following hold:

1. the final URL is public HTTP(S), reachable, and not excluded;
2. the registrable domain is not an ATS, aggregator, university, news,
   commercial-training, private-form, or payment domain;
3. the page has an explicit recruitment role;
4. at least two independent company-identity signals match normalized company
   names or aliases:
   - title or site title;
   - H1 or primary page heading;
   - visible legal/copyright/site-brand text;
   - a same-domain corporate-home link with matching brand text.

Repeated occurrences in the same field count as one signal. Search-result text
does not count as page identity evidence. The candidate domain itself does not
count as an identity signal.

The confirmed domain is added to the run-scoped Company input and the same page
is re-inspected by the existing official-verification adapter. This produces
the existing `official_domain_match` evidence and retains the 50-point and
identity-anchor requirements.

### 2. Directed ATS ownership

An ATS tenant becomes eligible for official verification only when:

1. its parent page is `VERIFIED`;
2. the parent URL belongs to a confirmed company domain;
3. the ATS URL is an explicit link observed on that parent page;
4. the child URL matches a supported ATS fingerprint;
5. the child page contains recruitment structure and no hard-negative evidence.

The traversal records:

- `parentOfficialVerified: true`;
- `officialAttributionUrl: <verified parent URL>`;
- `verifiedTenant: true`.

The existing adapter then emits `verified_ats_tenant` and
`official_site_confirms_ats_tenant`. Direct ATS search results remain
unverified and trigger automatic first-party-domain discovery; they do not
enter job extraction and do not require human approval.

### 3. Scoped hard-negative classification

Replace full-page substring rejection with source-role-aware checks.

Aggregator and university decisions remain domain-first hard exclusions.

`news_reprint` is emitted only when:

- the host is a known news/content host; or
- the URL uses a news/article/media/press path and the page title or H1 is
  article-shaped;

and the page is not a verified first-party recruitment surface.

`training_provider` is emitted only when:

- the host or URL is training/coaching-shaped; or
- the title or H1 contains a commercial training phrase such as
  `职业培训`, `求职辅导`, `付费内推`, `训练营`, `career coaching`, or
  `bootcamp`;

and the page is not a verified first-party recruitment surface.

Generic employee-development language such as `培训`, `课程`, `人才发展`, or
`learning` in body text is never sufficient for a hard rejection.

Domain exclusions run before content rules so an aggregator cannot be
misreported as a training provider.

## Data flow

```text
Search result
  -> candidate filtering
  -> page observation
  -> existing verification pass
  -> if missing identity anchor and first-party-shaped:
       deterministic domain bootstrap
       -> confirmed domain added to run-scoped Company
       -> existing verification re-run
  -> if VERIFIED:
       traverse explicit recruitment links
       -> first-party child verification
       -> directed ATS verification
  -> only VERIFIED portals
       -> job extraction
       -> SQLite
```

Insufficient identity evidence remains the existing `REVIEW` portal status,
but the application workflow interprets it as an automatic evidence-recovery
state. It is not exposed as a required human action and never enters formal job
extraction.

## Evidence and persistence

The bootstrap component returns audit evidence, but it does not introduce a new
scoring weight. It supplies a confirmed domain to the existing Company model;
the existing adapter then emits the scored `official_domain_match` evidence.

The current Company upsert persists the confirmed domain. A later run can reuse
it without repeating bootstrap, while normal domain-conflict protections remain
active.

ATS attribution continues to use the existing evidence codes:

- `verified_ats_tenant`;
- `official_site_confirms_ats_tenant`;
- `official_site_backlink`.

No database migration is needed.

## Failure handling

- An unreadable or blocked page cannot bootstrap a domain.
- A company-name mismatch cannot bootstrap a domain.
- A direct ATS result without verified parent attribution remains unverified.
- A conflicting previously confirmed domain prevents automatic merge and is
  reported as a deterministic identity conflict.
- A hard-excluded domain remains rejected before positive scoring.
- Missing evidence is recorded and retried by the automated discovery workflow;
  it is not converted to success or delegated to mandatory manual review.

## Test strategy

### Domain bootstrap regression tests

- empty-domain 米哈游-style career page with independent title and body brand
  signals confirms `mihoyo.com`;
- a recruitment-shaped unrelated domain with only URL self-reference does not
  confirm;
- an aggregator or ATS domain cannot bootstrap;
- conflicting company names cannot bootstrap.

### ATS attribution regression tests

- ATS linked from a newly verified first-party page is verified;
- direct search-result ATS without a verified parent remains unverified;
- ATS linked from an unverified parent remains unverified;
- tenant and parent evidence are retained.

### Hard-negative regression tests

- legitimate first-party recruitment pages containing employee training,
  courses, or a news navigation item are not hard rejected;
- genuine article pages remain `news_reprint`;
- genuine commercial coaching/training pages remain `training_provider`;
- Jobui, 51job, university, and aggregator domains remain hard rejected.

### Integration and quality checks

- browser ingestion still writes jobs only below `VERIFIED` portals;
- existing CLI behavior and provider contracts remain unchanged;
- all repository tests and skill validation pass;
- replay a bounded real-Chrome canary over representative first-party, ATS, and
  excluded examples and compare verified/rejected counts without fabricating
  unavailable fields.

## Expected quality effect

The change should reclassify genuine first-party recruitment domains that were
previously capped at 15 or 30 points because the seed lacked an official domain.
It should also allow ATS tenants reached from those newly verified pages to
obtain directed ownership evidence.

The design does not predict an exact verification-rate increase before a real
canary. Reported quality changes must use observed post-change results. False
positive rate remains unavailable until a labeled benchmark exists; deterministic
rejection rate and evidence-recovery rate are reported separately.
