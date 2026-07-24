# 岗位驱动的招聘市场发现引擎设计

## 1. 目标

将 Lite Job Search 从“已知公司名称后查找招聘官网”的工具，升级为“根据岗位需求发现招聘公司、验证官方招聘入口并抽取岗位”的市场发现引擎。

首个端到端场景为：

```text
岗位类型：AI 产品经理
行业方向：AI、互联网
市场：中国大陆
时间范围：近 90 天
数量要求：调用方指定

→ 扩展岗位关键词
→ 生成搜索策略
→ 搜索候选公司与页面
→ 确定性验证官方招聘入口
→ 下钻岗位列表和岗位详情
→ 抽取结构化岗位
→ 写入 SQLite
```

本设计采用旁路式升级。现有 `searchCompany()`、CLI 命令、Provider 和 `engine/upstream/` 保持兼容，新能力通过独立应用入口和 adapter 接入，不改变旧接口语义。

## 2. 范围

### 2.1 第一阶段

- 新增岗位发现领域模型。
- 新增关键词扩展、Query 规划和公司发现模块。
- 新增确定性官网验证策略与证据模型。
- 通过 adapter 复用现有 SearchRouter、官方候选评分、ATS 指纹、页面角色分类、身份校验和岗位抽取能力。
- 保留现有 Provider，不重写 `engine/upstream/providers/*`。
- 不接入真实数据库迁移，不改变旧 CLI 行为。

### 2.2 第二阶段

- 接入一个符合端口契约的 LLM Planning Adapter。
- 新增岗位驱动的应用用例和 CLI 命令。
- 使用 SQLite 持久化公司、招聘入口、岗位和发现日志。
- 跑通“AI 产品经理”中国大陆公开招聘页面的端到端闭环。
- 保留完整的搜索、验证和抽取证据。

### 2.3 暂不包含

- 自动提交求职申请。
- 登录、验证码处理或访问控制绕过。
- 简历解析、岗位匹配评分、求职信生成和申请跟踪。
- 重写现有 CN、NA、ATS Provider。
- 将 SQLite 提前扩展为多用户服务或分布式任务系统。
- 在前两个阶段重做 XLSX 导出；后续由现有学生 XLSX 流程消费 `JobOpening` 查询投影。

## 3. 架构决策

### 3.1 采用旁路式升级

新增稳定入口：

```js
discoverMarketJobs(searchIntent, dependencies)
```

现有入口继续保留：

```js
searchCompany(options)
searchBatch(companies, options)
verifyCandidates(candidates, options)
```

新入口不得通过改变旧函数参数或返回值来实现。旧扁平 `JobResult` 通过 `legacy/job-result-adapter.mjs` 映射到新模型。

### 3.2 LLM 只参与规划和辅助分类

LLM 允许执行：

1. 将用户岗位扩展为中英文、同义词、常见职位写法和排除词。
2. 根据市场、行业、时间范围和搜索源生成 Query。
3. 对确定性规则无法判断的低置信度页面提供辅助标签。

LLM 禁止执行：

- 确认公司官网真实性。
- 设置 `CareerPortal.verificationStatus`。
- 生成或修改确定性验证分数。
- 将搜索摘要直接认定为有效岗位或投递入口。
- 在没有页面证据时补写发布日期、公司、地点或 Apply URL。

LLM 辅助分类只能产生 `llm_advisory` 中性证据，权重固定为 0。它可以把记录送入人工复核，但不能使记录进入 `VERIFIED`。

### 3.3 程序负责事实判断

程序负责：

- 调用搜索源。
- URL 规范化、去重和抓取。
- 页面解析。
- ATS 指纹识别。
- 页面角色识别。
- 企业主体和官网真实性验证。
- 岗位抽取和时间过滤。
- 数据去重与持久化。
- 搜索、验证和失败原因审计。

### 3.4 独立身份锚点

待验证 URL 不能证明自身是官网。`VERIFIED` 必须至少包含一个来自候选 URL 之外的独立身份锚点：

- 已确认企业主域名与最终 URL 匹配。
- 企业官网主动链接到招聘入口。
- 已审核的 ATS 租户注册表命中。
- 官方公告明确列出该招聘入口。
- 企业法律主体信息与页面主体一致。

ATS 域名或 ATS 指纹本身只能证明页面使用了某个招聘系统，不能证明该租户属于目标公司。

## 4. 组件与职责

```text
SearchIntent
  → KeywordExpander
  → QueryPlanner
  → SearchRouterAdapter
  → CompanyDiscovery
  → PageFetcher / Parser
  → VerificationEngine
  → CareerPortal
  → UpstreamJobExtractionAdapter
  → JobOpeningRepository

所有搜索结果和阶段结果
  → DiscoveryLogRepository
```

### 4.1 `SearchIntent`

对用户输入进行规范化和边界验证，不生成搜索结果。

### 4.2 `KeywordExpander`

调用 LLM Planning Port，返回结构化岗位词汇，不直接调用搜索 Provider。

输出：

```js
{
  primaryRole: 'AI 产品经理',
  roleFamily: 'PRODUCT_MANAGEMENT',
  terms: ['AI 产品经理', '人工智能产品经理'],
  englishTerms: ['AI Product Manager', 'Product Manager, AI'],
  synonyms: ['智能产品经理', '大模型产品经理'],
  exclusions: ['培训', '课程', '猎头代招'],
  promptVersion: 'keyword-expansion-v1'
}
```

### 4.3 `QueryPlanner`

将 `SearchIntent` 和扩展词转换为数量受控的查询计划。

输出：

```js
{
  market: 'CN',
  queries: [
    {
      text: '"AI 产品经理" 招聘 2026',
      purpose: 'role_recall',
      preferredSources: ['baidu', 'tavily'],
      freshnessDays: 90,
      topK: 10
    }
  ],
  promptVersion: 'query-planning-v1'
}
```

程序必须重新校验 Query 数量、长度、市场、时间窗口和 Provider 白名单。LLM 不得指定任意网络端点。

### 4.4 `CompanyDiscovery`

职责：

- 执行 Query 计划。
- 将搜索结果规范化为候选记录。
- 从标题、摘要、域名和现有解析器中提取公司线索。
- 合并别名相同或域名一致的候选。
- 写入 `DiscoveryLog`。
- 将候选传给验证引擎。

聚合平台、高校就业网和新闻页面可以作为发现线索，但不能直接成为 `CareerPortal` 的已验证入口。

### 4.5 `VerificationEngine`

输入：

```js
{
  company,
  candidateUrl,
  searchEvidence,
  fetchedPage,
  atsFingerprint,
  pageClassification,
  independentIdentityEvidence
}
```

输出：

```js
{
  status: 'VERIFIED',
  confidenceScore: 85,
  pageType: 'JOB_LIST',
  atsType: 'MOKA',
  identityAnchor: true,
  evidence: [],
  hardRejectReasons: []
}
```

验证引擎是纯确定性模块。同一输入必须产生同一结果，不读取 LLM、不访问网络、不写数据库。

### 4.6 Upstream Adapters

- `search-source-adapter.mjs`：将岗位 Query 请求映射到现有 `SearchRouter.search()`。
- `official-verification-adapter.mjs`：调用现有 URL 分类、ATS 指纹、页面角色和身份校验函数，转换为新验证输入。
- `job-extraction-adapter.mjs`：调用现有 ATS/Page Provider，映射为 `JobOpening`。
- `job-result-adapter.mjs`：在新模型与旧 `JobResult` 之间进行兼容转换。

Adapter 不得把上游的 `probable`、搜索排名或 ATS 指纹直接提升为 `VERIFIED`。

### 4.7 Repository

应用层只依赖：

```js
companyRepository
careerPortalRepository
jobOpeningRepository
discoveryLogRepository
```

第二阶段使用 SQLite 实现。Repository 方法必须支持幂等 upsert、按运行批次查询和事务写入。

## 5. 文件边界

第一阶段新增：

```text
src/domain/search-intent.mjs
src/domain/company.mjs
src/domain/career-portal.mjs
src/domain/job-opening.mjs
src/domain/discovery-log.mjs
src/domain/verification-evidence.mjs

src/discovery/keyword-expander.mjs
src/discovery/query-planner.mjs
src/discovery/company-discovery.mjs

src/verification/evidence-codes.mjs
src/verification/verification-policy.mjs
src/verification/verification-engine.mjs

src/ports/llm-planner.mjs
src/ports/job-repository.mjs

src/adapters/upstream/search-source-adapter.mjs
src/adapters/upstream/official-verification-adapter.mjs
src/adapters/upstream/job-extraction-adapter.mjs
src/adapters/legacy/job-result-adapter.mjs
```

第二阶段新增：

```text
src/application/discover-market-jobs.mjs
src/adapters/llm/openai-compatible-planning-adapter.mjs
src/storage/sqlite-job-repository.mjs
src/storage/migrations/001-market-discovery.sql
src/runtime/create-market-discovery-runtime.mjs
src/cli/discover.mjs
```

需要修改：

```text
src/index.mjs
src/cli/main.mjs
src/runtime/config.mjs
package.json
README.md
docs/architecture.md
.agents/skills/lite-job-search/SKILL.md
.agents/skills/lite-job-search/references/data-contract.md
```

前两个阶段不修改：

```text
engine/upstream/providers/*
现有 searchCompany() 的参数和返回语义
现有 createJobResult() 的字段语义
```

测试文件与对应职责放在同一任务中新增，具体任务拆分由实施计划锁定。

## 6. 数据模型

### 6.1 SearchIntent

```js
{
  id,
  market,             // CN | NA
  roleType,
  industryTags,
  freshnessDays,
  targetCount,
  locale,
  createdAt
}
```

约束：

- `roleType` 非空。
- `freshnessDays` 为 1 到 365 的整数。
- `targetCount` 为正整数，并由运行时设置最大上限。
- 第一版市场仅允许 `CN`、`NA`。

### 6.2 Company

```js
{
  id,
  canonicalName,
  aliases,
  primaryOfficialDomain,
  officialDomains,
  industryTags,
  market,
  createdAt,
  updatedAt
}
```

约束：

- 公司记录按规范化名称与市场建立去重索引。
- 已验证域名在同一市场内必须唯一绑定到一个公司，冲突进入人工复核。
- 搜索摘要中的公司名称只能作为 alias 候选。

### 6.3 CareerPortal

```js
{
  id,
  companyId,
  url,
  canonicalUrl,
  registrableDomain,
  atsType,
  pageType,
  verificationStatus,
  confidenceScore,
  evidence,
  firstSeenAt,
  lastVerifiedAt
}
```

枚举：

```text
pageType:
CORPORATE_HOME
CAREER_HOME
CAMPAIGN
JOB_LIST
JOB_DETAIL
APPLY
UNKNOWN

verificationStatus:
CANDIDATE
VERIFIED
REVIEW
REJECTED
BLOCKED
```

### 6.4 JobOpening

```js
{
  id,
  companyId,
  careerPortalId,
  sourceJobId,
  title,
  normalizedTitle,
  roleFamily,
  locations,
  employmentType,
  publishedAt,
  closesAt,
  jobDetailUrl,
  applyUrl,
  status,
  sourceUrl,
  firstSeenAt,
  lastSeenAt
}
```

`status`：

```text
ACTIVE
CLOSED
UNKNOWN
```

稳定 ID 顺序：

1. ATS 的稳定 `sourceJobId`。
2. 规范化岗位详情 URL。
3. `hash(companyId + normalizedTitle + primaryLocation + canonicalSourceUrl)`。

发布日期缺失时保持 `null`，不得使用发现时间冒充发布日期。缺少发布日期的岗位不满足“近 90 天”严格结果，但可以保留为待复核记录。

### 6.5 DiscoveryLog

```js
{
  id,
  runId,
  searchIntentId,
  query,
  expandedKeywords,
  searchSource,
  searchedAt,
  resultUrl,
  resultRank,
  outcome,
  metadata
}
```

`outcome`：

```text
DISCOVERED
DUPLICATE
FETCH_FAILED
VERIFIED_PORTAL
REVIEW_REQUIRED
REJECTED
JOBS_EXTRACTED
NO_RECENT_JOBS
```

### 6.6 VerificationEvidence

```js
{
  code,
  direction,       // POSITIVE | NEGATIVE | NEUTRAL
  weight,
  observedValue,
  sourceUrl,
  observedAt
}
```

证据必须保存机器可读 `code`，展示文本由代码映射，避免把不可检索的自然语言作为唯一审计信息。

## 7. 确定性验证规则

### 7.1 正向评分

| 证据 | 分值 |
|---|---:|
| 独立确认的企业主域名匹配 | +35 |
| ATS 租户与企业身份绑定 | +20 |
| 页面包含招聘结构 | +15 |
| 页面存在有效 Apply 行为 | +15 |
| 企业官网主动跳转至该入口 | +15 |

最终分数限制在 0 到 100。

### 7.2 负向评分

| 证据 | 分值 |
|---|---:|
| 招聘聚合平台 | -70 |
| 高校就业网或校园信息转载页 | -60 |
| 新闻、媒体或公众号转载 | -50 |
| 培训机构、课程或付费内推 | -60 |
| 企业主体冲突 | -80 |

以下情况为硬拒绝，优先于 ATS 判断：

- 已知聚合平台被当作企业官网。
- 高校就业网被当作企业官网。
- 企业主体冲突。
- 个人网盘、收款、私人联系方式或高风险跳转。
- URL 无效或协议不受支持。

### 7.3 状态阈值

`VERIFIED` 同时要求：

- `confidenceScore >= 75`。
- `identityAnchor === true`。
- 页面角色不为 `UNKNOWN`。
- 没有硬拒绝原因。

`REVIEW`：

- 分数为 45 到 74；或
- 页面被阻断，但已有部分独立身份证据；或
- 多个主体竞争同一域名或 ATS 租户。

`REJECTED`：

- 分数低于 45；或
- 命中任何硬拒绝原因。

`BLOCKED`：

- 401、403、429、验证码或访问限制导致无法完成页面事实验证。
- 不绕过限制，可稍后重试或人工复核。

## 8. SQLite 设计

第二阶段新增：

```text
companies
company_aliases
company_domains
career_portals
verification_evidence
job_openings
discovery_logs
discovery_runs
```

关键关系：

- `career_portals.company_id → companies.id`
- `job_openings.company_id → companies.id`
- `job_openings.career_portal_id → career_portals.id`
- `verification_evidence.career_portal_id → career_portals.id`
- `discovery_logs.run_id → discovery_runs.id`

事务边界：

1. 写入或更新 Company。
2. 写入 CareerPortal 和验证证据。
3. 只有 Portal 为 `VERIFIED` 时，自动下钻并写入正式 `JobOpening`。
4. `REVIEW` 页面发现的岗位不得进入正式可投递结果，可保存为隔离候选。
5. 同一运行中的日志与业务记录在同一事务中提交。

## 9. 应用用例

```js
const result = await discoverMarketJobs({
  market: 'CN',
  roleType: 'AI 产品经理',
  industryTags: ['AI', '互联网'],
  freshnessDays: 90,
  targetCount: 20,
});
```

返回：

```js
{
  runId,
  intent,
  status,
  companiesDiscovered,
  portalsVerified,
  jobsStored,
  reviewRequired,
  rejected,
  providerAttempts,
  budget,
  errors
}
```

状态：

```text
COMPLETE
PARTIAL
DEFERRED_BY_BUDGET
NOT_CONFIGURED
FAILED
```

`targetCount` 表示目标岗位数量，不代表绕过预算、访问限制或真实性门槛。无法达到时返回 `PARTIAL` 并说明原因，不能用聚合站或缺少日期的岗位补足数量。

## 10. 错误处理

- LLM 未配置：返回 `NOT_CONFIGURED`，允许测试使用固定规划 fixture。
- LLM 输出不符合 Schema：拒绝该输出，不执行其中的 Query。
- 搜索预算耗尽：保存已完成结果并返回 `DEFERRED_BY_BUDGET`。
- 单个 Provider 失败：记录尝试并按现有 SearchRouter 规则降级。
- 页面抓取失败：写入 `FETCH_FAILED`，不伪造验证结果。
- 页面受限：标记 `BLOCKED`，不尝试绕过。
- ATS 抽取失败：保留已验证 Portal，记录失败，不生成空岗位。
- 数据库写入失败：回滚当前事务，保留运行级错误日志。

错误信息必须脱敏，不记录 API Key、Authorization Header、Cookie 或个人申请数据。

## 11. CLI

新增：

```powershell
lite-job-search discover `
  --market CN `
  --role "AI产品经理" `
  --industry "AI,互联网" `
  --since-days 90 `
  --limit 20 `
  --database ".\data\lite-job-search.sqlite" `
  --json
```

现有 `doctor` 增加但不替换原检查项：

- LLM Planning Adapter 是否配置。
- SQLite 文件是否可创建或打开。
- Search Provider 可用性。
- 当前搜索预算。
- 浏览器和可选 Apify 降级能力。

## 12. 测试策略

### 12.1 领域测试

- SearchIntent 输入边界。
- 公司别名和域名唯一性。
- JobOpening 稳定 ID。
- 发布日期缺失不被误判为近期岗位。

### 12.2 LLM 边界测试

- 关键词扩展支持中英文和同义词。
- Query 数量、长度和 Provider 白名单受程序限制。
- LLM 输出包含官网确认字段时被 Schema 拒绝。
- `llm_advisory` 不改变验证分数和状态。

### 12.3 验证测试

至少覆盖：

- 企业主域名招聘页。
- 企业官网链接到 ATS 租户。
- 只有 ATS 指纹但无企业身份锚点。
- 高校就业网转载。
- 新闻转载。
- 招聘聚合平台。
- 培训机构。
- 公司主体冲突。
- 403 或验证码页面。
- 候选 URL 使用自身域名进行自证的回归样例。

### 12.4 Repository 测试

- Migration 可在空数据库执行。
- Company、Portal、Job 幂等 upsert。
- 事务失败时不留下半条链路。
- 重复运行不会重复岗位。
- DiscoveryLog 可还原完整发现链。

### 12.5 端到端测试

离线 fixture：

- 固定 LLM 规划结果。
- 固定搜索结果。
- 固定官网、ATS 和聚合站页面。
- 验证完整闭环和负向拒绝。

真实 canary：

- 使用公开页面。
- 不要求登录。
- 不绕过验证码。
- 限制 Query、抓取页数和预算。
- 明确记录执行日期、真实命中数、阻断数和未达目标原因。

## 13. 验收标准

第一阶段完成条件：

- 新领域模型和验证引擎可独立测试。
- 现有 Provider 和旧 API 未重写。
- 旧测试全部通过。
- 非官方候选无法通过域名自证成为 `VERIFIED`。
- Adapter 能复用现有 ATS 和页面识别能力。

第二阶段完成条件：

- `AI 产品经理` 输入可生成受控搜索计划。
- 至少发现公司候选、验证官方招聘入口、抽取近期岗位并写入 SQLite。
- 每个正式岗位关联一个 `VERIFIED` CareerPortal。
- 每个 `VERIFIED` Portal 具有非 LLM 的身份锚点和证据明细。
- DiscoveryLog 能追踪 Query、来源、URL、判定与抽取结果。
- 重复运行保持幂等。
- 数量不足时返回真实的 `PARTIAL` 原因，不用低质量记录补量。

## 14. 兼容和迁移

- 第一、二阶段不删除旧代码。
- `searchCompany()` 继续服务已知公司场景。
- 新 CLI 使用 `discover`，避免复用旧 `search` 命令造成参数歧义。
- `JobResult` 继续用于旧导出；新查询通过 adapter 生成兼容结果。
- 上游 JSON 分桶数据库保持可读，新 SQLite 不直接修改它。
- 后续完成一个增量周期的等价验证后，再评估是否收缩 `src/index.mjs` 的原始上游导出。

## 15. 后续阶段

完成闭环后再开展：

1. 持久化预算、缓存、重试和断点续跑。
2. 加强 Moka、北森、飞书招聘、Hotjob 等 ATS 的 JS/API 下钻。
3. 将学生 XLSX 固定输出流程接到 `JobOpening` 查询投影。
4. 扩展岗位类型、行业和中国/北美市场覆盖。
5. 根据实际并发和部署需求评估 PostgreSQL，不在 SQLite MVP 中预建分布式架构。
