# 浏览器检索同步核验与岗位字段补齐实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 让公司名单的 Playwright/Chrome 检索在每家公司搜索完成后，立即执行确定性官网或 ATS 核验、招聘子入口遍历、岗位抽取和 SQLite 写入，并对没有明确证据的地区、日期、招聘批次与投递动作保持空值。

**架构：** 保留现有 `discoverMarketJobs()`、Verification Engine、上游岗位抽取适配器和 SQLite Schema。新增浏览器观测适配器与公司批次编排器，将真实浏览器页面观测伪装成可重放的 `fetchPage`，把搜索结果转换为现有 Company Discovery 可消费的 Search Provider 响应；现有流水线新增一个默认关闭的“保留所有已观测开放岗位”策略，浏览器数据生产启用它，原有 CLI 行为不变。

**技术栈：** Node.js 20 ESM、Playwright、现有 deterministic Verification Engine、现有 upstream page providers、better-sqlite3、`node:test`。

---

## 文件结构与职责

- 创建 `src/adapters/browser/browser-page-observation-adapter.mjs`
  - 规范化浏览器页面观测；
  - 按 URL 提供可重放 `fetchPage`；
  - 将浏览器候选转换为现有 Company Discovery 的搜索结果；
  - 不做官网真实性决策。
- 创建 `src/application/ingest-browser-company-result.mjs`
  - 为单家公司组装浏览器搜索来源、确定性验证、岗位抽取和现有 `discoverMarketJobs()`；
  - 使用现有 Repository 写入 Company、CareerPortal、JobOpening、DiscoveryLog。
- 创建 `src/application/run-browser-company-batch.mjs`
  - 复用现有 discovery batch checkpoint；
  - 每家公司完成搜索后立即入库；
  - 单家公司失败不终止批次。
- 修改 `scripts/company-browser-discovery.mjs`
  - 页面读取增加完整 DOM、文本、最终 URL、HTTP 状态、链接和观测时间；
  - `jobui.com` 明确拒绝；
  - 未被预先证明的 ATS 只成为待验证候选；
  - 增加 `--database`、`--role`、`--industry`、`--location`、`--freshness-days`、`--target-count`、`--batch-id`、`--retry-failed`；
  - 每家公司搜索后调用批次入库逻辑。
- 修改 `src/application/discover-market-jobs.mjs`
  - 新增默认值为 `requested_recent` 的内部 `openingRetention` 依赖；
  - 浏览器生产模式使用 `all_observed_active`；
  - 在 DiscoveryLog 中记录岗位字段缺失证据；
  - 不修改 Domain Model、Schema、Provider Contract 或默认 CLI 行为。
- 修改 `package.json`
  - 增加可重复运行的 `discover:browser-companies` 脚本。
- 创建 `tests/browser-page-observation-adapter.test.mjs`
  - 覆盖页面观测、URL 重放、候选转换和缺失字段不推断。
- 创建 `tests/ingest-browser-company-result.test.mjs`
  - 覆盖确定性验证、子入口、字段保存、待审核与拒绝隔离。
- 创建 `tests/browser-company-batch.test.mjs`
  - 覆盖逐公司写入、断点续跑和单条失败隔离。
- 修改 `tests/company-browser-discovery.test.mjs`
  - 覆盖 `jobui.com`、ATS 待验证候选和页面观测。
- 修改 `tests/discover-market-jobs.test.mjs`
  - 覆盖浏览器保留策略，同时证明默认筛选行为不变。
- 修改 `.agents/skills/lite-job-search/SKILL.md`
  - 将“浏览器检索后同步核验、抽取、入库和报告”写入固定流程。

数据库不新增表、不新增列、不运行迁移。现有字段承载：

- `CareerPortal.recruitmentTypes`：校招、实习、社招和专项招聘；
- `JobOpening.locations`：明确岗位地区，否则 `[]`；
- `JobOpening.publishedAt`：明确发布时间，否则 `null`；
- `JobOpening.closesAt`：明确截止时间，否则 `null`；
- `JobOpening.employmentType`：明确岗位或批次类型，否则 `null`；
- `JobOpening.jobDetailUrl` / `applyUrl`：保持链接角色分离；
- `DiscoveryLog.metadata`：字段覆盖和缺失证据。

### 任务 1：建立浏览器页面观测适配器

**文件：**

- 创建：`src/adapters/browser/browser-page-observation-adapter.mjs`
- 创建：`tests/browser-page-observation-adapter.test.mjs`

- [ ] **步骤 1：编写候选转换和页面重放的失败测试**

```js
test('browser candidates remain candidates until deterministic verification', () => {
  const adapted = adaptBrowserCompanyResult({
    company: '示例科技',
    officialDomain: 'example.com',
    query: '示例科技 招聘',
    officialCandidates: [{
      classification: 'OFFICIAL_CANDIDATE',
      url: 'https://jobs.example.com/openings',
      title: '示例科技招聘',
      recruitmentType: 'SOCIAL',
    }],
  });

  assert.equal(adapted.items[0].officialDomainSource, 'registry');
  assert.equal(adapted.items[0].verifiedTenant, false);
  assert.deepEqual(adapted.items[0].recruitmentTypes, ['experienced']);
});

test('observation fetcher returns explicit values and never invents missing fields', async () => {
  const fetchPage = createBrowserObservationFetcher([{
    requestedUrl: 'https://jobs.example.com/openings',
    finalUrl: 'https://jobs.example.com/openings',
    status: 200,
    title: '招聘职位',
    html: '<h1>招聘职位</h1>',
    text: '招聘职位',
    links: [],
    observedAt: '2026-07-25T00:00:00.000Z',
  }]);

  const page = await fetchPage('https://jobs.example.com/openings');
  assert.equal(page.finalUrl, 'https://jobs.example.com/openings');
  assert.equal(page.publishedAt, undefined);
  assert.equal(page.closesAt, undefined);
  assert.equal(page.location, undefined);
});
```

- [ ] **步骤 2：运行测试并确认因模块不存在而失败**

运行：

```powershell
node --test tests/browser-page-observation-adapter.test.mjs
```

预期：FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现最小浏览器观测适配器**

```js
const TYPE_MAP = Object.freeze({
  SOCIAL: 'experienced',
  GRADUATE: 'campus',
  INTERNSHIP: 'internship',
});

export function adaptBrowserCompanyResult(result = {}) {
  const items = (result.officialCandidates || []).map((candidate, index) => ({
    company: result.company,
    aliases: result.aliases || [],
    url: candidate.url,
    title: candidate.title,
    rank: index + 1,
    sourceType: 'browser_observation',
    confirmedOfficialDomain: result.officialDomain || null,
    officialDomainSource: result.officialDomain ? 'registry' : null,
    verifiedTenant: false,
    recruitmentTypes: TYPE_MAP[candidate.recruitmentType]
      ? [TYPE_MAP[candidate.recruitmentType]]
      : [],
  }));
  return { items, query: result.query };
}

export function createBrowserObservationFetcher(observations = []) {
  const byUrl = new Map(observations.flatMap((page) => (
    [page.requestedUrl, page.finalUrl].filter(Boolean).map((url) => [canonical(url), page])
  )));
  return async (url) => {
    const page = byUrl.get(canonical(url));
    if (!page) throw new Error(`missing browser observation: ${url}`);
    return structuredClone(page);
  };
}
```

适配器必须拒绝非 HTTP(S) URL，并保留 `BLOCKED`、`FAILED` 和 HTTP 状态；不得把浏览器搜索分类结果转换成 `verificationStatus=VERIFIED`。

- [ ] **步骤 4：运行测试并确认通过**

运行：

```powershell
node --test tests/browser-page-observation-adapter.test.mjs
```

预期：PASS。

- [ ] **步骤 5：提交**

```powershell
git add src/adapters/browser/browser-page-observation-adapter.mjs tests/browser-page-observation-adapter.test.mjs
git commit -m "feat(browser): adapt page observations for verification"
```

### 任务 2：让浏览器生产模式保存明确观测到的开放岗位

**文件：**

- 修改：`src/application/discover-market-jobs.mjs`
- 修改：`tests/discover-market-jobs.test.mjs`

- [ ] **步骤 1：编写默认行为与浏览器保留策略的失败测试**

```js
test('browser production retains active openings with blank optional fields', async (t) => {
  const { repository, dependencies } = await createHarness({
    publishedAt: null,
    title: '后端开发工程师',
  });
  t.after(() => repository.close());
  dependencies.openingRetention = 'all_observed_active';

  const result = await discoverMarketJobs(INTENT, dependencies);
  const [opening] = repository.listJobOpenings();

  assert.equal(result.jobsStored, 1);
  assert.equal(opening.publishedAt, null);
  assert.equal(opening.closesAt, null);
  assert.deepEqual(opening.locations, ['上海']);
  assert.ok(repository.listDiscoveryLogs().some((log) => (
    log.metadata.missingFields?.includes('publishedAt')
  )));
});

test('default discovery still rejects unknown-date and role-mismatch openings', async (t) => {
  const { repository, dependencies } = await createHarness({
    publishedAt: null,
    title: '后端开发工程师',
  });
  t.after(() => repository.close());

  await discoverMarketJobs(INTENT, dependencies);
  assert.equal(repository.listJobOpenings().length, 0);
});
```

- [ ] **步骤 2：运行测试并确认第一条失败、第二条保持通过**

运行：

```powershell
node --test tests/discover-market-jobs.test.mjs
```

预期：新增浏览器生产测试 FAIL；现有默认行为测试 PASS。

- [ ] **步骤 3：实现显式保留策略和缺失证据**

在依赖解构中加入：

```js
openingRetention = 'requested_recent',
```

在岗位循环内使用：

```js
const retainAllObserved = openingRetention === 'all_observed_active';
const missingFields = [
  !opening.locations.length && 'location',
  !opening.publishedAt && 'publishedAt',
  !opening.closesAt && 'closesAt',
  !(opening.employmentType || portal.recruitmentTypes.length) && 'recruitmentType',
  !opening.applyUrl && 'applyUrl',
].filter(Boolean);

const rejectionReason = opening.status !== 'ACTIVE'
  ? 'opening_not_active'
  : !retainAllObserved && !matchesRequestedRole(opening, intent)
    ? 'role_mismatch'
    : !retainAllObserved && !matchesRequestedLocation(opening, intent)
      ? 'location_mismatch'
      : !hasUsableJobEntry(opening, portal)
        ? 'usable_job_entry_missing'
        : null;

const outsideWindow = !retainAllObserved && !isRecentOpening(opening, {
  freshnessDays: intent.freshnessDays,
  now: Date.parse(now()),
});
```

成功日志增加：

```js
fieldCoverage: {
  location: Boolean(opening.locations.length),
  publishedAt: Boolean(opening.publishedAt),
  closesAt: Boolean(opening.closesAt),
  recruitmentType: Boolean(opening.employmentType || portal.recruitmentTypes.length),
  applyUrl: Boolean(opening.applyUrl),
},
missingFields,
```

缺失值只记录为日志证据，不回填推断值。

- [ ] **步骤 4：运行应用流水线测试**

运行：

```powershell
node --test tests/discover-market-jobs.test.mjs tests/sqlite-repository.test.mjs
```

预期：PASS；SQLite 往返后 `null` 与空数组保持不变。

- [ ] **步骤 5：提交**

```powershell
git add src/application/discover-market-jobs.mjs tests/discover-market-jobs.test.mjs
git commit -m "feat(discovery): retain observed browser openings"
```

### 任务 3：建立单家公司同步核验与入库闭环

**文件：**

- 创建：`src/application/ingest-browser-company-result.mjs`
- 创建：`tests/ingest-browser-company-result.test.mjs`

- [ ] **步骤 1：编写完整链路失败测试**

```js
test('browser result verifies portal, traverses entries, extracts jobs and writes SQLite', async (t) => {
  const NOW = '2026-07-25T00:00:00.000Z';
  const companyResult = {
    company: '示例科技',
    officialDomain: 'example.com',
    query: '示例科技 招聘',
    officialCandidates: [{
      classification: 'OFFICIAL_CANDIDATE',
      title: '示例科技招聘',
      url: 'https://jobs.example.com/openings',
      recruitmentType: 'SOCIAL',
    }],
    observations: [{
      requestedUrl: 'https://jobs.example.com/openings',
      finalUrl: 'https://jobs.example.com/openings',
      status: 200,
      title: '示例科技招聘',
      html: `<script type="application/ld+json">${JSON.stringify({
        '@type': 'JobPosting',
        title: 'AI 产品经理',
        url: 'https://jobs.example.com/openings/ai-pm',
      })}</script><h1>招聘职位</h1>`,
      text: '招聘职位 AI 产品经理',
      links: [],
      observedAt: NOW,
      vacancyStatus: 'UNKNOWN',
    }],
  };
  const result = await ingestBrowserCompanyResult({
    companyResult,
    role: '公开招聘岗位',
    industry: ['AI'],
    freshnessDays: 90,
    targetCount: 1000,
  }, { repository, now: () => NOW });

  assert.equal(result.report.searchQueries[0], '示例科技 招聘');
  assert.equal(repository.listCompanies().length, 1);
  assert.equal(repository.listCareerPortals()[0].verificationStatus, 'VERIFIED');
  assert.equal(repository.listJobOpenings()[0].title, 'AI 产品经理');
  assert.equal(repository.listJobOpenings()[0].publishedAt, null);
});

test('review and rejected candidates never create formal openings', async () => {
  const companyResult = {
    company: '待审核公司',
    officialDomain: '',
    query: '待审核公司 招聘',
    officialCandidates: [{
      classification: 'VERIFICATION_CANDIDATE',
      title: '待审核公司招聘',
      url: 'https://unknown.example/jobs',
    }],
    observations: [{
      requestedUrl: 'https://unknown.example/jobs',
      finalUrl: 'https://unknown.example/jobs',
      status: 200,
      title: 'Jobs',
      html: '<h1>Jobs</h1>',
      text: 'Jobs',
      links: [],
      observedAt: '2026-07-25T00:00:00.000Z',
      vacancyStatus: 'UNKNOWN',
    }],
  };
  await ingestBrowserCompanyResult({
    companyResult,
    role: '公开招聘岗位',
  }, {
    repository,
    now: () => '2026-07-25T00:00:00.000Z',
  });
  assert.equal(repository.listJobOpenings().length, 0);
  assert.ok(repository.listCareerPortals().every((portal) => (
    portal.verificationStatus !== 'VERIFIED'
  )));
});
```

- [ ] **步骤 2：运行测试并确认模块不存在**

运行：

```powershell
node --test tests/ingest-browser-company-result.test.mjs
```

预期：FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现单家公司应用服务**

应用服务必须：

1. 调用 `adaptBrowserCompanyResult()`；
2. 构造只返回实际浏览器 Query 的确定性 planning fixture；
3. 构造 `searchSource.search()`，Provider 固定为 `chrome_baidu_visible_search`，并设置 `liveSearchExecuted=true`；
4. 使用 `createOfficialVerificationAdapter()`；
5. 使用 `createUpstreamJobExtractionAdapter()`；
6. 使用 `createBrowserObservationFetcher()`；
7. 调用现有 `discoverMarketJobs()`，传入 `openingRetention='all_observed_active'`；
8. 不调用 LLM，不把浏览器候选预标记为 VERIFIED。

核心调用：

```js
return discoverMarketJobs({
  market: 'CN',
  roleType: role || '公开招聘岗位',
  industryTags: industry,
  location: location || '',
  freshnessDays,
  targetCount,
}, {
  repository,
  planningModel: createBrowserPlanningModel(adapted.query),
  searchSource: createBrowserSearchSource(adapted),
  verificationAdapter: createOfficialVerificationAdapter({ now }),
  jobExtractor: createUpstreamJobExtractionAdapter({ fetchPage, now }),
  fetchPage,
  ids: createBrowserRunIds(companyResult),
  now,
  openingRetention: 'all_observed_active',
});
```

- [ ] **步骤 4：运行单家公司闭环测试**

运行：

```powershell
node --test tests/ingest-browser-company-result.test.mjs tests/verification-engine.test.mjs tests/upstream-adapters.test.mjs
```

预期：PASS，且待审核/拒绝页面没有岗位写入。

- [ ] **步骤 5：提交**

```powershell
git add src/application/ingest-browser-company-result.mjs tests/ingest-browser-company-result.test.mjs
git commit -m "feat(discovery): ingest browser company results"
```

### 任务 4：浏览器页面捕获完整验证与岗位抽取证据

**文件：**

- 修改：`scripts/company-browser-discovery.mjs`
- 修改：`tests/company-browser-discovery.test.mjs`

- [ ] **步骤 1：编写页面观测、Jobui 排除和 ATS 候选失败测试**

```js
test('rejects Jobui before opening it', () => {
  const decision = classifySearchResult({
    company: '示例科技',
    title: '示例科技招聘',
    url: 'https://www.jobui.com/company/123/jobs/',
    kind: 'organic',
  });
  assert.deepEqual(decision, {
    classification: 'REJECTED',
    reasonCode: 'excluded_jobui_domain',
  });
});

test('keeps recruitment-shaped ATS URL as unverified candidate', () => {
  const decision = classifySearchResult({
    company: '示例科技',
    officialDomain: 'example.com',
    title: '示例科技招聘',
    url: 'https://example.jobs.mokahr.com/social-recruitment',
    kind: 'organic',
  });
  assert.equal(decision.classification, 'VERIFICATION_CANDIDATE');
});

test('captures rendered DOM and explicit links for downstream verification', async () => {
  const socialUrl = 'https://jobs.example.com/social';
  const campusUrl = 'https://jobs.example.com/campus';
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent('示例科技 招聘')}`;
  const browser = fakeBrowser({
    [searchUrl]: {
      text: '示例科技招聘',
      searchRows: [{
        title: '示例科技招聘',
        href: socialUrl,
        snippet: '示例科技社会招聘',
        kind: 'organic',
      }],
    },
    [socialUrl]: {
      title: '示例科技招聘',
      html: '<html><body><h1>招聘职位</h1><a href="/campus">校园招聘</a></body></html>',
      text: '招聘职位 校园招聘',
      links: [{ text: '校园招聘', href: campusUrl }],
    },
    [campusUrl]: {
      title: '校园招聘',
      html: '<html><body><h1>校园招聘</h1></body></html>',
      text: '校园招聘',
      links: [],
    },
  });
  const NOW = '2026-07-25T00:00:00.000Z';
  const result = await discoverCompanyWithBrowser({
    company: '示例科技',
    officialDomain: 'example.com',
    browser,
    now: () => NOW,
  });
  const observation = result.observations.find((item) => item.finalUrl === socialUrl);
  assert.match(observation.html, /招聘职位/);
  assert.equal(observation.status, 200);
  assert.equal(observation.observedAt, NOW);
  assert.deepEqual(observation.links[0], { text: '校园招聘', href: campusUrl });
});
```

- [ ] **步骤 2：运行浏览器脚本测试并确认失败**

运行：

```powershell
node --test tests/company-browser-discovery.test.mjs
```

预期：新增测试 FAIL。

- [ ] **步骤 3：实现完整页面观测**

`readCareerPage()` 返回：

```js
{
  requestedUrl: url,
  finalUrl: page.url(),
  status: response?.status?.() || 200,
  title,
  html: await page.locator('html').evaluate((node) => node.outerHTML),
  text,
  links,
  observedAt: now(),
  fetchStatus: 'COMPLETED',
  vacancyStatus,
}
```

限制：

- `jobui.com` 在导航前拒绝；
- 广告和新闻在导航前拒绝；
- 第三方招聘平台继续为 `LEAD_ONLY`；
- 招聘形态的未知域名为 `VERIFICATION_CANDIDATE`，只能交给 Verification Engine；
- `BLOCKED` 页面保留 HTTP 状态和挑战证据；
- 不从公司总部、URL 路径或爬取时间推断岗位字段。

- [ ] **步骤 4：运行浏览器测试**

运行：

```powershell
node --test tests/company-browser-discovery.test.mjs tests/browser-page-observation-adapter.test.mjs
```

预期：PASS。

- [ ] **步骤 5：提交**

```powershell
git add scripts/company-browser-discovery.mjs tests/company-browser-discovery.test.mjs
git commit -m "feat(browser): capture verification page evidence"
```

### 任务 5：接入公司级 checkpoint 和同步 SQLite 写入

**文件：**

- 创建：`src/application/run-browser-company-batch.mjs`
- 创建：`tests/browser-company-batch.test.mjs`
- 修改：`scripts/company-browser-discovery.mjs`
- 修改：`package.json`

- [ ] **步骤 1：编写断点续跑与失败隔离的失败测试**

```js
test('writes each company before starting the next and resumes succeeded items', async () => {
  const events = [];
  const input = {
    batchId: 'browser-2026-07-25',
    companies: [{ company: '甲公司' }, { company: '乙公司' }],
  };
  const dependencies = {
    repository,
    discoverCompany: async (company) => {
      events.push(`search:${company.company}`);
      if (company.company === '乙公司') throw new Error('network failed');
      return {
        company: company.company,
        query: `${company.company} 招聘`,
        status: 'COMPLETED',
        officialCandidates: [],
        observations: [],
      };
    },
    ingestCompany: async ({ companyResult }) => {
      events.push(`stored:${companyResult.company}`);
      return { status: 'COMPLETE', runId: `run-${companyResult.company}` };
    },
  };
  const first = await runBrowserCompanyBatch({
    ...input,
  }, dependencies);

  assert.deepEqual(events.slice(0, 2), ['search:甲公司', 'stored:甲公司']);
  assert.equal(first.status, 'COMPLETE_WITH_ERRORS');

  events.length = 0;
  await runBrowserCompanyBatch(input, dependencies);
  assert.ok(!events.includes('search:甲公司'));
});
```

- [ ] **步骤 2：运行测试并确认模块不存在**

运行：

```powershell
node --test tests/browser-company-batch.test.mjs
```

预期：FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现公司级批次编排**

复用 `runDiscoveryBatch()`，每个 `runItem` 严格顺序执行：

```js
runItem: async (company) => {
  const companyResult = await discoverCompany(company);
  if (companyResult.status === 'BLOCKED') {
    return { status: 'BLOCKED', reason: companyResult.reasonCode };
  }
  if (companyResult.status === 'FAILED') {
    return { status: 'FAILED', reason: companyResult.reasonCode };
  }
  return ingestCompany({ companyResult, ...runOptions });
},
```

批次 item key 使用公司身份键，不使用数组位置；成功公司自动跳过，失败公司只有传入 `retryFailed=true` 才重试。

- [ ] **步骤 4：让 CLI 每家公司搜索后立即入库**

`scripts/company-browser-discovery.mjs`：

- 打开一次 Browser 和一次 SQLite Repository；
- 调用 `runBrowserCompanyBatch()`；
- `discoverCompany` 完成后立即调用 `ingestBrowserCompanyResult()`；
- 仍输出 `candidates.json`、`leads.json`、`report.json`；
- 新增 `run-report.json`，包含 Provider、候选数、验证数、审核数、拒绝数、岗位数、失败原因和字段覆盖；
- 输出数据库绝对路径；
- 关闭顺序为 Browser，再 Repository；
- CAPTCHA 返回 BLOCKED checkpoint，不绕过。

- [ ] **步骤 5：增加 npm 固定入口**

```json
"discover:browser-companies": "node ./scripts/company-browser-discovery.mjs"
```

- [ ] **步骤 6：运行批次和 CLI 回归测试**

运行：

```powershell
node --test tests/browser-company-batch.test.mjs tests/company-browser-discovery.test.mjs tests/discovery-batch.test.mjs tests/market-discovery-cli.test.mjs
```

预期：PASS；原有 `discover` 和 `discover-batch` CLI 行为不变。

- [ ] **步骤 7：提交**

```powershell
git add src/application/run-browser-company-batch.mjs tests/browser-company-batch.test.mjs scripts/company-browser-discovery.mjs package.json
git commit -m "feat(browser): persist company discovery batches"
```

### 任务 6：固定证据报告与 Skill 流程

**文件：**

- 修改：`.agents/skills/lite-job-search/SKILL.md`
- 创建：`tests/browser-run-report.test.mjs`
- 修改：`scripts/company-browser-discovery.mjs`

- [ ] **步骤 1：编写运行报告失败测试**

```js
test('browser run report separates discovery, verification, extraction and missing fields', () => {
  const report = buildBrowserRunReport({
    companyResults: [{
      company: '示例科技',
      query: '示例科技 招聘',
      status: 'COMPLETED',
      officialCandidates: [{ url: 'https://jobs.example.com/openings' }],
      failures: [],
    }],
    discoveryRuns: [{
      report: {
        portalDecisions: [
          { verificationStatus: 'VERIFIED', confidenceScore: 0.9 },
          { verificationStatus: 'REVIEW', confidenceScore: 0.5 },
        ],
        extractedJobs: [
          {
            title: 'AI 产品经理',
            locations: ['上海'],
            publishedAt: '2026-07-20T00:00:00.000Z',
            closesAt: null,
            employmentType: 'experienced',
            applyUrl: 'https://jobs.example.com/openings/ai-pm/apply',
          },
          {
            title: '后端开发工程师',
            locations: [],
            publishedAt: null,
            closesAt: null,
            employmentType: null,
            applyUrl: null,
          },
        ],
        failures: [{
          stage: 'page_fetch',
          code: 'FETCH_FAILED',
          url: 'https://jobs.example.com/blocked',
          message: 'network failed',
        }],
      },
    }],
  });
  assert.equal(report.discovery.provider, 'chrome_baidu_visible_search');
  assert.equal(report.verification.verified, 1);
  assert.equal(report.verification.pendingReview, 1);
  assert.equal(report.extraction.jobsStored, 2);
  assert.deepEqual(report.fieldCoverage.publishedAt, { present: 1, missing: 1 });
  assert.ok(report.failures.some((item) => item.code === 'FETCH_FAILED'));
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：

```powershell
node --test tests/browser-run-report.test.mjs
```

预期：FAIL，`buildBrowserRunReport` 尚不存在。

- [ ] **步骤 3：实现报告聚合**

报告必须包含：

- 实际 Query 和 Provider；
- 搜索结果、候选 URL、候选公司；
- VERIFIED、REVIEW、REJECTED、BLOCKED；
- 成功提取公司与岗位；
- `location`、`publishedAt`、`closesAt`、`recruitmentType`、`applyUrl` 的 present/missing；
- 每一步失败的 stage、code、URL 和经过截断/脱敏的 message；
- 不把 NOT_CONFIGURED、FAILED、BLOCKED 计作空结果或成功。

- [ ] **步骤 4：更新 Skill 固定流程**

Skill 增加：

```text
公司浏览器检索固定流程：
搜索 -> 保存页面观测 -> 确定性验证 -> 招聘入口遍历
-> 岗位抽取 -> SQLite -> 运行报告 -> 学生 XLSX 投影。

没有明确日期、地区、招聘批次或投递动作时保持空白。
未验证候选和第三方线索不得进入学生 XLSX。
```

- [ ] **步骤 5：运行报告与 Skill 测试**

运行：

```powershell
node --test tests/browser-run-report.test.mjs tests/skill-package.test.mjs
```

预期：PASS。

- [ ] **步骤 6：提交**

```powershell
git add scripts/company-browser-discovery.mjs tests/browser-run-report.test.mjs .agents/skills/lite-job-search/SKILL.md
git commit -m "docs(skill): fix browser verification workflow"
```

### 任务 7：全量回归、真实 Canary 与现有名单回填

**文件：**

- 生成但不提交：`test-output/browser-inline-canary-*`
- 更新但不提交：运行所指定的 SQLite 数据库

- [ ] **步骤 1：运行静态和核心回归**

运行：

```powershell
node --check scripts/company-browser-discovery.mjs
node --check src/adapters/browser/browser-page-observation-adapter.mjs
node --check src/application/ingest-browser-company-result.mjs
node --check src/application/run-browser-company-batch.mjs
npm.cmd run test:market-discovery
node --test tests/company-browser-discovery.test.mjs tests/browser-page-observation-adapter.test.mjs tests/ingest-browser-company-result.test.mjs tests/browser-company-batch.test.mjs tests/browser-run-report.test.mjs
```

预期：全部 PASS。

- [ ] **步骤 2：运行完整测试**

运行：

```powershell
npm.cmd test
```

预期：PASS；不得修改 `engine/upstream/providers/**`。

- [ ] **步骤 3：运行 2 家真实浏览器 Canary**

使用 Golden Dataset 中有官方域名、且已知存在招聘入口的两家公司。命令格式：

```powershell
npm.cmd run discover:browser-companies -- --input data/company-registry/browser-canary-2.json --output-dir test-output/browser-inline-canary-2 --database data/lite-job-search.sqlite --role "公开招聘岗位" --freshness-days 90 --target-count 1000 --batch-id browser-inline-canary-2 --headful
```

验收：

- Browser 实际打开百度结果和候选招聘页；
- `run-report.json` 显示实际 Query、Provider 和失败原因；
- SQLite 中出现经过 Verification Engine 决策的 Portal；
- 只有 VERIFIED Portal 产生 JobOpening；
- 日期、地区和批次缺失时保持空值；
- CAPTCHA、网络失败或浏览器断开明确为 BLOCKED/FAILED。

- [ ] **步骤 4：审计 Canary SQLite**

运行只读查询，核对：

```sql
SELECT verification_status, COUNT(*) FROM career_portals GROUP BY verification_status;
SELECT COUNT(*) FROM job_openings;
SELECT
  SUM(CASE WHEN published_at IS NULL THEN 1 ELSE 0 END) AS missing_published_at,
  SUM(CASE WHEN closes_at IS NULL THEN 1 ELSE 0 END) AS missing_closes_at,
  SUM(CASE WHEN locations_json = '[]' THEN 1 ELSE 0 END) AS missing_location
FROM job_openings;
```

预期：数量与 `run-report.json` 一致；不得用 `observedAt` 填充日期。

- [ ] **步骤 5：从已完成名单断点继续回填**

使用 `data/company-registry/golden-seed-companies-v1-to-v4-current.json`，沿用固定 `batch-id` 和当前 SQLite。成功 checkpoint 自动跳过；只对失败项显式使用 `--retry-failed`。每批 50 家，批内连续处理；只有 CAPTCHA、网络失败或浏览器断开才暂停。

- [ ] **步骤 6：生成最终质量报告**

输出：

- 唯一公司数；
- 搜索完成、BLOCKED、FAILED；
- 候选 URL；
- VERIFIED、REVIEW、REJECTED；
- 有岗位公司数、岗位数；
- 官方验证率、岗位抽取成功率、重复率、误报率、平均置信度；
- 地区、开始时间、截止时间、招聘批次、投递链接覆盖率；
- Top 成功与失败案例及 evidence。

- [ ] **步骤 7：检查保护边界和工作区**

运行：

```powershell
git diff --check
git status --short
git diff --name-only HEAD | Select-String -Pattern '^engine/upstream/providers/' -Quiet
```

预期：`git diff --check` 无输出；Provider 保护检查返回 false；数据库、缓存、测试输出和浏览器现场不暂存。

- [ ] **步骤 8：提交最终测试与文档修正**

只提交源码、测试和文档：

```powershell
git add src scripts tests package.json .agents/skills/lite-job-search/SKILL.md docs
git commit -m "test(browser): verify inline recruitment data canary"
```

不得提交 SQLite、浏览器 Profile、Token、缓存、生成工作簿或 `test-output/`。
