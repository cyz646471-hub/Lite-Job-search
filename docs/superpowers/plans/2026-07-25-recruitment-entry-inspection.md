# Recruitment Entry Inspection Implementation Plan

> **For AI agents:** Use `superpowers:executing-plans` in this session. Track
> every checkbox, use test-driven development, and preserve provider, domain,
> schema, and CLI compatibility.

**Goal:** Require discovered recruitment candidates to be opened, expand their
social/campus/internship/general recruitment navigation, inspect every eligible
entry, and pass each observation through the existing verification, extraction,
and SQLite pipeline.

**Architecture:** Add a small pure recruitment-entry discovery module, use it
from both the browser discovery runner and `discoverMarketJobs`, and convert the
application candidate loop into a bounded queue. Browser observations remain
evidence only; the existing verification engine remains the authority for
official identity.

**Tech stack:** Node.js 20 ESM, Playwright, `tldts`, `node:test`,
`better-sqlite3`.

---

## File structure

- Create `src/discovery/recruitment-entry-discovery.mjs`: canonicalize and
  classify recruitment navigation links, enforce domain/depth/visit budgets,
  and construct child candidates.
- Modify `src/application/discover-market-jobs.mjs`: process initial and child
  candidates through one bounded queue and preserve child inspection outcomes
  in reports and SQLite.
- Modify `scripts/company-browser-discovery.mjs`: use the shared classifier and
  actually visit eligible child entries instead of leaving them `DISCOVERED`.
- Modify `tests/recruitment-entry-discovery.test.mjs`: unit coverage for link
  classification, domain policy, deduplication, and depth.
- Modify `tests/discover-market-jobs.test.mjs`: application and SQLite coverage
  for sibling portals, child failures, and idempotency.
- Modify `tests/company-browser-discovery.test.mjs`: browser-runner report and
  traversal coverage using a fake browser/page harness.
- Modify `docs/company-browser-discovery.md`: document inspected states and the
  distinction between candidate evidence and verified official portals.

Protected paths not modified:

- `engine/upstream/providers/**`
- `src/domain/**`
- `src/storage/migrations/**`
- provider contracts and existing CLI argument behavior

### Task 1: Pure recruitment-entry discovery

**Files:**

- Create: `src/discovery/recruitment-entry-discovery.mjs`
- Create: `tests/recruitment-entry-discovery.test.mjs`

- [ ] **Step 1: Write failing link-classification tests**

Cover Chinese and English labels for social, campus/graduate, internship, and
general jobs. Assert that fragments are removed and resolved URLs remain
distinct by path/query.

```js
assert.deepEqual(
  discoverRecruitmentEntries({
    baseUrl: 'https://zhaopin.example.com/social',
    trustedRegistrableDomains: ['example.com'],
    links: [
      { text: '校园招聘', href: '/campus' },
      { text: '社会招聘', href: '/social#top' },
      { text: '实习生招聘', href: '/internship' },
    ],
  }).map(({ recruitmentType, url }) => ({ recruitmentType, url })),
  [
    { recruitmentType: 'campus', url: 'https://zhaopin.example.com/campus' },
    { recruitmentType: 'experienced', url: 'https://zhaopin.example.com/social' },
    { recruitmentType: 'internship', url: 'https://zhaopin.example.com/internship' },
  ],
);
```

- [ ] **Step 2: Run the unit test and confirm RED**

Run:

```powershell
node --test tests/recruitment-entry-discovery.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimum pure module**

Export:

```js
export function recruitmentTypeForEntry(text, url) {}
export function discoverRecruitmentEntries({
  baseUrl,
  links,
  trustedRegistrableDomains,
  verifiedAtsDomains = [],
  visitedUrls = [],
  parentUrl = null,
  depth = 1,
  maxDepth = 2,
  maxEntries = 20,
} = {}) {}
```

Return frozen records containing:

```js
{
  url,
  text,
  recruitmentType,
  parentUrl,
  depth,
  discoveryReason: 'career_navigation_link',
}
```

Allow only HTTP(S) URLs on trusted first-party domains or explicitly verified
ATS domains. Reject current-page duplicates, visited URLs, excessive depth,
and links without recruitment semantics.

- [ ] **Step 4: Add boundary tests**

Assert:

- same registrable first-party domain is accepted;
- unrelated cross-domain links are rejected;
- a verified ATS domain is accepted;
- unverified aggregators are rejected;
- duplicate canonical URLs are returned once;
- depth above two returns no entries;
- maximum entry budget is respected.

- [ ] **Step 5: Run unit tests and confirm GREEN**

Run:

```powershell
node --test tests/recruitment-entry-discovery.test.mjs
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/discovery/recruitment-entry-discovery.mjs tests/recruitment-entry-discovery.test.mjs
git commit -m "feat(discovery): classify recruitment entry links"
```

### Task 2: Browser entry traversal and status reporting

**Files:**

- Modify: `scripts/company-browser-discovery.mjs`
- Modify: `tests/company-browser-discovery.test.mjs`

- [ ] **Step 1: Write a failing browser traversal test**

Use a fake browser/page map where:

- the search result resolves to `/social`;
- `/social` links to `/campus` and `/internship`;
- `/campus` has explicit no-openings text;
- `/internship` has job-list structure;
- each URL records its visit count.

Assert that every entry is visited once and no child remains
`pageStatus: DISCOVERED`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --test --test-name-pattern="visits recruitment sibling entries" tests/company-browser-discovery.test.mjs
```

Expected: FAIL because child entries are emitted without navigation.

- [ ] **Step 3: Replace shallow child emission with bounded traversal**

Import `discoverRecruitmentEntries`. Make `readCareerPage` return a bounded
observation with:

```js
{
  status,
  url,
  title,
  hasJobStructure,
  vacancyStatus,
  evidence,
  links,
}
```

For each accepted initial candidate:

1. inspect the initial page;
2. enqueue eligible child entries;
3. inspect child entries breadth-first;
4. enqueue eligible grandchildren up to depth two;
5. attach `parentUrl`, `depth`, and normalized `recruitmentType`;
6. continue siblings after a child failure or block.

- [ ] **Step 4: Add status tests**

Assert:

- explicit empty pages are `NO_OPENINGS`;
- job structure without parsed jobs remains `UNKNOWN`;
- challenge pages are `BLOCKED`;
- navigation failures are `FAILED`;
- sibling inspection continues after block/failure;
- search advertisements and news are never opened.

- [ ] **Step 5: Update browser report counters**

Extend `buildDiscoveryReport` without removing existing fields:

```js
{
  entriesInspected,
  activeEntries,
  noOpeningEntries,
  unknownEntries,
  blockedEntries,
  failedEntries,
}
```

`DISCOVERED` does not increment `entriesInspected`.

- [ ] **Step 6: Run browser discovery tests and confirm GREEN**

Run:

```powershell
node --test tests/company-browser-discovery.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/company-browser-discovery.mjs tests/company-browser-discovery.test.mjs
git commit -m "feat(discovery): inspect recruitment entry pages"
```

### Task 3: Application queue, verification, extraction, and SQLite

**Files:**

- Modify: `src/application/discover-market-jobs.mjs`
- Modify: `tests/discover-market-jobs.test.mjs`

- [ ] **Step 1: Write a failing multi-entry SQLite test**

Extend the application harness so the verified social page contains campus and
internship links. Provide fixture pages and extractor results for each entry.

Assert:

```js
assert.equal(repository.listCareerPortals().length, 3);
assert.equal(repository.listJobOpenings().length, 2);
assert.ok(repository.listDiscoveryLogs().some(
  (item) => item.metadata.parentUrl === 'https://jobs.example.com/social',
));
```

The campus empty page must have a portal observation but no fabricated job.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --test --test-name-pattern="inspects sibling recruitment entries" tests/discover-market-jobs.test.mjs
```

Expected: FAIL because the current application loop processes only search
candidates.

- [ ] **Step 3: Convert the candidate loop to a bounded queue**

Keep search-discovery counts based on original provider candidates. Add an
internal queue with:

```js
{
  ...candidate,
  parentUrl,
  entryDepth,
  recruitmentTypes,
}
```

After an entry is deterministically verified, call
`discoverRecruitmentEntries` using `page.links` or links parsed from
`page.html`. Enqueue unseen eligible children. Use canonical final URLs for
deduplication and cap each company at twenty inspected entries.

- [ ] **Step 4: Preserve deterministic verification**

Every child must run through:

```text
fetchPage -> verificationAdapter.inspect -> verifyCareerPortal
```

Only `VERIFIED` portals can call `jobExtractor.extract` or store jobs. Do not
inherit the parent's verification result.

- [ ] **Step 5: Preserve evidence and outcomes**

Add `parentUrl`, `entryDepth`, and `recruitmentType` to discovery-log metadata.
Add report counters:

```js
recruitmentEntryInspectionCount
activeRecruitmentEntryCount
noOpeningRecruitmentEntryCount
unknownRecruitmentEntryCount
```

Child `BLOCKED` and `FAILED` observations remain failures/review evidence and do
not become empty pages.

- [ ] **Step 6: Add resilience and idempotency tests**

Assert:

- a blocked child does not prevent a verified sibling from storing jobs;
- cyclic navigation does not repeat fetches;
- two search candidates redirecting to one portal still converge;
- rerunning the fixture does not duplicate companies, portals, or jobs;
- target-count stopping does not mislabel unvisited queued entries.

- [ ] **Step 7: Run application and repository tests**

Run:

```powershell
node --test tests/discover-market-jobs.test.mjs tests/sqlite-repository.test.mjs
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src/application/discover-market-jobs.mjs tests/discover-market-jobs.test.mjs
git commit -m "feat(discovery): traverse verified recruitment entries"
```

### Task 4: Documentation and compatibility

**Files:**

- Modify: `docs/company-browser-discovery.md`
- Modify: `tests/cli.test.mjs`
- Modify: `tests/legacy-compatibility.test.mjs`

- [ ] **Step 1: Document the fixed flow**

Describe candidate discovery, mandatory entry inspection, deterministic
verification, job extraction, SQLite storage, statuses, depth limit, and
CAPTCHA boundary.

- [ ] **Step 2: Add compatibility assertions**

Confirm existing CLI help and company-browser required arguments remain
unchanged. Confirm provider imports and legacy public exports are unchanged.

- [ ] **Step 3: Run compatibility tests**

Run:

```powershell
node --test tests/cli.test.mjs tests/legacy-compatibility.test.mjs tests/engine-parity.test.mjs
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```powershell
git add docs/company-browser-discovery.md tests/cli.test.mjs tests/legacy-compatibility.test.mjs
git commit -m "docs(discovery): document recruitment entry inspection"
```

### Task 5: Full verification and live Meituan Canary

**Files:**

- Create under ignored output directory:
  `output/canary/meituan-recruitment-entry-inspection/<timestamp>/**`
- Do not commit raw browser output, session state, secrets, or SQLite databases.

- [ ] **Step 1: Run syntax and focused tests**

```powershell
node --check src/discovery/recruitment-entry-discovery.mjs
node --check src/application/discover-market-jobs.mjs
node --check scripts/company-browser-discovery.mjs
node --test tests/recruitment-entry-discovery.test.mjs tests/company-browser-discovery.test.mjs tests/discover-market-jobs.test.mjs
```

Expected: all commands exit zero.

- [ ] **Step 2: Run the complete test suite**

```powershell
npm.cmd test
```

Expected: zero failures.

- [ ] **Step 3: Inspect worktree boundaries**

```powershell
git status --short
git diff --check
git diff --name-only HEAD~4
```

Expected: no changes under `engine/upstream/providers/**`,
`src/domain/**`, or `src/storage/migrations/**`.

- [ ] **Step 4: Run one-company Meituan live Canary**

Create a temporary company input containing Meituan and its reviewed official
domain, then run the browser discovery in a visible or user-attached browser
when available. Use low frequency and stop only for CAPTCHA, access block, or
browser disconnect.

Expected report:

- initial candidate and every accessible recruitment sibling show an inspected
  terminal status;
- visited URLs and bounded evidence are present;
- no `DISCOVERED` child is represented as inspected;
- extracted jobs and SQLite rows are reported only if verification and
  extraction actually succeed.

If browser control is unavailable, record the Canary as `NOT_CONFIGURED` or
`BLOCKED`; do not claim success.

- [ ] **Step 5: Commit final verification artifacts**

Commit only source, tests, and documentation. Do not commit live output or DB.

```powershell
git status --short
git commit -m "test(discovery): verify recruitment entry inspection"
```
