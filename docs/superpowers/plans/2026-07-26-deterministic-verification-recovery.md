# Deterministic Verification Recovery Implementation Plan

> **For AI agent workers:** Required sub-skill: use
> `superpowers:executing-plans` to implement this plan task by task. Track each
> step with checkboxes and preserve red/green test evidence.

**Goal:** Recover genuine first-party recruitment portals and their directed ATS
tenants without lowering verification thresholds, weakening exclusions, or
requiring human review.

**Architecture:** Add a small deterministic official-domain bootstrap component
and integrate it additively into the existing verification adapter. The
application pipeline persists a confirmed domain through the existing Company
upsert and allows a verified parent to authorize explicit ATS child links.
Hard-negative classification becomes domain/path/title scoped instead of
full-page keyword matching.

**Tech stack:** Node.js ESM, built-in `node:test`, existing browser observation
adapter, existing Verification Engine, SQLite repository.

---

## Files and responsibilities

- Create `src/verification/official-domain-bootstrap.mjs`
  - derive a run-scoped official domain only from independent first-party page
    identity signals;
  - reject ATS, aggregator, university, news, and training/coaching sources.
- Modify `src/adapters/upstream/official-verification-adapter.mjs`
  - scope hard negatives;
  - invoke domain bootstrap when Company has no official domain;
  - return a confirmed domain and neutral bootstrap audit evidence.
- Modify `src/verification/evidence-codes.mjs`
  - register neutral, zero-weight bootstrap audit codes.
- Modify `src/application/discover-market-jobs.mjs`
  - rebuild and persist Company with a confirmed bootstrap domain;
  - propagate that domain to child candidates;
  - permit one attributed ATS re-evaluation after an earlier direct,
    unattributed inspection of the same URL.
- Test `tests/official-domain-bootstrap.test.mjs`
  - focused bootstrap unit behavior.
- Test `tests/upstream-adapters.test.mjs`
  - hard-negative scoping and adapter audit evidence.
- Test `tests/ingest-browser-company-result.test.mjs`
  - end-to-end first-party bootstrap, ATS attribution, persistence, and
    extraction invariants.
- Test `tests/discover-market-jobs.test.mjs`
  - candidate assurance-key behavior when the same ATS URL is first direct and
    later attributed.

## Task 1: Scope hard-negative classification

**Files:**

- Modify: `tests/upstream-adapters.test.mjs`
- Modify: `src/adapters/upstream/official-verification-adapter.mjs`

- [ ] **Step 1: Add failing regression tests**

Add tests proving body/navigation language alone is not a hard negative:

```js
test('news navigation on a recruitment page is not a news reprint', async () => {
  const result = await createVerificationAdapter().inspect({
    company: { canonicalName: '极飞科技', officialDomains: ['xa.com'] },
    candidate: { url: 'https://www.xa.com/about/career' },
    page: {
      status: 200,
      finalUrl: 'https://www.xa.com/about/career',
      title: '极飞科技招聘',
      html: '<main><h1>加入我们</h1><p>开放职位</p></main><nav>新闻</nav>',
    },
  });
  assert.ok(!result.evidence.some((item) => item.code === 'news_reprint'));
});

test('employee courses on a career page are not a training provider', async () => {
  const result = await createVerificationAdapter().inspect({
    company: { canonicalName: '完美世界', officialDomains: ['wanmei.com'] },
    candidate: { url: 'https://jobs.games.wanmei.com/school.html' },
    page: {
      status: 200,
      finalUrl: 'https://jobs.games.wanmei.com/school.html',
      title: '完美世界校园招聘',
      html: '<main><h1>校园招聘</h1><p>员工课程与人才发展</p></main>',
    },
  });
  assert.ok(!result.evidence.some((item) => item.code === 'training_provider'));
});
```

Retain and extend genuine-negative tests for an article-shaped page,
commercial coaching page, Jobui, 51job, and an aggregator.

- [ ] **Step 2: Run the tests and verify red**

Run:

```powershell
node --test tests/upstream-adapters.test.mjs
```

Expected: the navigation/course regressions fail because current logic scans the
full page body.

- [ ] **Step 3: Implement source-scoped negative checks**

Change `hardNegativeCode()` so it:

```js
const channel = classifyRecruitmentUrl(url).channel;
if (channel === 'discovery_index') return 'aggregator_domain';
if (isUniversityHost(host)) return 'university_employment_site';
if (isNewsSurface({ host, pathname, title, h1 })) return 'news_reprint';
if (isTrainingSurface({ host, pathname, title, h1 })) return 'training_provider';
return '';
```

Use URL path, title, and parsed H1. Do not use generic `新闻`, `培训`, or `课程`
matches from the full body.

- [ ] **Step 4: Run targeted tests and verify green**

Run:

```powershell
node --test tests/upstream-adapters.test.mjs
```

Expected: all upstream adapter tests pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/adapters/upstream/official-verification-adapter.mjs tests/upstream-adapters.test.mjs
git commit -m "fix(verification): scope hard negative page signals"
```

## Task 2: Add deterministic official-domain bootstrap

**Files:**

- Create: `src/verification/official-domain-bootstrap.mjs`
- Create: `tests/official-domain-bootstrap.test.mjs`
- Modify: `src/verification/evidence-codes.mjs`
- Modify: `src/adapters/upstream/official-verification-adapter.mjs`
- Modify: `tests/upstream-adapters.test.mjs`

- [ ] **Step 1: Add failing bootstrap unit tests**

Define the intended API:

```js
const result = bootstrapOfficialDomain({
  company: { canonicalName: '米哈游', aliases: [] },
  candidate: { url: 'https://jobs.mihoyo.com/' },
  page: {
    status: 200,
    finalUrl: 'https://jobs.mihoyo.com/',
    title: '米哈游招聘',
    html: '<main><h1>加入米哈游</h1><p>开放职位</p></main>',
  },
  pageType: 'CAREER_HOME',
  atsType: '',
});
assert.equal(result.status, 'CONFIRMED');
assert.equal(result.registrableDomain, 'mihoyo.com');
assert.deepEqual(result.matchedSignals, ['title', 'h1']);
```

Add negative cases:

- only one matching field;
- unrelated company name;
- ATS URL;
- Jobui/51job/aggregator URL;
- blocked or unknown-role page.

- [ ] **Step 2: Run bootstrap tests and verify red**

Run:

```powershell
node --test tests/official-domain-bootstrap.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the bootstrap component**

Implement:

```js
export function bootstrapOfficialDomain({
  company,
  candidate,
  page,
  pageType,
  atsType,
} = {}) {
  // Normalize company/alias variants.
  // Reject excluded, ATS, unreachable, and UNKNOWN-role pages.
  // Count title, H1, legal/footer/body, and same-domain corporate-link fields.
  // Confirm only when at least two distinct fields match.
}
```

Use `registrableDomainOf()` and existing URL classification. Normalize legal
suffixes and whitespace, but do not infer English brands absent from Company
names/aliases.

- [ ] **Step 4: Verify bootstrap tests green**

Run:

```powershell
node --test tests/official-domain-bootstrap.test.mjs
```

Expected: all bootstrap tests pass.

- [ ] **Step 5: Add adapter red tests**

Add an adapter test proving an empty-domain first-party page returns:

```js
assert.equal(result.confirmedOfficialDomain, 'mihoyo.com');
assert.ok(result.evidence.some((item) => item.code === 'official_domain_match'));
assert.ok(result.evidence.some((item) => item.code === 'domain_bootstrap_confirmed'));
```

Also assert a candidate with only self-domain evidence does not bootstrap.

- [ ] **Step 6: Run adapter tests and verify red**

Run:

```powershell
node --test tests/upstream-adapters.test.mjs
```

Expected: no `confirmedOfficialDomain` before integration.

- [ ] **Step 7: Integrate bootstrap into the adapter**

Register neutral evidence codes:

```js
company_brand_match: {
  direction: 'NEUTRAL',
  weight: 0,
  identityAnchor: false,
},
domain_bootstrap_confirmed: {
  direction: 'NEUTRAL',
  weight: 0,
  identityAnchor: false,
},
```

When Company has no domain and the page is eligible, call
`bootstrapOfficialDomain()`, inspect with the confirmed domain included, emit
`official_domain_match`, append the neutral audit codes, and return
`confirmedOfficialDomain`.

- [ ] **Step 8: Run Task 2 tests and verify green**

Run:

```powershell
node --test tests/official-domain-bootstrap.test.mjs tests/upstream-adapters.test.mjs
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 2**

```powershell
git add src/verification/official-domain-bootstrap.mjs src/verification/evidence-codes.mjs src/adapters/upstream/official-verification-adapter.mjs tests/official-domain-bootstrap.test.mjs tests/upstream-adapters.test.mjs
git commit -m "feat(verification): bootstrap first party official domains"
```

## Task 3: Persist recovered domains and verify directed ATS children

**Files:**

- Modify: `src/application/discover-market-jobs.mjs`
- Modify: `tests/ingest-browser-company-result.test.mjs`
- Modify: `tests/discover-market-jobs.test.mjs`

- [ ] **Step 1: Add first-party ingestion regression test**

Create a completed browser result with:

- empty `officialDomain`;
- `https://jobs.mihoyo.com/`;
- title and H1 company matches;
- recruitment structure and an explicit job.

Assert:

```js
assert.equal(repository.listCompanies()[0].primaryOfficialDomain, 'mihoyo.com');
assert.equal(repository.listCareerPortals()[0].verificationStatus, 'VERIFIED');
assert.equal(repository.listJobOpenings().length, 1);
```

- [ ] **Step 2: Run the ingestion test and verify red**

Run:

```powershell
node --test tests/ingest-browser-company-result.test.mjs
```

Expected: portal remains unverified and no job is stored.

- [ ] **Step 3: Persist the recovered domain**

After `verificationAdapter.inspect()`:

```js
if (inspected.confirmedOfficialDomain) {
  company = createCompany({
    ...company,
    primaryOfficialDomain: inspected.confirmedOfficialDomain,
    officialDomains: [
      ...company.officialDomains,
      inspected.confirmedOfficialDomain,
    ],
  }, { now: now() });
}
```

Propagate `confirmedOfficialDomain` when enqueueing first-party and ATS child
candidates.

- [ ] **Step 4: Verify first-party ingestion green**

Run:

```powershell
node --test tests/ingest-browser-company-result.test.mjs
```

Expected: recovered Company domain, VERIFIED portal, and extracted job persist
atomically.

- [ ] **Step 5: Add attributed ATS integration test**

Use a verified first-party parent with an explicit Moka child link and matching
child observation. Assert:

```js
const atsPortal = repository.listCareerPortals()
  .find((portal) => portal.atsType === 'MOKA');
assert.equal(atsPortal.verificationStatus, 'VERIFIED');
assert.ok(atsPortal.evidence.some(
  (item) => item.code === 'official_site_confirms_ats_tenant',
));
```

Add a paired direct-ATS test proving the same tenant remains unverified without
the verified parent.

- [ ] **Step 6: Add assurance-key retry test**

In `tests/discover-market-jobs.test.mjs`, construct candidates where an ATS URL
is seen directly before an official parent links to it. Expect a second,
attributed inspection and a final VERIFIED ATS portal.

- [ ] **Step 7: Run ATS tests and verify red**

Run:

```powershell
node --test tests/ingest-browser-company-result.test.mjs tests/discover-market-jobs.test.mjs
```

Expected: the directly processed ATS URL prevents attributed re-evaluation.

- [ ] **Step 8: Implement assurance-aware candidate deduplication**

Replace URL-only processed keys with:

```js
function candidateAssuranceKey(candidate) {
  return `${canonicalHttpUrl(candidate.url)}|${
    candidate.parentOfficialVerified && candidate.verifiedTenant
      ? 'officially_attributed'
      : 'unattributed'
  }`;
}
```

Allow an `officially_attributed` ATS candidate once even when the same URL was
previously processed as `unattributed`. Continue preventing repeated traversal
at the same assurance level.

- [ ] **Step 9: Run Task 3 tests and verify green**

Run:

```powershell
node --test tests/ingest-browser-company-result.test.mjs tests/discover-market-jobs.test.mjs
```

Expected: first-party bootstrap, directed ATS, direct ATS rejection, and
deduplication tests all pass.

- [ ] **Step 10: Commit Task 3**

```powershell
git add src/application/discover-market-jobs.mjs tests/ingest-browser-company-result.test.mjs tests/discover-market-jobs.test.mjs
git commit -m "feat(discovery): recover attributed ATS candidates"
```

## Task 4: Verify quality and regression safety

**Files:**

- Modify only if a failing regression requires a scoped correction.
- Do not stage user-owned untracked files or generated reports.

- [ ] **Step 1: Run the focused verification suite**

Run:

```powershell
node --test tests/official-domain-bootstrap.test.mjs tests/upstream-adapters.test.mjs tests/ingest-browser-company-result.test.mjs tests/discover-market-jobs.test.mjs tests/verification-policy.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Run the full suite**

Run:

```powershell
npm.cmd test
```

Expected: zero failures.

- [ ] **Step 3: Validate the skill package**

Run:

```powershell
npm.cmd run validate:skill
```

Expected: zero failures.

- [ ] **Step 4: Run formatting and boundary checks**

Run:

```powershell
git diff --check
git status --short
git diff --name-only HEAD~3
```

Confirm:

- no changes under `engine/upstream/providers/**`;
- no Domain Model or database migration changes;
- user-owned untracked files remain untouched.

- [ ] **Step 5: Run a bounded quality canary**

Use saved browser observations when available. If a real Chrome refresh is
needed, run a bounded representative sample containing:

- first-party empty-domain examples;
- an official-to-ATS example;
- a direct ATS example;
- Jobui/51job/aggregator negatives.

Report observed:

- official verification rate;
- evidence-recovery rate;
- deterministic rejection rate;
- job extraction success rate;
- false-positive rate as `null` unless labeled ground truth exists.

- [ ] **Step 6: Final commit if verification required a correction**

Stage only scoped source and tests:

```powershell
git add src/verification/official-domain-bootstrap.mjs src/verification/evidence-codes.mjs src/adapters/upstream/official-verification-adapter.mjs src/application/discover-market-jobs.mjs tests/official-domain-bootstrap.test.mjs tests/upstream-adapters.test.mjs tests/ingest-browser-company-result.test.mjs tests/discover-market-jobs.test.mjs
git commit -m "test(verification): cover deterministic recovery canary"
```

If no correction or additional fixture is needed, do not create an empty
commit.
