---
name: lite-job-search
description: Discover, collect, verify, deduplicate, and export public job openings and official recruitment entry points for China and North America. Use when an agent needs to search one company or a company list, inspect Chinese campus or internship leads, scan North American ATS boards, distinguish source documents from official career/apply URLs, validate current job-list pages, or produce reusable JSON/JSONL/CSV/XLSX search results without using Career OP resume, scoring, or application-tracking features.
---

# Lite Job Search

Use the repository CLI for deterministic work. Keep discovery evidence separate from verified official recruitment links.

## Locate the repository

Treat the directory containing `.agents/skills/lite-job-search/` as the project root. Run commands from that project root, or call `bin/lite-job-search.mjs` by absolute path.

Install dependencies once:

```powershell
npm.cmd install --ignore-scripts
```

After installing the package globally or linking it with `npm.cmd link`, these entry points are equivalent to the `node bin/...` examples below:

```text
lite-job-search doctor
lite-job-search search
lite-job-search batch
lite-job-search verify
lite-job-search export
lite-job-search discover
lite-job-search discover-batch
```

## Choose the workflow

1. Run `lite-job-search doctor --json`.
2. Select `CN` for mainland China or `NA` for the United States and Canada.
3. Search one company first. Use batch mode only after checking result quality.
4. Verify candidate pages before presenting them as official or actionable.
5. Export the verified results.

Read [china-market.md](references/china-market.md) for Chinese discovery sources, browser search and official-link rules. Read [north-america-market.md](references/north-america-market.md) for ATS and board coverage. Read [data-contract.md](references/data-contract.md) before transforming or merging results.

## Diagnose configuration

```powershell
node bin/lite-job-search.mjs doctor --json
```

Interpret states literally:

- `no_provider`: continue with manual/browser discovery or deterministic official-site discovery.
- `single_provider`: live search is usable without automatic failover.
- `primary_fallback`: retry the fallback only after a retryable primary failure.
- `liveSearchExecuted: false`: do not claim a real API search occurred.

Never print keys. Only report `configured` or `not_configured`.

## Search one company

```powershell
node bin/lite-job-search.mjs search --market CN --company "小红书" --official-domain xiaohongshu.com --json
node bin/lite-job-search.mjs search --market NA --company "Stripe" --json
```

To import candidates gathered by a browser or another model:

```powershell
node bin/lite-job-search.mjs search --market CN --company "小红书" --manual .\manual-candidates.json --json
```

Manual records use:

```json
[
  {
    "company": "小红书",
    "title": "小红书招聘官网",
    "url": "https://job.xiaohongshu.com/"
  }
]
```

Mark these as `discoveryMethod=manual`. Do not count them as API search evidence.

## Discover the market from a role

Use this workflow when the user starts with a role, industry, freshness window, and target count:

```powershell
node bin/lite-job-search.mjs discover `
  --market CN `
  --role "AI产品经理" `
  --industry "AI,互联网" `
  --since-days 90 `
  --limit 20 `
  --database ".\data\lite-job-search.sqlite" `
  --json
```

The LLM may only expand job 关键词 and generate search Query. LLM 不能决定官网真实性、verification status、evidence weight 或 confidence score. Deterministic code fetches candidates, validates identity and page role, extracts jobs, and writes the accepted chain to SQLite.

Count candidate companies, verified career portals, and usable apply entries separately. A candidate URL cannot prove itself official. Aggregators, university employment sites, news reprints, and training providers are rejected as official portals. Unknown `publishedAt` values do not satisfy a recent-only request.

Return `PARTIAL` when verified recent openings do not reach the requested count. Return `NOT_CONFIGURED`, `DEFERRED_BY_BUDGET`, or `BLOCKED` literally; none means “no jobs”.

The run report must include search queries, candidate URL/company counts, portal
decision counts, extracted jobs, stage failures, provider attempts, LLM usage,
and observed quality metrics. Never convert `NOT_CONFIGURED` or `FAILED` into a
successful empty result.

## Discover role and industry batches

Use a JSON array such as `examples/first-data-batch.json`:

```powershell
node bin/lite-job-search.mjs discover-batch `
  --input .\examples\first-data-batch.json `
  --batch-id cn-first-production `
  --database .\data\lite-job-search.sqlite `
  --json
```

Successful items are skipped on resume. Failed items remain checkpointed; use
`--retry-failed` only after configuration, network, or Provider failures are
resolved. One failed item must not stop later items.

Quality reporting uses observed denominators for official verification, job
extraction, duplicates, false positives, and average deterministic confidence.
An unavailable denominator is `null`.

## Search a batch

Input JSON or CSV must include `company` and `market`:

```json
[
  { "company": "小红书", "market": "CN", "officialDomain": "xiaohongshu.com" },
  { "company": "Stripe", "market": "NA" }
]
```

Run:

```powershell
node bin/lite-job-search.mjs batch --input .\companies.json --output .\candidates.json --json
```

Use small batches first. The natural-language China production workflow uses only
the user's normal Chrome session and visible Baidu results. Baidu API and Apify
are disabled for that workflow and must not be used as fallbacks.

## Run browser company discovery

When a public search engine must be inspected in a real browser, use the fixed
company workflow:

`search → page observation → deterministic verification → recruitment-entry traversal → job extraction → SQLite → run report → student XLSX projection`.

Run:

```powershell
npm.cmd run discover:browser-companies -- `
  --input .\data\company-registry\companies.json `
  --output-dir .\test-output\browser-company-run `
  --database .\data\lite-job-search.sqlite `
  --role "公开招聘岗位" `
  --freshness-days 90 `
  --target-count 1000 `
  --batch-id browser-company-run `
  --headful
```

Each company is checkpointed only after its browser search result has passed
through the existing Verification Engine and job-extraction pipeline. Successful
companies are skipped on resume. Use `--retry-failed` to retry failed or blocked
items after the external cause is resolved.

The browser classification is candidate recall, not official-site authority.
Unknown ATS-shaped URLs remain verification candidates. `jobui.com`, ads, news,
university employment sites, training providers, and unverified aggregators
must not enter the student application list.

Only explicit page evidence may populate location, `publishedAt`, `closesAt`,
recruitment type, `jobDetailUrl`, and `applyUrl`. If the page does not state a
value, keep it blank and record the missing field in `DiscoveryLog.metadata`.
Never substitute crawl time for publication/start time or company headquarters
for job location.

The browser run must write `run-report.json` with the actual Query, Provider,
candidate counts, verification decisions, extracted jobs, field coverage, and
stage failures. CAPTCHA, network failure, browser disconnection, or an
unconfigured dependency remains `BLOCKED`, `FAILED`, or `NOT_CONFIGURED`; none
is a successful empty search.

## Run a complete task from one Chinese instruction

Use the instruction runner when the user supplies market, freshness, role, and
company count in one sentence:

```powershell
npm.cmd run discover:instruction -- `
  "检索近90天内中国，开放产品经理方向岗位公司100个"
```

The deterministic compiler fills the worker manifest, loads the current local
company registry, excludes every company already represented in SQLite by
formal name, bilingual name, alias, or official domain, and writes
`task-manifest.json` plus `selected-companies.json` before browser work begins.
It then runs the existing browser worker repeatedly with the same selection
batch id until the selected companies are complete or the circuit breaker,
browser, or Provider stops progress.

Use `--plan-only` to inspect the compiled task and selected companies without
starting Chrome. A configured `--company-supplement-module` may provide more
company identities when local registries are insufficient. Without one, retain
the truthful `NOT_CONFIGURED` supplement status and process the local subset;
do not fabricate the missing companies.

This instruction layer has no verification authority. The existing
deterministic Verification Engine remains the only component allowed to mark an
official site or ATS as verified.

## Verify candidates

```powershell
node bin/lite-job-search.mjs verify --input .\candidates.json --output .\verified.json --json
```

Verification must keep these roles separate:

`companyCareerHomeUrl` → `campaignLandingUrl` → `jobListUrl` → `jobDetailUrl` → `applyUrl`.

Do not copy one URL into every role. Aggregators, media, universities, government pages and public-account articles normally remain `sourceUrl`.

Use the degradation order:

`local HTTP → user's normal Chrome session → manual review`.

Do not use an isolated `persistent-chrome` profile for Baidu search pages in the
China production workflow. If the normal Chrome extension binding is unavailable,
return `NOT_CONFIGURED`. If Baidu shows CAPTCHA or access verification, preserve
the checkpoint and return `BLOCKED`; do not switch to Baidu API, Apify, another
search engine, or a fresh browser profile to bypass it.

Do not bypass login, access controls, CAPTCHA/验证码, rate limits, browser fingerprints, or anti-bot systems. Never submit an application, upload a resume, accept terms, or send messages.

## Current production browser policy

This policy supersedes earlier normal-Chrome and extension-binding guidance in
this file. China production discovery uses
`run-persistent-browser-supervisor.mjs`: a long-running Node.js process that
owns one Playwright `launchPersistentContext` and a dedicated automation
`userDataDir` for the full SQLite queue run. Never use a daily/default Chrome
profile or borrow a user Chrome extension host. The dedicated profile is
exclusive to one supervisor process and may retain only its own browser state
across restarts. CAPTCHA and access challenges must be checkpointed as
`BLOCKED`; do not bypass them or silently change to Baidu API, Apify, another
search engine, or a fresh profile.

## Operate the local control plane

The Web control plane never owns Playwright. Start it with:

```powershell
npm.cmd run web -- --database data/lite-job-search.sqlite --port 4317
```

Use `npm.cmd run control -- status`, `stop --batch <id> --confirm`, and
`resume --batch <id> --confirm` for SQLite-backed worker control. A stop is
cooperative and batch-scoped.

After a human completes a Baidu challenge, run `control -- baidu-ack --confirm`.
This does not close the circuit. One worker must atomically acquire the
`HALF_OPEN` probe lease and reach a real results page before the state becomes
`CLOSED`. Never refresh, retry, switch engines, or run a second probe while the
lease is held.

## Export

```powershell
node bin/lite-job-search.mjs export --input .\verified.json --output .\verified.csv --format csv --json
node bin/lite-job-search.mjs export --input .\verified.json --output .\verified.jsonl --format jsonl --json
node bin/lite-job-search.mjs export --input .\verified.json --output .\verified.student.xlsx --format xlsx --json
```

Preserve audit fields and all source URLs during conversion.

### Fixed student XLSX workflow

Student-facing XLSX is a downstream compatibility projection of verified `JobOpening` records. For China and North America, `export --format xlsx` creates one `投递清单` worksheet with exactly these columns: 公司名称、公司类型（模型判断）、开放批次、开放岗位、地区、开始时间、截止时间、投递链接. The entry cell is a clickable `查看岗位并投递` hyperlink. Do not include evidence URLs, source-provider details, cache data, or other audit-only fields in that sheet, and do not expose rejected or review-only portals as application links.

When `batch` or `verify` receives a non-XLSX `--output`, keep the requested primary JSON/JSONL/CSV output and automatically write the sibling `<basename>.student.xlsx`. A direct XLSX output is not duplicated.

Use the deepest verified official role in this order: direct application, job detail, job list, campaign landing, career home. For persisted report records, `recruitmentEntryUrl` may be used only when `entryType` is an `official_*` value, `官方招聘站或受委托 ATS`, or `企业官方招聘公告（公众号）`; never use a discovery-evidence URL as the student entry. Only active verified openings belong in the final student list. Leave missing links blank rather than substituting discovery evidence.

Company type is a model advisory, not official-site evidence. Display its label only when the recorded confidence is at least `0.8`; otherwise use `待确认`. Preserve classification evidence outside the student sheet. Use `未披露` for missing dates and `招满即止` only when that deadline semantics is explicit.

XLSX export requires the Codex Desktop spreadsheet runtime. If it is unavailable, stop with the runtime error; do not write text content to an `.xlsx` file or substitute another workbook library.

## Use the bundled runner

Run a single search from any working directory:

```powershell
node ".agents\skills\lite-job-search\scripts\run-search.mjs" search --market CN --company "小红书" --json
```

The Node runner is preferred because it is not affected by PowerShell execution policy. `run-search.ps1` remains available on Windows. Both resolve the repository root and invoke the same CLI; neither uses global Career OP state.

## Report results

Always distinguish:

- provider code implemented;
- provider configured;
- connectivity verified;
- live search executed;
- candidate discovered;
- official identity verified;
- job list or application action confirmed.

When blocked by budget, return `search_deferred_by_budget`. Do not reinterpret it as “no official entry”.
