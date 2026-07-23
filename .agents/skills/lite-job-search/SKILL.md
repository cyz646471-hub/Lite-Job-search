---
name: lite-job-search
description: Discover, collect, verify, deduplicate, and export public job openings and official recruitment entry points for China and North America. Use when an agent needs to search one company or a company list, inspect Chinese campus or internship leads, scan North American ATS boards, distinguish source documents from official career/apply URLs, validate current job-list pages, or produce reusable JSON/JSONL/CSV search results without using Career OP resume, scoring, or application-tracking features.
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

Use small batches first. For Apify Google search, use the extracted `ApifyGoogleSearchProvider.runBatch()` in groups of 20–100 queries; never launch one Actor run per company.

## Verify candidates

```powershell
node bin/lite-job-search.mjs verify --input .\candidates.json --output .\verified.json --json
```

Verification must keep these roles separate:

`companyCareerHomeUrl` → `campaignLandingUrl` → `jobListUrl` → `jobDetailUrl` → `applyUrl`.

Do not copy one URL into every role. Aggregators, media, universities, government pages and public-account articles normally remain `sourceUrl`.

Use the degradation order:

`local HTTP → local Playwright → Apify raw HTTP → Apify browser → manual review`.

Do not bypass login, access controls, CAPTCHA/验证码, rate limits, browser fingerprints, or anti-bot systems. Never submit an application, upload a resume, accept terms, or send messages.

## Export

```powershell
node bin/lite-job-search.mjs export --input .\verified.json --output .\verified.csv --format csv --json
node bin/lite-job-search.mjs export --input .\verified.json --output .\verified.jsonl --format jsonl --json
```

Preserve audit fields and all source URLs during conversion.

Student-facing XLSX is a downstream compatibility projection of verified `JobOpening` records. Keep company, role, location, publication date, and the deepest verified apply/detail URL visible; render URLs as Excel hyperlinks and hide audit-only fields. Do not expose rejected or review-only portals as application links.

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
