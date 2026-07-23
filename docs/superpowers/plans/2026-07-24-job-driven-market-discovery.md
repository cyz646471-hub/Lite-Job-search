# 岗位驱动的招聘市场发现引擎实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不重写现有 Provider 和旧公司搜索接口的前提下，交付从岗位需求出发、经确定性官网验证、岗位抽取并写入 SQLite 的完整发现闭环。

**架构：** 采用旁路式升级：新 `discoverMarketJobs()` 应用用例通过 ports 和 adapters 复用现有 SearchRouter、ATS 指纹、页面角色及岗位解析能力。LLM 只生成关键词和 Query，所有官网真实性、页面角色、岗位有效性和入库判断均由确定性程序完成。

**技术栈：** Node.js 20+ ESM、Node test runner、现有 SearchRouter 与上游 Provider、内置 `fetch`、`better-sqlite3`、SQLite、dotenv、tldts。

**规格：** `docs/superpowers/specs/2026-07-24-job-driven-market-discovery-design.md`

**执行前提：** 从提交 `c706fe2` 或更新后的 `main` 创建专用 `codex/job-driven-market-discovery` worktree。不要在现有 `codex/student-xlsx-export` worktree 中实施，也不要暂存工作区已有的 `scripts/build-cn-roles-report.mjs`、`scripts/collect-cn-recent-public-jobs.mjs` 或 `test-output/`。

---

## 文件结构

### 第一阶段：领域层、验证和兼容适配

| 文件 | 职责 |
|---|---|
| `src/domain/search-intent.mjs` | 规范化岗位发现输入 |
| `src/domain/company.mjs` | 公司实体及别名、域名约束 |
| `src/domain/career-portal.mjs` | 招聘入口实体和状态枚举 |
| `src/domain/job-opening.mjs` | 岗位实体、稳定键和近期判断 |
| `src/domain/discovery-log.mjs` | 发现过程审计记录 |
| `src/domain/verification-evidence.mjs` | 机器可读验证证据 |
| `src/discovery/keyword-expander.mjs` | 调用 Planning Port 扩展岗位词 |
| `src/discovery/query-planner.mjs` | 生成并约束搜索 Query |
| `src/discovery/page-advisory-classifier.mjs` | 为 REVIEW 页面生成权重为 0 的 LLM 辅助标签 |
| `src/discovery/company-discovery.mjs` | 执行 Query、合并公司线索并写日志 |
| `src/verification/evidence-codes.mjs` | 固定证据码、方向、权重和硬拒绝规则 |
| `src/verification/verification-policy.mjs` | 纯函数评分和状态阈值 |
| `src/verification/verification-engine.mjs` | 汇总程序证据，输出 Portal 判定 |
| `src/ports/llm-planner.mjs` | LLM Planning Adapter 契约和输出防火墙 |
| `src/ports/job-repository.mjs` | 四类 Repository 的运行时契约 |
| `src/adapters/upstream/search-source-adapter.mjs` | 将 Query 请求映射到 SearchRouter |
| `src/adapters/upstream/official-verification-adapter.mjs` | 将现有 ATS、页面角色和主体校验转换为验证证据 |
| `src/adapters/upstream/job-extraction-adapter.mjs` | 将现有 Page/Detail Provider 输出映射为 JobOpening |
| `src/adapters/legacy/job-result-adapter.mjs` | 新模型与旧 `JobResult` 的兼容投影 |

### 第二阶段：持久化、应用用例和 CLI

| 文件 | 职责 |
|---|---|
| `src/storage/migrations/001-market-discovery.sql` | SQLite 表、索引和外键 |
| `src/storage/sqlite-job-repository.mjs` | SQLite Repository 实现和事务 |
| `src/adapters/llm/openai-compatible-planning-adapter.mjs` | 可配置 endpoint 的 JSON Planning Adapter |
| `src/application/discover-market-jobs.mjs` | 编排完整闭环 |
| `src/runtime/fetch-page.mjs` | 受限 HTTP(S) 页面抓取、超时、重定向和响应体上限 |
| `src/runtime/create-market-discovery-runtime.mjs` | 组装配置、搜索、LLM、抓取与数据库依赖 |
| `src/cli/discover.mjs` | 解析岗位发现 CLI 参数 |
| `tests/fixtures/ai-product-manager/*` | 离线端到端搜索与页面夹具 |

### 修改文件

| 文件 | 修改 |
|---|---|
| `src/index.mjs` | 仅导出新的稳定 Facade 和领域工厂 |
| `src/runtime/config.mjs` | 增加 LLM、数据库和发现限制配置 |
| `src/cli/main.mjs` | 增加 `discover` 分支，不改变旧命令 |
| `src/cli/doctor.mjs` | 报告 LLM 和 SQLite 配置状态 |
| `package.json` / `package-lock.json` | 增加 SQLite 依赖和测试脚本 |
| `.env.example` | 增加脱敏的 LLM、数据库配置名称 |
| `README.md` / `docs/architecture.md` | 文档化岗位驱动入口 |
| `.agents/skills/lite-job-search/SKILL.md` | 增加岗位驱动工作流 |
| `.agents/skills/lite-job-search/references/data-contract.md` | 记录新模型和旧投影边界 |

---

## 第一阶段：领域层、验证和兼容适配

### 任务 1：冻结旧接口兼容基线

**文件：**
- 创建：`tests/legacy-compatibility.test.mjs`
- 读取：`src/index.mjs`
- 读取：`src/pipeline/search-company.mjs`
- 读取：`src/core/contracts.mjs`

- [ ] **步骤 1：编写旧 API 表征测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJobResult,
  searchCompany,
  verifyCandidates,
} from '../src/index.mjs';

test('legacy public entrypoints remain exported', () => {
  assert.equal(typeof searchCompany, 'function');
  assert.equal(typeof verifyCandidates, 'function');
  assert.equal(typeof createJobResult, 'function');
});

test('legacy JobResult keeps URL roles separate', () => {
  const result = createJobResult({
    market: 'CN',
    company: '示例公司',
    title: 'AI 产品经理',
    companyCareerHomeUrl: 'https://example.com/careers',
    jobListUrl: 'https://example.com/jobs',
  });
  assert.equal(result.companyCareerHomeUrl, 'https://example.com/careers');
  assert.equal(result.jobListUrl, 'https://example.com/jobs');
  assert.equal(result.jobDetailUrl, null);
  assert.equal(result.applyUrl, null);
});
```

- [ ] **步骤 2：运行兼容测试并确认基线通过**

运行：

```powershell
npm.cmd test -- tests/legacy-compatibility.test.mjs
```

预期：2 个测试 PASS。若失败，先记录当前差异，不修改旧接口来适配新设计。

- [ ] **步骤 3：运行完整旧测试**

运行：

```powershell
npm.cmd test
```

预期：现有 32 项测试加新兼容测试全部 PASS。

- [ ] **步骤 4：提交兼容基线**

```powershell
git add -- tests/legacy-compatibility.test.mjs
git commit -m "test: freeze legacy job search contracts"
```

### 任务 2：建立领域模型和稳定标识

**文件：**
- 创建：`src/domain/search-intent.mjs`
- 创建：`src/domain/company.mjs`
- 创建：`src/domain/career-portal.mjs`
- 创建：`src/domain/job-opening.mjs`
- 创建：`src/domain/discovery-log.mjs`
- 创建：`src/domain/verification-evidence.mjs`
- 测试：`tests/domain-models.test.mjs`

- [ ] **步骤 1：编写失败的领域测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSearchIntent } from '../src/domain/search-intent.mjs';
import { createCompany } from '../src/domain/company.mjs';
import { createCareerPortal } from '../src/domain/career-portal.mjs';
import { createJobOpening, isRecentOpening } from '../src/domain/job-opening.mjs';
import { createDiscoveryLog } from '../src/domain/discovery-log.mjs';
import { createVerificationEvidence } from '../src/domain/verification-evidence.mjs';

test('SearchIntent normalizes role, industry and limits', () => {
  const intent = createSearchIntent({
    market: 'china',
    roleType: '  AI 产品经理 ',
    industryTags: ['AI', ' 互联网 ', 'AI'],
    freshnessDays: 90,
    targetCount: 20,
  }, { id: 'intent-1', now: '2026-07-24T00:00:00.000Z' });
  assert.deepEqual(intent, {
    id: 'intent-1',
    market: 'CN',
    roleType: 'AI 产品经理',
    industryTags: ['AI', '互联网'],
    freshnessDays: 90,
    targetCount: 20,
    locale: 'zh-CN',
    createdAt: '2026-07-24T00:00:00.000Z',
  });
});

test('SearchIntent rejects unsafe bounds', () => {
  assert.throws(() => createSearchIntent({ market: 'CN', roleType: '', freshnessDays: 90, targetCount: 1 }, { id: 'x' }), /roleType/);
  assert.throws(() => createSearchIntent({ market: 'CN', roleType: 'PM', freshnessDays: 0, targetCount: 1 }, { id: 'x' }), /freshnessDays/);
  assert.throws(() => createSearchIntent({ market: 'CN', roleType: 'PM', freshnessDays: 90, targetCount: 1001 }, { id: 'x' }), /targetCount/);
});

test('JobOpening preserves unknown publication date', () => {
  const job = createJobOpening({
    id: 'job-1',
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    title: 'AI 产品经理',
    sourceUrl: 'https://jobs.example.com/1',
    publishedAt: null,
  }, { now: '2026-07-24T00:00:00.000Z' });
  assert.equal(job.publishedAt, null);
  assert.equal(isRecentOpening(job, { freshnessDays: 90, now: Date.parse('2026-07-24') }), false);
});

test('evidence and logs keep machine-readable codes', () => {
  const evidence = createVerificationEvidence({
    code: 'official_domain_match',
    direction: 'POSITIVE',
    weight: 35,
    sourceUrl: 'https://example.com/careers',
  }, { observedAt: '2026-07-24T00:00:00.000Z' });
  const log = createDiscoveryLog({
    id: 'log-1',
    runId: 'run-1',
    searchIntentId: 'intent-1',
    query: '"AI 产品经理" 招聘',
    searchSource: 'manual',
    searchedAt: '2026-07-24T00:00:00.000Z',
    resultUrl: 'https://example.com/careers',
    outcome: 'DISCOVERED',
  });
  assert.equal(evidence.code, 'official_domain_match');
  assert.equal(log.outcome, 'DISCOVERED');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```powershell
npm.cmd test -- tests/domain-models.test.mjs
```

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现 SearchIntent 和共享清理规则**

在 `src/domain/search-intent.mjs` 实现：

```js
import { normalizeMarket } from '../core/contracts.mjs';

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))];

export function createSearchIntent(input = {}, {
  id = input.id,
  now = new Date().toISOString(),
} = {}) {
  const roleType = clean(input.roleType);
  const freshnessDays = Number(input.freshnessDays);
  const targetCount = Number(input.targetCount);
  if (!id) throw new Error('SearchIntent id is required');
  if (!roleType) throw new Error('roleType is required');
  if (!Number.isInteger(freshnessDays) || freshnessDays < 1 || freshnessDays > 365) {
    throw new Error('freshnessDays must be an integer between 1 and 365');
  }
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 1000) {
    throw new Error('targetCount must be an integer between 1 and 1000');
  }
  const market = normalizeMarket(input.market);
  return Object.freeze({
    id,
    market,
    roleType,
    industryTags: unique(input.industryTags),
    freshnessDays,
    targetCount,
    locale: clean(input.locale) || (market === 'CN' ? 'zh-CN' : 'en-US'),
    createdAt: input.createdAt || now,
  });
}
```

- [ ] **步骤 4：实现其余领域工厂**

每个工厂都要：

- 清理字符串并复制数组，不能保留调用方可变引用。
- 对枚举值做显式校验。
- 接受可注入 `id`、`now`，使测试不依赖当前时间。
- 不访问网络、数据库或 LLM。

`src/domain/career-portal.mjs` 固定导出：

```js
export const PAGE_TYPES = Object.freeze([
  'CORPORATE_HOME', 'CAREER_HOME', 'CAMPAIGN',
  'JOB_LIST', 'JOB_DETAIL', 'APPLY', 'UNKNOWN',
]);

export const VERIFICATION_STATUSES = Object.freeze([
  'CANDIDATE', 'VERIFIED', 'REVIEW', 'REJECTED', 'BLOCKED',
]);

export function createCareerPortal(input = {}, { now = new Date().toISOString() } = {}) {
  if (!input.id || !input.companyId || !input.canonicalUrl) {
    throw new Error('CareerPortal id, companyId and canonicalUrl are required');
  }
  if (!PAGE_TYPES.includes(input.pageType)) throw new Error('unsupported pageType');
  if (!VERIFICATION_STATUSES.includes(input.verificationStatus)) throw new Error('unsupported verificationStatus');
  return Object.freeze({
    id: input.id,
    companyId: input.companyId,
    url: input.url || input.canonicalUrl,
    canonicalUrl: input.canonicalUrl,
    registrableDomain: input.registrableDomain || '',
    atsType: input.atsType || '',
    pageType: input.pageType,
    verificationStatus: input.verificationStatus,
    confidenceScore: Math.max(0, Math.min(100, Number(input.confidenceScore) || 0)),
    evidence: Object.freeze([...(input.evidence || [])]),
    firstSeenAt: input.firstSeenAt || now,
    lastVerifiedAt: input.lastVerifiedAt || null,
  });
}
```

`src/domain/company.mjs`：

```js
import { normalizeMarket } from '../core/contracts.mjs';

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))];

export function createCompany(input = {}, { now = new Date().toISOString() } = {}) {
  const canonicalName = clean(input.canonicalName);
  if (!input.id || !canonicalName) throw new Error('Company id and canonicalName are required');
  const officialDomains = unique(input.officialDomains).map((value) => value.toLowerCase());
  const primaryOfficialDomain = clean(input.primaryOfficialDomain).toLowerCase() || officialDomains[0] || null;
  return Object.freeze({
    id: input.id,
    canonicalName,
    aliases: Object.freeze(unique(input.aliases)),
    primaryOfficialDomain,
    officialDomains: Object.freeze(officialDomains),
    industryTags: Object.freeze(unique(input.industryTags)),
    market: normalizeMarket(input.market),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  });
}
```

`src/domain/job-opening.mjs` 固定导出：

```js
import { createHash } from 'node:crypto';

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const STATUSES = new Set(['ACTIVE', 'CLOSED', 'UNKNOWN']);

export function stableOpeningId(input = {}) {
  if (input.id) return input.id;
  const identity = input.sourceJobId
    ? `${input.companyId}|source:${input.sourceJobId}`
    : `${input.companyId}|${input.jobDetailUrl || input.sourceUrl}|${clean(input.title).toLowerCase()}|${clean(input.locations?.[0]).toLowerCase()}`;
  return createHash('sha256').update(identity).digest('hex');
}

export function createJobOpening(input = {}, { now = new Date().toISOString() } = {}) {
  if (!input.companyId || !input.careerPortalId || !clean(input.title) || !input.sourceUrl) {
    throw new Error('JobOpening companyId, careerPortalId, title and sourceUrl are required');
  }
  const status = input.status || 'UNKNOWN';
  if (!STATUSES.has(status)) throw new Error('unsupported JobOpening status');
  return Object.freeze({
    id: stableOpeningId(input),
    companyId: input.companyId,
    careerPortalId: input.careerPortalId,
    sourceJobId: input.sourceJobId || null,
    title: clean(input.title),
    normalizedTitle: clean(input.normalizedTitle || input.title).toLowerCase(),
    roleFamily: input.roleFamily || 'OTHER',
    locations: Object.freeze([...(input.locations || []).map(clean).filter(Boolean)]),
    employmentType: input.employmentType || null,
    publishedAt: input.publishedAt || null,
    closesAt: input.closesAt || null,
    jobDetailUrl: input.jobDetailUrl || null,
    applyUrl: input.applyUrl || null,
    status,
    sourceUrl: input.sourceUrl,
    firstSeenAt: input.firstSeenAt || now,
    lastSeenAt: input.lastSeenAt || now,
  });
}

export function isRecentOpening(job, { freshnessDays, now = Date.now() } = {}) {
  const published = Date.parse(job?.publishedAt || '');
  return Number.isFinite(published) && published >= now - freshnessDays * 86_400_000;
}
```

`src/domain/verification-evidence.mjs`：

```js
const DIRECTIONS = new Set(['POSITIVE', 'NEGATIVE', 'NEUTRAL']);

export function createVerificationEvidence(input = {}, {
  observedAt = new Date().toISOString(),
} = {}) {
  if (!input.code || !DIRECTIONS.has(input.direction)) {
    throw new Error('VerificationEvidence code and direction are required');
  }
  return Object.freeze({
    code: String(input.code),
    direction: input.direction,
    weight: Number(input.weight) || 0,
    observedValue: input.observedValue == null ? null : String(input.observedValue),
    sourceUrl: input.sourceUrl || null,
    observedAt: input.observedAt || observedAt,
  });
}
```

`src/domain/discovery-log.mjs`：

```js
const OUTCOMES = new Set([
  'DISCOVERED', 'DUPLICATE', 'FETCH_FAILED', 'VERIFIED_PORTAL',
  'REVIEW_REQUIRED', 'REJECTED', 'JOBS_EXTRACTED', 'NO_RECENT_JOBS',
]);

export function createDiscoveryLog(input = {}) {
  if (!input.id || !input.runId || !input.searchIntentId || !OUTCOMES.has(input.outcome)) {
    throw new Error('DiscoveryLog id, runId, searchIntentId and supported outcome are required');
  }
  return Object.freeze({
    id: input.id,
    runId: input.runId,
    searchIntentId: input.searchIntentId,
    query: String(input.query || ''),
    expandedKeywords: Object.freeze([...(input.expandedKeywords || [])]),
    searchSource: String(input.searchSource || ''),
    searchedAt: input.searchedAt,
    resultUrl: input.resultUrl || null,
    resultRank: Number.isFinite(Number(input.resultRank)) ? Number(input.resultRank) : null,
    outcome: input.outcome,
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}
```

- [ ] **步骤 5：运行领域测试**

运行：

```powershell
npm.cmd test -- tests/domain-models.test.mjs
```

预期：全部 PASS。

- [ ] **步骤 6：提交领域模型**

```powershell
git add -- src/domain tests/domain-models.test.mjs
git commit -m "feat: add market discovery domain models"
```

### 任务 3：实现确定性官网验证引擎

**文件：**
- 创建：`src/verification/evidence-codes.mjs`
- 创建：`src/verification/verification-policy.mjs`
- 创建：`src/verification/verification-engine.mjs`
- 测试：`tests/verification-engine.test.mjs`

- [ ] **步骤 1：编写失败的验证测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyCareerPortal } from '../src/verification/verification-engine.mjs';

test('verified portal needs an independent identity anchor', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [
      { code: 'ats_fingerprint_only', direction: 'NEUTRAL', weight: 0 },
      { code: 'recruitment_structure', direction: 'POSITIVE', weight: 15 },
      { code: 'apply_action', direction: 'POSITIVE', weight: 15 },
    ],
  });
  assert.equal(result.verificationStatus, 'REJECTED');
  assert.equal(result.identityAnchor, false);
});

test('candidate URL cannot use its own registrable domain as official proof', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    candidateUrl: 'https://jobs.untrusted.example/openings',
    evidence: [
      { code: 'candidate_self_domain', direction: 'NEUTRAL', weight: 0 },
      { code: 'recruitment_structure', direction: 'POSITIVE', weight: 15 },
    ],
  });
  assert.notEqual(result.verificationStatus, 'VERIFIED');
});

test('hard rejected aggregator wins before ATS evidence', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [
      { code: 'aggregator_domain', direction: 'NEGATIVE', weight: -70, hardReject: true },
      { code: 'verified_ats_tenant', direction: 'POSITIVE', weight: 20, identityAnchor: true },
      { code: 'recruitment_structure', direction: 'POSITIVE', weight: 15 },
      { code: 'apply_action', direction: 'POSITIVE', weight: 15 },
    ],
  });
  assert.equal(result.verificationStatus, 'REJECTED');
  assert.deepEqual(result.hardRejectReasons, ['aggregator_domain']);
});

test('official backlink plus recruitment structure can verify a portal', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [
      { code: 'official_domain_match', direction: 'POSITIVE', weight: 35, identityAnchor: true },
      { code: 'recruitment_structure', direction: 'POSITIVE', weight: 15 },
      { code: 'apply_action', direction: 'POSITIVE', weight: 15 },
      { code: 'official_site_backlink', direction: 'POSITIVE', weight: 15, identityAnchor: true },
    ],
  });
  assert.equal(result.confidenceScore, 80);
  assert.equal(result.verificationStatus, 'VERIFIED');
});

test('LLM advisory has zero scoring authority', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [
      { code: 'llm_advisory', direction: 'NEUTRAL', weight: 99, identityAnchor: true },
      { code: 'recruitment_structure', direction: 'POSITIVE', weight: 15 },
    ],
  });
  assert.equal(result.confidenceScore, 15);
  assert.equal(result.identityAnchor, false);
});
```

- [ ] **步骤 2：运行验证测试确认失败**

运行：

```powershell
npm.cmd test -- tests/verification-engine.test.mjs
```

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：定义固定证据码**

`src/verification/evidence-codes.mjs`：

```js
export const EVIDENCE_RULES = Object.freeze({
  official_domain_match: { direction: 'POSITIVE', weight: 35, identityAnchor: true },
  verified_ats_tenant: { direction: 'POSITIVE', weight: 20, identityAnchor: true },
  recruitment_structure: { direction: 'POSITIVE', weight: 15, identityAnchor: false },
  apply_action: { direction: 'POSITIVE', weight: 15, identityAnchor: false },
  official_site_backlink: { direction: 'POSITIVE', weight: 15, identityAnchor: true },
  ats_fingerprint_only: { direction: 'NEUTRAL', weight: 0, identityAnchor: false },
  candidate_self_domain: { direction: 'NEUTRAL', weight: 0, identityAnchor: false },
  llm_advisory: { direction: 'NEUTRAL', weight: 0, identityAnchor: false },
  aggregator_domain: { direction: 'NEGATIVE', weight: -70, hardReject: true },
  university_employment_site: { direction: 'NEGATIVE', weight: -60, hardReject: true },
  news_reprint: { direction: 'NEGATIVE', weight: -50, hardReject: true },
  training_provider: { direction: 'NEGATIVE', weight: -60, hardReject: true },
  company_identity_conflict: { direction: 'NEGATIVE', weight: -80, hardReject: true },
  blocked_page: { direction: 'NEUTRAL', weight: 0, identityAnchor: false },
});
```

- [ ] **步骤 4：实现纯评分策略**

`src/verification/verification-policy.mjs`：

```js
import { EVIDENCE_RULES } from './evidence-codes.mjs';

export function applyVerificationPolicy({ pageType = 'UNKNOWN', evidence = [] } = {}) {
  const normalized = evidence.map((item) => {
    const rule = EVIDENCE_RULES[item.code];
    if (!rule) throw new Error(`unknown verification evidence: ${item.code}`);
    return { ...item, ...rule };
  });
  const hardRejectReasons = normalized.filter((item) => item.hardReject).map((item) => item.code);
  const blocked = normalized.some((item) => item.code === 'blocked_page');
  const identityAnchor = normalized.some((item) => item.identityAnchor === true);
  const rawScore = normalized.reduce((sum, item) => sum + item.weight, 0);
  const confidenceScore = Math.max(0, Math.min(100, rawScore));
  let verificationStatus = 'REVIEW';
  if (hardRejectReasons.length) verificationStatus = 'REJECTED';
  else if (blocked) verificationStatus = 'BLOCKED';
  else if (confidenceScore >= 75 && identityAnchor && pageType !== 'UNKNOWN') verificationStatus = 'VERIFIED';
  else if (confidenceScore < 45) verificationStatus = 'REJECTED';
  return { verificationStatus, confidenceScore, identityAnchor, hardRejectReasons, evidence: normalized };
}
```

`src/verification/verification-engine.mjs`：

```js
import { applyVerificationPolicy } from './verification-policy.mjs';

export function verifyCareerPortal(input = {}) {
  return {
    pageType: input.pageType || 'UNKNOWN',
    atsType: input.atsType || '',
    ...applyVerificationPolicy({
      pageType: input.pageType,
      evidence: input.evidence,
    }),
  };
}
```

- [ ] **步骤 5：运行验证测试**

运行：

```powershell
npm.cmd test -- tests/verification-engine.test.mjs
```

预期：5 个测试 PASS。

- [ ] **步骤 6：提交验证引擎**

```powershell
git add -- src/verification tests/verification-engine.test.mjs
git commit -m "feat: add deterministic portal verification"
```

### 任务 4：建立 LLM 权限防火墙、关键词扩展和 Query 规划

**文件：**
- 创建：`src/ports/llm-planner.mjs`
- 创建：`src/discovery/keyword-expander.mjs`
- 创建：`src/discovery/query-planner.mjs`
- 创建：`src/discovery/page-advisory-classifier.mjs`
- 测试：`tests/query-planner.test.mjs`

- [ ] **步骤 1：编写失败的 Planning 测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { expandKeywords } from '../src/discovery/keyword-expander.mjs';
import { planQueries } from '../src/discovery/query-planner.mjs';
import { classifyPageAdvisory } from '../src/discovery/page-advisory-classifier.mjs';

function fakePlanningModel(outputs) {
  return {
    configured: true,
    async generate({ task }) {
      return structuredClone(outputs[task]);
    },
  };
}

test('keyword expansion returns controlled multilingual terms', async () => {
  const model = fakePlanningModel({
    expand_keywords: {
      primaryRole: 'AI 产品经理',
      roleFamily: 'PRODUCT_MANAGEMENT',
      terms: ['AI 产品经理', '大模型产品经理'],
      englishTerms: ['AI Product Manager'],
      synonyms: ['人工智能产品经理'],
      exclusions: ['培训'],
    },
  });
  const result = await expandKeywords({ roleType: 'AI 产品经理', industryTags: ['AI'] }, { planningModel: model });
  assert.deepEqual(result.englishTerms, ['AI Product Manager']);
});

test('planner rejects LLM attempts to decide official truth', async () => {
  const model = fakePlanningModel({
    expand_keywords: {
      primaryRole: 'AI 产品经理',
      terms: ['AI 产品经理'],
      isOfficial: true,
    },
  });
  await assert.rejects(
    expandKeywords({ roleType: 'AI 产品经理' }, { planningModel: model }),
    /forbidden LLM field: isOfficial/,
  );
});

test('query plan enforces provider allowlist and limits', async () => {
  const model = fakePlanningModel({
    plan_queries: {
      queries: [
        { text: '"AI 产品经理" 招聘', preferredSources: ['baidu', 'unknown-provider'], freshnessDays: 999, topK: 999 },
      ],
    },
  });
  const result = await planQueries({
    market: 'CN',
    freshnessDays: 90,
    targetCount: 20,
  }, {
    terms: ['AI 产品经理'],
  }, {
    planningModel: model,
    providerAllowlist: ['baidu', 'tavily', 'brave', 'manual'],
  });
  assert.deepEqual(result.queries[0].preferredSources, ['baidu']);
  assert.equal(result.queries[0].freshnessDays, 90);
  assert.equal(result.queries[0].topK, 20);
});

test('low-confidence page classification is neutral advisory evidence', async () => {
  const model = fakePlanningModel({
    classify_page: {
      label: 'LIKELY_CAREER',
      confidence: 0.72,
      rationale: '页面包含职位列表语义',
    },
  });
  const advisory = await classifyPageAdvisory({
    url: 'https://tenant.example/jobs',
    title: '招聘职位',
    text: '产品经理 上海',
  }, { planningModel: model, observedAt: '2026-07-24T00:00:00.000Z' });
  assert.equal(advisory.code, 'llm_advisory');
  assert.equal(advisory.direction, 'NEUTRAL');
  assert.equal(advisory.weight, 0);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```powershell
npm.cmd test -- tests/query-planner.test.mjs
```

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现 Planning Port 防火墙**

`src/ports/llm-planner.mjs`：

```js
const FORBIDDEN_FIELDS = new Set([
  'isOfficial',
  'officialIdentityConfirmed',
  'officialDomainConfirmed',
  'verificationStatus',
  'confidenceScore',
  'identityAnchor',
  'hardReject',
  'weight',
  'direction',
]);

function scan(value) {
  if (Array.isArray(value)) return value.forEach(scan);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) throw new Error(`forbidden LLM field: ${key}`);
    scan(child);
  }
}

export function assertPlanningModel(model) {
  if (!model || typeof model.generate !== 'function') throw new Error('planningModel.generate is required');
  return model;
}

export function validatePlanningOutput(value) {
  scan(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('planning output must be an object');
  }
  return value;
}
```

- [ ] **步骤 4：实现关键词扩展和 Query 限制**

`src/discovery/keyword-expander.mjs` 应：

```js
import { assertPlanningModel, validatePlanningOutput } from '../ports/llm-planner.mjs';

const list = (value, limit = 20) => [...new Set((value || [])
  .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
  .filter(Boolean))].slice(0, limit);

export async function expandKeywords(intent, { planningModel } = {}) {
  const model = assertPlanningModel(planningModel);
  const raw = validatePlanningOutput(await model.generate({
    task: 'expand_keywords',
    input: {
      roleType: intent.roleType,
      industryTags: intent.industryTags || [],
      market: intent.market,
      locale: intent.locale,
    },
  }));
  return Object.freeze({
    primaryRole: String(raw.primaryRole || intent.roleType).trim(),
    roleFamily: String(raw.roleFamily || 'OTHER').trim(),
    terms: list(raw.terms),
    englishTerms: list(raw.englishTerms),
    synonyms: list(raw.synonyms),
    exclusions: list(raw.exclusions, 10),
    promptVersion: String(raw.promptVersion || 'keyword-expansion-v1'),
  });
}
```

`src/discovery/query-planner.mjs`：

```js
import { assertPlanningModel, validatePlanningOutput } from '../ports/llm-planner.mjs';

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export async function planQueries(intent, keywords, {
  planningModel,
  providerAllowlist = ['baidu', 'tavily', 'brave', 'manual'],
  maxQueries = 12,
} = {}) {
  const model = assertPlanningModel(planningModel);
  const raw = validatePlanningOutput(await model.generate({
    task: 'plan_queries',
    input: { intent, keywords },
  }));
  const allowed = new Set(providerAllowlist);
  const seen = new Set();
  const queries = [];
  for (const item of raw.queries || []) {
    const text = clean(item.text).slice(0, 240);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    queries.push(Object.freeze({
      text,
      purpose: clean(item.purpose) || 'role_recall',
      preferredSources: [...new Set((item.preferredSources || []).filter((name) => allowed.has(name)))],
      freshnessDays: intent.freshnessDays,
      topK: Math.min(20, Math.max(1, Number(item.topK) || 8)),
    }));
    if (queries.length >= Math.min(20, Math.max(1, maxQueries))) break;
  }
  if (!queries.length) throw new Error('planning output contains no usable queries');
  return Object.freeze({
    market: intent.market,
    queries: Object.freeze(queries),
    promptVersion: clean(raw.promptVersion) || 'query-planning-v1',
  });
}
```

`src/discovery/page-advisory-classifier.mjs`：

```js
import { createVerificationEvidence } from '../domain/verification-evidence.mjs';
import { assertPlanningModel, validatePlanningOutput } from '../ports/llm-planner.mjs';

const LABELS = new Set(['LIKELY_CAREER', 'LIKELY_AGGREGATOR', 'LIKELY_NEWS', 'UNKNOWN']);

export async function classifyPageAdvisory(page, {
  planningModel,
  observedAt = new Date().toISOString(),
} = {}) {
  const model = assertPlanningModel(planningModel);
  const raw = validatePlanningOutput(await model.generate({
    task: 'classify_page',
    input: {
      url: String(page.url || ''),
      title: String(page.title || '').slice(0, 300),
      text: String(page.text || '').slice(0, 2_000),
    },
  }));
  const label = LABELS.has(raw.label) ? raw.label : 'UNKNOWN';
  return createVerificationEvidence({
    code: 'llm_advisory',
    direction: 'NEUTRAL',
    weight: 0,
    observedValue: JSON.stringify({
      label,
      confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
      rationale: String(raw.rationale || '').slice(0, 500),
    }),
    sourceUrl: page.url || null,
  }, { observedAt });
}
```

- [ ] **步骤 5：运行 Planning 测试**

运行：

```powershell
npm.cmd test -- tests/query-planner.test.mjs
```

预期：全部 PASS。

- [ ] **步骤 6：提交 LLM 边界和 Query 规划**

```powershell
git add -- src/ports/llm-planner.mjs src/discovery/keyword-expander.mjs src/discovery/query-planner.mjs src/discovery/page-advisory-classifier.mjs tests/query-planner.test.mjs
git commit -m "feat: constrain LLM discovery planning"
```

### 任务 5：实现公司发现和 SearchRouter Adapter

**文件：**
- 创建：`src/adapters/upstream/search-source-adapter.mjs`
- 创建：`src/discovery/company-discovery.mjs`
- 测试：`tests/company-discovery.test.mjs`

- [ ] **步骤 1：编写失败的公司发现测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSearchSourceAdapter } from '../src/adapters/upstream/search-source-adapter.mjs';
import { discoverCompanies } from '../src/discovery/company-discovery.mjs';

test('company discovery deduplicates URLs and records source evidence', async () => {
  const router = {
    async search(request) {
      return {
        status: 'ok',
        provider: 'fixture',
        attempts: [{ provider: 'fixture', status: 'ok', networkRequest: false }],
        items: [
          { company: '示例科技', title: '示例科技招聘', url: 'https://jobs.example.com/', rank: 1 },
          { company: '示例科技', title: '重复结果', url: 'https://jobs.example.com/#jobs', rank: 2 },
        ],
      };
    },
  };
  const searchSource = createSearchSourceAdapter({ router });
  const result = await discoverCompanies({
    intent: { id: 'intent-1', market: 'CN', freshnessDays: 90 },
    queryPlan: {
      queries: [{ text: '"AI 产品经理" 招聘', topK: 10, freshnessDays: 90 }],
    },
    searchSource,
    runId: 'run-1',
    now: '2026-07-24T00:00:00.000Z',
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.logs.length, 2);
  assert.equal(result.logs[0].searchSource, 'fixture');
});

test('budget deferral remains distinct from no results', async () => {
  const searchSource = createSearchSourceAdapter({
    router: {
      search: async () => ({ status: 'search_deferred_by_budget', provider: 'fixture', items: [], attempts: [] }),
    },
  });
  const result = await discoverCompanies({
    intent: { id: 'intent-1', market: 'CN', freshnessDays: 90 },
    queryPlan: { queries: [{ text: 'query', topK: 10 }] },
    searchSource,
    runId: 'run-1',
  });
  assert.equal(result.status, 'DEFERRED_BY_BUDGET');
});

test('company discovery extracts a deterministic company hint from the title', async () => {
  const searchSource = {
    search: async () => ({
      status: 'ok',
      provider: 'fixture',
      attempts: [],
      items: [{ title: '示例智能科技招聘官网 - AI 产品经理', url: 'https://jobs.example.com', rank: 1 }],
    }),
  };
  const result = await discoverCompanies({
    intent: { id: 'intent-1', market: 'CN', freshnessDays: 90 },
    queryPlan: { queries: [{ text: '"AI 产品经理" 招聘', topK: 10 }] },
    searchSource,
    runId: 'run-1',
  });
  assert.equal(result.candidates[0].company, '示例智能科技');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```powershell
npm.cmd test -- tests/company-discovery.test.mjs
```

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现 SearchRouter Adapter**

```js
export function createSearchSourceAdapter({ router } = {}) {
  if (!router || typeof router.search !== 'function') throw new Error('SearchRouter is required');
  return {
    async search(query, intent) {
      return router.search({
        query: query.text,
        market: intent.market,
        topK: query.topK,
        freshnessDays: intent.freshnessDays,
        cacheKey: `market-discovery|${intent.market}|${query.text}`,
      });
    },
  };
}
```

- [ ] **步骤 4：实现候选规范化、URL 去重和日志**

`discoverCompanies()` 使用 `URL` 删除 hash，按 canonical URL 合并候选；保留更靠前的排名，并为每条原始搜索结果生成一条 `DiscoveryLog`。聚合页仍可进入候选队列，但必须保留 `sourceType`，不能在本模块设置 `VERIFIED`。

核心循环实现为：

```js
import { resolveCompanyName } from '../../engine/upstream/planner/cn-company-resolver.mjs';

function companyHintOf(item = {}) {
  const explicit = String(item.company || item.companyName || item.organization || '').trim();
  if (explicit) return explicit;
  const title = String(item.title || '').replace(/\s+/g, ' ').trim();
  return title.match(/^(.{2,80}?)(?:招聘官网|招聘职位|校园招聘|社会招聘|招聘|Careers|Jobs)(?:\s|[-–—:：|｜]|$)/i)?.[1]?.trim() || '';
}

export async function discoverCompanies({
  intent,
  queryPlan,
  searchSource,
  runId,
  now = new Date().toISOString(),
} = {}) {
  const candidatesByUrl = new Map();
  const logs = [];
  const providerAttempts = [];
  let status = 'COMPLETE';
  for (const query of queryPlan.queries) {
    const response = await searchSource.search(query, intent);
    providerAttempts.push(...(response.attempts || []));
    if (response.status === 'search_deferred_by_budget') {
      status = 'DEFERRED_BY_BUDGET';
      break;
    }
    if (response.status === 'not_configured') {
      status = 'NOT_CONFIGURED';
      break;
    }
    if (!['ok', 'success'].includes(response.status)) {
      status = 'PARTIAL';
      continue;
    }
    for (const [index, item] of (response.items || []).entries()) {
      let canonicalUrl;
      try {
        const parsed = new URL(item.url);
        parsed.hash = '';
        canonicalUrl = parsed.href;
      } catch {
        continue;
      }
      const resolvedCompany = resolveCompanyName(companyHintOf(item));
      if (!resolvedCompany.canonicalName) {
        logs.push({
          id: `${runId}:${logs.length + 1}`,
          runId,
          searchIntentId: intent.id,
          query: query.text,
          expandedKeywords: [],
          searchSource: response.provider,
          searchedAt: now,
          resultUrl: canonicalUrl,
          resultRank: Number(item.rank) || index + 1,
          outcome: 'REVIEW_REQUIRED',
          metadata: { reason: 'company_identity_missing' },
        });
        continue;
      }
      const candidate = {
        ...item,
        company: resolvedCompany.canonicalName,
        companyIdentityKey: resolvedCompany.companyId,
        url: canonicalUrl,
        rank: Number(item.rank) || index + 1,
        searchSource: response.provider,
        sourceType: item.sourceType || 'unknown',
        query: query.text,
      };
      const prior = candidatesByUrl.get(canonicalUrl);
      if (!prior || candidate.rank < prior.rank) candidatesByUrl.set(canonicalUrl, candidate);
      logs.push({
        id: `${runId}:${logs.length + 1}`,
        runId,
        searchIntentId: intent.id,
        query: query.text,
        expandedKeywords: [],
        searchSource: response.provider,
        searchedAt: now,
        resultUrl: canonicalUrl,
        resultRank: candidate.rank,
        outcome: prior ? 'DUPLICATE' : 'DISCOVERED',
        metadata: { sourceType: candidate.sourceType },
      });
    }
  }
  return {
    status,
    candidates: [...candidatesByUrl.values()].sort((a, b) => a.rank - b.rank),
    logs,
    providerAttempts,
  };
}
```

返回接口固定为：

```js
{
  status: 'COMPLETE' | 'PARTIAL' | 'DEFERRED_BY_BUDGET' | 'NOT_CONFIGURED',
  candidates: [],
  logs: [],
  providerAttempts: [],
}
```

- [ ] **步骤 5：运行公司发现测试**

运行：

```powershell
npm.cmd test -- tests/company-discovery.test.mjs
```

预期：全部 PASS。

- [ ] **步骤 6：提交公司发现**

```powershell
git add -- src/adapters/upstream/search-source-adapter.mjs src/discovery/company-discovery.mjs tests/company-discovery.test.mjs
git commit -m "feat: discover company candidates from role queries"
```

### 任务 6：适配现有验证、岗位抽取和旧结果

**文件：**
- 创建：`src/adapters/upstream/official-verification-adapter.mjs`
- 创建：`src/adapters/upstream/job-extraction-adapter.mjs`
- 创建：`src/adapters/legacy/job-result-adapter.mjs`
- 测试：`tests/upstream-adapters.test.mjs`

- [ ] **步骤 1：编写失败的 Adapter 测试**

测试必须覆盖：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createOfficialVerificationAdapter } from '../src/adapters/upstream/official-verification-adapter.mjs';
import { createUpstreamJobExtractionAdapter } from '../src/adapters/upstream/job-extraction-adapter.mjs';

const verificationAdapter = createOfficialVerificationAdapter({
  detectAts: ({ url }) => ({ ats: url.includes('mokahr') ? 'MOKA' : '', confidence: 1 }),
  classifyPage: () => ({ pageRole: 'JOB_LIST', vacancyStatus: 'ACTIVE' }),
  evaluateIdentity: () => ({ strongEvidence: [], mediumEvidence: ['job_content_match'] }),
});

const jobExtractor = createUpstreamJobExtractionAdapter({
  fetchPage: async () => ({
    status: 200,
    finalUrl: 'https://jobs.example.com/openings',
    html: '<h1>AI 产品经理</h1>',
  }),
  resolvePageProvider: async () => ({
    id: 'fixture',
    parse: () => ({
      activeJobs: [{
        id: 'ai-pm',
        title: 'AI 产品经理',
        location: '上海',
        detailUrl: 'https://jobs.example.com/positions/ai-pm',
      }],
    }),
  }),
});

test('ATS fingerprint without tenant identity remains neutral', async () => {
  const result = await verificationAdapter.inspect({
    company: { canonicalName: '示例科技', officialDomains: [] },
    candidate: { url: 'https://example.mokahr.com/jobs' },
    page: { status: 200, finalUrl: 'https://example.mokahr.com/jobs', html: '<h1>招聘职位</h1>' },
  });
  assert.ok(result.evidence.some((item) => item.code === 'ats_fingerprint_only'));
  assert.ok(!result.evidence.some((item) => item.code === 'verified_ats_tenant'));
});

test('known official domain becomes an independent anchor', async () => {
  const result = await verificationAdapter.inspect({
    company: { canonicalName: '示例科技', officialDomains: ['example.com'] },
    candidate: { url: 'https://jobs.example.com/openings' },
    page: { status: 200, finalUrl: 'https://jobs.example.com/openings', html: '<h1>Open positions</h1>' },
  });
  assert.ok(result.evidence.some((item) => item.code === 'official_domain_match'));
});

test('job extraction maps page provider output without inventing dates', async () => {
  const jobs = await jobExtractor.extract({
    company: { id: 'company-1', canonicalName: '示例科技' },
    portal: {
      id: 'portal-1',
      companyId: 'company-1',
      canonicalUrl: 'https://jobs.example.com/openings',
      pageType: 'JOB_LIST',
      verificationStatus: 'VERIFIED',
    },
    intent: { roleFamily: 'PRODUCT_MANAGEMENT' },
  });
  assert.equal(jobs[0].title, 'AI 产品经理');
  assert.equal(jobs[0].publishedAt, null);
});
```

- [ ] **步骤 2：运行 Adapter 测试验证失败**

运行：

```powershell
npm.cmd test -- tests/upstream-adapters.test.mjs
```

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现官方验证 Adapter**

复用：

```js
import { detectAtsFingerprint } from '../../../engine/upstream/planner/cn-ats-fingerprint.mjs';
import { evaluateCandidateIdentity } from '../../../engine/upstream/planner/cn-identity-verifier.mjs';
import { classifySurfacePage } from '../../../engine/upstream/planner/cn-surface-drill.mjs';
import { registrableDomainOf } from '../../../engine/upstream/planner/cn-url-evidence.mjs';
```

关键约束：

```js
const finalDomain = registrableDomainOf(page.finalUrl || candidate.url);
const officialDomainMatch = (company.officialDomains || []).some((domain) => domain === finalDomain);

// 禁止：
// officialDomains: [finalDomain]
// autoOfficialDomain: true

// 允许：
if (officialDomainMatch) {
  evidence.push({ code: 'official_domain_match', sourceUrl: page.finalUrl || candidate.url });
}
```

先执行聚合、高校、新闻、培训机构硬拒绝分类，再执行 ATS 指纹和页面角色判断。`evaluateCandidateIdentity()` 的结果只能转换已存在的强证据，不能把 `PROBABLE` 直接转换为身份锚点。

- [ ] **步骤 4：实现岗位抽取 Adapter**

复用：

```js
import { resolvePageProvider } from '../../../engine/upstream/planner/page-providers/_registry.mjs';
import { fetchJobDetail } from '../../../engine/upstream/planner/detail-fetchers.mjs';
```

`createUpstreamJobExtractionAdapter()` 接受必需的 `fetchPage`，并接受可注入的 `fetchDetail` 和 `resolvePageProvider`。后二者默认使用上游 `fetchJobDetail` 和 `resolvePageProvider`；`fetchPage` 由 Runtime 提供带超时、重定向和 User-Agent 的统一实现。先解析 Page Provider 的 `activeJobs` 或 `jobs`；若 Portal 是 `JOB_DETAIL`，调用 `fetchDetail()`。所有输出通过 `createJobOpening()`，发布日期解析失败时保持 `null`。

- [ ] **步骤 5：实现旧 JobResult 投影**

`toLegacyJobResult({ company, portal, opening })` 调用现有 `createJobResult()`，仅将 Portal 的实际 `pageType` 写入对应 URL 字段。`JOB_LIST` URL 不能复制到 `applyUrl`，`sourceUrl` 必须保留岗位原始来源。

- [ ] **步骤 6：运行 Adapter 测试和引擎等价测试**

运行：

```powershell
npm.cmd test -- tests/upstream-adapters.test.mjs tests/engine-parity.test.mjs tests/cn-workflow.test.mjs tests/na-workflow.test.mjs
```

预期：全部 PASS。

- [ ] **步骤 7：提交 Adapter**

```powershell
git add -- src/adapters tests/upstream-adapters.test.mjs
git commit -m "feat: adapt upstream verification and job extraction"
```

### 第一阶段检查点

- [ ] 运行：

```powershell
npm.cmd test
git diff --check
git status --short
```

预期：

- 所有测试 PASS。
- `engine/upstream/providers/*` 无修改。
- 旧 API 测试继续 PASS。
- 不存在候选域名自证官网的路径。
- Git 状态仅包含计划内文件。

---

## 第二阶段：SQLite、完整用例和 CLI

### 任务 7：实现 Repository Port 和 SQLite Schema

**文件：**
- 创建：`src/ports/job-repository.mjs`
- 创建：`src/storage/migrations/001-market-discovery.sql`
- 创建：`src/storage/sqlite-job-repository.mjs`
- 修改：`package.json`
- 修改：`package-lock.json`
- 测试：`tests/sqlite-repository.test.mjs`

- [ ] **步骤 1：安装 SQLite 依赖**

运行：

```powershell
npm.cmd install better-sqlite3
```

预期：`package.json` 和 `package-lock.json` 只新增 `better-sqlite3` 及其传递依赖。

- [ ] **步骤 2：编写失败的 Repository 测试**

```js
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

test('SQLite repositories upsert a complete verified chain idempotently', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-market-'));
  const repository = openSqliteMarketDiscoveryRepository({ file: path.join(directory, 'jobs.sqlite') });
  repository.migrate();
  repository.upsertCompany({
    id: 'company-1', canonicalName: '示例科技', aliases: ['示例'], officialDomains: ['example.com'],
    industryTags: ['AI'], market: 'CN', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z',
  });
  repository.upsertCareerPortal({
    id: 'portal-1', companyId: 'company-1', canonicalUrl: 'https://jobs.example.com',
    url: 'https://jobs.example.com', registrableDomain: 'example.com', atsType: '',
    pageType: 'JOB_LIST', verificationStatus: 'VERIFIED', confidenceScore: 80,
    evidence: [], firstSeenAt: '2026-07-24T00:00:00.000Z', lastVerifiedAt: '2026-07-24T00:00:00.000Z',
  });
  const opening = {
    id: 'job-1', companyId: 'company-1', careerPortalId: 'portal-1', sourceJobId: '1',
    title: 'AI 产品经理', normalizedTitle: 'ai 产品经理', roleFamily: 'PRODUCT_MANAGEMENT',
    locations: ['上海'], employmentType: 'full_time', publishedAt: '2026-07-20T00:00:00.000Z',
    closesAt: null, jobDetailUrl: 'https://jobs.example.com/1', applyUrl: null,
    status: 'ACTIVE', sourceUrl: 'https://jobs.example.com/1',
    firstSeenAt: '2026-07-24T00:00:00.000Z', lastSeenAt: '2026-07-24T00:00:00.000Z',
  };
  repository.upsertJobOpening(opening);
  repository.upsertJobOpening(opening);
  assert.equal(repository.listJobOpenings().length, 1);
  repository.close();
});

test('repository rejects jobs under an unverified portal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-market-review-'));
  const repository = openSqliteMarketDiscoveryRepository({ file: path.join(directory, 'jobs.sqlite') });
  repository.migrate();
  repository.upsertCompany({
    id: 'company-2', canonicalName: '待复核公司', aliases: [], officialDomains: [],
    industryTags: ['AI'], market: 'CN', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z',
  });
  repository.upsertCareerPortal({
    id: 'portal-2', companyId: 'company-2', canonicalUrl: 'https://tenant.example/jobs',
    url: 'https://tenant.example/jobs', registrableDomain: 'tenant.example', atsType: 'MOKA',
    pageType: 'JOB_LIST', verificationStatus: 'REVIEW', confidenceScore: 50,
    evidence: [], firstSeenAt: '2026-07-24T00:00:00.000Z', lastVerifiedAt: '2026-07-24T00:00:00.000Z',
  });
  assert.throws(() => repository.upsertJobOpening({
    id: 'job-2', companyId: 'company-2', careerPortalId: 'portal-2', sourceJobId: '2',
    title: 'AI 产品经理', normalizedTitle: 'ai 产品经理', roleFamily: 'PRODUCT_MANAGEMENT',
    locations: [], employmentType: null, publishedAt: '2026-07-20T00:00:00.000Z',
    closesAt: null, jobDetailUrl: 'https://tenant.example/jobs/2', applyUrl: null,
    status: 'ACTIVE', sourceUrl: 'https://tenant.example/jobs/2',
    firstSeenAt: '2026-07-24T00:00:00.000Z', lastSeenAt: '2026-07-24T00:00:00.000Z',
  }), /verified CareerPortal/);
  repository.close();
});
```

- [ ] **步骤 3：运行 Repository 测试验证失败**

运行：

```powershell
npm.cmd test -- tests/sqlite-repository.test.mjs
```

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 4：创建 Schema**

`src/ports/job-repository.mjs`：

```js
const REQUIRED_METHODS = Object.freeze([
  'migrate', 'withTransaction', 'beginRun', 'completeRun',
  'upsertCompany', 'upsertCareerPortal', 'replaceVerificationEvidence',
  'upsertJobOpening', 'appendDiscoveryLog',
  'listCompanies', 'listCareerPortals', 'listJobOpenings', 'listDiscoveryLogs',
  'close',
]);

export function assertMarketDiscoveryRepository(repository) {
  for (const method of REQUIRED_METHODS) {
    if (typeof repository?.[method] !== 'function') {
      throw new Error(`repository.${method} is required`);
    }
  }
  return repository;
}
```

`001-market-discovery.sql` 至少包含：

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('CN', 'NA')),
  primary_official_domain TEXT,
  industry_tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (market, canonical_name)
);

CREATE TABLE IF NOT EXISTS company_aliases (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  PRIMARY KEY (company_id, alias)
);

CREATE TABLE IF NOT EXISTS company_domains (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  market TEXT NOT NULL,
  PRIMARY KEY (company_id, domain),
  UNIQUE (market, domain)
);

CREATE TABLE IF NOT EXISTS career_portals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  registrable_domain TEXT NOT NULL,
  ats_type TEXT NOT NULL DEFAULT '',
  page_type TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  first_seen_at TEXT NOT NULL,
  last_verified_at TEXT
);

CREATE TABLE IF NOT EXISTS verification_evidence (
  career_portal_id TEXT NOT NULL REFERENCES career_portals(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  direction TEXT NOT NULL,
  weight INTEGER NOT NULL,
  observed_value TEXT,
  source_url TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  PRIMARY KEY (career_portal_id, code, source_url)
);

CREATE TABLE IF NOT EXISTS job_openings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  career_portal_id TEXT NOT NULL REFERENCES career_portals(id) ON DELETE CASCADE,
  source_job_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  role_family TEXT NOT NULL,
  locations_json TEXT NOT NULL DEFAULT '[]',
  employment_type TEXT,
  published_at TEXT,
  closes_at TEXT,
  job_detail_url TEXT,
  apply_url TEXT,
  status TEXT NOT NULL,
  source_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  intent_json TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS discovery_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  search_intent_id TEXT NOT NULL,
  query TEXT NOT NULL,
  expanded_keywords_json TEXT NOT NULL DEFAULT '[]',
  search_source TEXT NOT NULL,
  searched_at TEXT NOT NULL,
  result_url TEXT,
  result_rank INTEGER,
  outcome TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
```

- [ ] **步骤 5：实现 Repository**

`openSqliteMarketDiscoveryRepository({ file })` 返回：

```js
{
  migrate,
  withTransaction,
  beginRun,
  completeRun,
  upsertCompany,
  upsertCareerPortal,
  replaceVerificationEvidence,
  upsertJobOpening,
  appendDiscoveryLog,
  listCompanies,
  listCareerPortals,
  listJobOpenings,
  listDiscoveryLogs,
  close,
}
```

`upsertJobOpening()` 必须先查询关联 Portal，只有 `verification_status = 'VERIFIED'` 才允许写入。数组和 metadata 统一用 `JSON.stringify()` 存储，读取时恢复数组或对象。

- [ ] **步骤 6：运行 Repository 测试**

运行：

```powershell
npm.cmd test -- tests/sqlite-repository.test.mjs
```

预期：全部 PASS。

- [ ] **步骤 7：提交 SQLite 持久化**

```powershell
git add -- package.json package-lock.json src/ports/job-repository.mjs src/storage tests/sqlite-repository.test.mjs
git commit -m "feat: persist market discovery in sqlite"
```

### 任务 8：实现可配置 LLM Adapter 和运行配置

**文件：**
- 创建：`src/adapters/llm/openai-compatible-planning-adapter.mjs`
- 修改：`src/runtime/config.mjs`
- 修改：`.env.example`
- 测试：`tests/llm-planning-adapter.test.mjs`
- 测试：`tests/cache-budget.test.mjs`

- [ ] **步骤 1：编写失败的 LLM Adapter 测试**

```js
test('adapter is not configured without endpoint and model', () => {
  const adapter = createOpenAiCompatiblePlanningAdapter({ endpoint: '', model: '' });
  assert.equal(adapter.configured, false);
});

test('adapter sends a bounded JSON request and parses JSON content', async () => {
  const calls = [];
  const adapter = createOpenAiCompatiblePlanningAdapter({
    endpoint: 'https://llm.example.test/v1/chat/completions',
    model: 'fixture-model',
    apiKey: 'secret',
    fetcher: async (url, options) => {
      const headers = new Headers(options.headers);
      calls.push({
        url,
        method: options.method,
        authorization: headers.has('authorization') ? 'configured' : 'not_configured',
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"terms":["AI 产品经理"]}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await adapter.generate({ task: 'expand_keywords', input: { roleType: 'AI 产品经理' } });
  assert.deepEqual(result, { terms: ['AI 产品经理'] });
  assert.doesNotMatch(JSON.stringify(calls), /secret/);
});
```

测试记录请求时必须先将 Authorization 脱敏，不能把 fixture secret 写进失败输出。

- [ ] **步骤 2：运行测试验证失败**

运行：

```powershell
npm.cmd test -- tests/llm-planning-adapter.test.mjs
```

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现 LLM Adapter**

固定配置名：

```text
LITE_JOB_LLM_ENDPOINT
LITE_JOB_LLM_MODEL
LITE_JOB_LLM_API_KEY
LITE_JOB_LLM_TIMEOUT_MS
LITE_JOB_DATABASE_FILE
LITE_JOB_DISCOVERY_MAX_QUERIES
LITE_JOB_DISCOVERY_MAX_RESULTS
```

endpoint 不设置默认值。Adapter 只访问明确配置的 HTTPS endpoint，使用 `AbortController` 超时，要求响应 content 为 JSON 对象。HTTP 错误只返回状态和脱敏消息。

- [ ] **步骤 4：扩展运行配置**

`loadRuntimeConfig()` 新增：

```js
llm: {
  endpoint: String(env.LITE_JOB_LLM_ENDPOINT || ''),
  model: String(env.LITE_JOB_LLM_MODEL || ''),
  configured: Boolean(env.LITE_JOB_LLM_ENDPOINT && env.LITE_JOB_LLM_MODEL),
  timeoutMs: positiveInteger(env.LITE_JOB_LLM_TIMEOUT_MS, 30_000),
},
database: {
  file: String(env.LITE_JOB_DATABASE_FILE || ''),
},
discovery: {
  maxQueries: Math.min(20, positiveInteger(env.LITE_JOB_DISCOVERY_MAX_QUERIES, 12)),
  maxResults: Math.min(1000, positiveInteger(env.LITE_JOB_DISCOVERY_MAX_RESULTS, 100)),
},
```

`createMarketDiscoveryRuntime()` 在 `database.file` 为空时使用项目根目录下的 `data/lite-job-search.sqlite`，因此 `runtime/config.mjs` 不需要知道项目 root。

- [ ] **步骤 5：运行 LLM 和配置测试**

运行：

```powershell
npm.cmd test -- tests/llm-planning-adapter.test.mjs tests/cache-budget.test.mjs
```

预期：全部 PASS，测试输出不包含 API Key。

- [ ] **步骤 6：提交 LLM Adapter**

```powershell
git add -- src/adapters/llm src/runtime/config.mjs .env.example tests/llm-planning-adapter.test.mjs tests/cache-budget.test.mjs
git commit -m "feat: add configurable discovery planning adapter"
```

### 任务 9：实现完整应用用例

**文件：**
- 创建：`src/application/discover-market-jobs.mjs`
- 创建：`tests/discover-market-jobs.test.mjs`
- 创建：`tests/fixtures/ai-product-manager/search-results.json`
- 创建：`tests/fixtures/ai-product-manager/pages.json`
- 创建：`tests/fixtures/ai-product-manager/planning.json`

- [ ] **步骤 1：准备离线夹具**

夹具包含三类结果：

1. 企业官网链接到招聘入口。
2. 招聘聚合页，必须拒绝。
3. ATS 页面但缺少企业身份锚点，必须进入 `REVIEW`。

至少一条正式岗位：

```json
{
  "company": "示例智能科技",
  "title": "AI 产品经理",
  "location": "上海",
  "publishedAt": "2026-07-20T00:00:00.000Z",
  "jobDetailUrl": "https://jobs.example.com/positions/ai-pm",
  "sourceJobId": "ai-pm"
}
```

- [ ] **步骤 2：编写失败的端到端用例测试**

```js
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discoverMarketJobs } from '../src/application/discover-market-jobs.mjs';
import { createJobOpening } from '../src/domain/job-opening.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const intent = {
  market: 'CN',
  roleType: 'AI 产品经理',
  industryTags: ['AI', '互联网'],
  freshnessDays: 90,
  targetCount: 20,
};

async function createHarness({ publishedAt = '2026-07-20T00:00:00.000Z' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-discovery-'));
  const repository = openSqliteMarketDiscoveryRepository({ file: path.join(directory, 'jobs.sqlite') });
  repository.migrate();
  let runSequence = 0;
  let logSequence = 0;
  const dependencies = {
    repository,
    now: () => '2026-07-24T00:00:00.000Z',
    ids: {
      intent: () => 'intent-ai-pm',
      run: () => `run-${++runSequence}`,
      company: (candidate) => `company-${candidate.company}`,
      portal: (candidate) => `portal-${new URL(candidate.url).hostname}`,
      log: () => `log-${++logSequence}`,
    },
    planningModel: {
      configured: true,
      async generate({ task }) {
        if (task === 'expand_keywords') {
          return { primaryRole: 'AI 产品经理', terms: ['AI 产品经理'], englishTerms: ['AI Product Manager'] };
        }
        return { queries: [{ text: '"AI 产品经理" 招聘', preferredSources: ['manual'], topK: 10 }] };
      },
    },
    searchSource: {
      async search() {
        return {
          status: 'ok',
          provider: 'manual',
          attempts: [{ provider: 'manual', status: 'ok', networkRequest: false }],
          items: [
            { company: '示例智能科技', url: 'https://jobs.example.com/openings', confirmedOfficialDomain: 'example.com', rank: 1 },
            { company: '聚合站转载公司', url: 'https://aggregator.example/jobs/1', rank: 2 },
            { company: '待复核 ATS 公司', url: 'https://tenant.mokahr.example/jobs', rank: 3 },
          ],
        };
      },
    },
    fetchPage: async (url) => ({ status: 200, finalUrl: url, html: '<h1>招聘职位</h1>' }),
    verificationAdapter: {
      async inspect({ candidate }) {
        if (candidate.url.includes('aggregator')) {
          return {
            pageType: 'JOB_LIST',
            atsType: '',
            registrableDomain: 'aggregator.example',
            evidence: [{ code: 'aggregator_domain' }],
          };
        }
        if (candidate.url.includes('mokahr')) {
          return {
            pageType: 'JOB_LIST',
            atsType: 'MOKA',
            registrableDomain: 'mokahr.example',
            evidence: [{ code: 'ats_fingerprint_only' }, { code: 'recruitment_structure' }],
          };
        }
        return {
          pageType: 'JOB_LIST',
          atsType: '',
          registrableDomain: 'example.com',
          evidence: [
            { code: 'official_domain_match' },
            { code: 'recruitment_structure' },
            { code: 'apply_action' },
            { code: 'official_site_backlink' },
          ],
        };
      },
    },
    jobExtractor: {
      async extract({ company, portal }) {
        return [createJobOpening({
          companyId: company.id,
          careerPortalId: portal.id,
          sourceJobId: 'ai-pm',
          title: 'AI 产品经理',
          normalizedTitle: 'AI 产品经理',
          roleFamily: 'PRODUCT_MANAGEMENT',
          locations: ['上海'],
          publishedAt,
          jobDetailUrl: 'https://jobs.example.com/positions/ai-pm',
          status: 'ACTIVE',
          sourceUrl: 'https://jobs.example.com/positions/ai-pm',
        }, { now: '2026-07-24T00:00:00.000Z' })];
      },
    },
  };
  return { repository, dependencies };
}

test('AI 产品经理 intent stores only jobs from verified portals', async () => {
  const { repository, dependencies } = await createHarness();
  const result = await discoverMarketJobs({
    market: 'CN',
    roleType: 'AI 产品经理',
    industryTags: ['AI', '互联网'],
    freshnessDays: 90,
    targetCount: 20,
  }, dependencies);

  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.companiesDiscovered, 3);
  assert.equal(result.portalsVerified, 1);
  assert.equal(result.jobsStored, 1);
  assert.equal(result.reviewRequired, 1);
  assert.equal(result.rejected, 1);
  assert.equal(repository.listJobOpenings()[0].title, 'AI 产品经理');
  assert.ok(repository.listDiscoveryLogs().some((item) => item.outcome === 'VERIFIED_PORTAL'));
  repository.close();
});

test('rerunning the same fixture is idempotent', async () => {
  const { repository, dependencies } = await createHarness();
  await discoverMarketJobs(intent, dependencies);
  await discoverMarketJobs(intent, dependencies);
  assert.equal(repository.listCompanies().length, 3);
  assert.equal(repository.listJobOpenings().length, 1);
  repository.close();
});

test('unknown publication dates do not satisfy a recent-only result', async () => {
  const { repository, dependencies } = await createHarness({ publishedAt: null });
  const result = await discoverMarketJobs(intent, dependencies);
  assert.equal(result.jobsStored, 0);
  assert.ok(repository.listDiscoveryLogs().some((item) => item.outcome === 'NO_RECENT_JOBS'));
  repository.close();
});
```

- [ ] **步骤 3：运行应用测试验证失败**

运行：

```powershell
npm.cmd test -- tests/discover-market-jobs.test.mjs
```

预期：FAIL，报错 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 4：实现应用编排**

固定阶段顺序：

```js
import { createCareerPortal } from '../domain/career-portal.mjs';
import { createCompany } from '../domain/company.mjs';
import { createSearchIntent } from '../domain/search-intent.mjs';
import { isRecentOpening } from '../domain/job-opening.mjs';
import { discoverCompanies } from '../discovery/company-discovery.mjs';
import { expandKeywords } from '../discovery/keyword-expander.mjs';
import { planQueries } from '../discovery/query-planner.mjs';
import { verifyCareerPortal } from '../verification/verification-engine.mjs';

export async function discoverMarketJobs(input, {
  planningModel,
  searchSource,
  verificationAdapter,
  pageAdvisoryClassifier = null,
  jobExtractor,
  repository,
  fetchPage,
  ids,
  now = () => new Date().toISOString(),
} = {}) {
  const intent = createSearchIntent(input, { id: ids.intent(), now: now() });
  const runId = ids.run();
  const counters = {
    companiesDiscovered: 0,
    portalsVerified: 0,
    jobsStored: 0,
    reviewRequired: 0,
    rejected: 0,
  };
  repository.beginRun({ id: runId, intent, startedAt: now() });
  try {
    const keywords = await expandKeywords(intent, { planningModel });
    const queryPlan = await planQueries(intent, keywords, { planningModel });
    const discovery = await discoverCompanies({
      intent, queryPlan, runId,
      searchSource,
      now: now(),
    });
    for (const log of discovery.logs) repository.appendDiscoveryLog(log);

    for (const candidate of discovery.candidates) {
      if (counters.jobsStored >= intent.targetCount) break;
      const company = createCompany({
        id: ids.company(candidate),
        canonicalName: candidate.company,
        aliases: candidate.aliases || [],
        primaryOfficialDomain: candidate.confirmedOfficialDomain || null,
        officialDomains: candidate.confirmedOfficialDomain ? [candidate.confirmedOfficialDomain] : [],
        industryTags: intent.industryTags,
        market: intent.market,
      }, { now: now() });
      counters.companiesDiscovered += 1;
      let page;
      try {
        page = await fetchPage(candidate.url);
      } catch (error) {
        repository.appendDiscoveryLog({
          id: ids.log(),
          runId,
          searchIntentId: intent.id,
          query: candidate.query,
          expandedKeywords: keywords.terms,
          searchSource: candidate.searchSource,
          searchedAt: now(),
          resultUrl: candidate.url,
          resultRank: candidate.rank,
          outcome: 'FETCH_FAILED',
          metadata: { error: String(error?.message || error).slice(0, 240) },
        });
        continue;
      }
      const inspected = await verificationAdapter.inspect({ company, candidate, page });
      const decision = verifyCareerPortal(inspected);
      const advisory = decision.verificationStatus === 'REVIEW' && pageAdvisoryClassifier
        ? await pageAdvisoryClassifier({
          url: page.finalUrl || candidate.url,
          title: page.title || '',
          text: page.text || page.html || '',
        })
        : null;
      const portalEvidence = advisory ? [...decision.evidence, advisory] : decision.evidence;
      const portal = createCareerPortal({
        id: ids.portal(candidate),
        companyId: company.id,
        url: candidate.url,
        canonicalUrl: page.finalUrl || candidate.url,
        registrableDomain: inspected.registrableDomain,
        atsType: inspected.atsType,
        pageType: decision.pageType,
        verificationStatus: decision.verificationStatus,
        confidenceScore: decision.confidenceScore,
        evidence: portalEvidence,
        lastVerifiedAt: now(),
      }, { now: now() });
      repository.withTransaction(() => {
        repository.upsertCompany(company);
        repository.upsertCareerPortal(portal);
        repository.replaceVerificationEvidence(portal.id, portalEvidence);
      });
      const outcome = decision.verificationStatus === 'VERIFIED'
        ? 'VERIFIED_PORTAL'
        : decision.verificationStatus === 'REJECTED'
          ? 'REJECTED'
          : 'REVIEW_REQUIRED';
      repository.appendDiscoveryLog({
        id: ids.log(),
        runId,
        searchIntentId: intent.id,
        query: candidate.query,
        expandedKeywords: keywords.terms,
        searchSource: candidate.searchSource,
        searchedAt: now(),
        resultUrl: portal.canonicalUrl,
        resultRank: candidate.rank,
        outcome,
        metadata: {
          verificationStatus: decision.verificationStatus,
          confidenceScore: decision.confidenceScore,
          llmAdvisory: advisory?.observedValue || null,
        },
      });
      if (decision.verificationStatus === 'REVIEW' || decision.verificationStatus === 'BLOCKED') counters.reviewRequired += 1;
      if (decision.verificationStatus === 'REJECTED') counters.rejected += 1;
      if (decision.verificationStatus !== 'VERIFIED') continue;
      counters.portalsVerified += 1;
      const openings = await jobExtractor.extract({ company, portal, intent });
      for (const opening of openings) {
        if (!isRecentOpening(opening, { freshnessDays: intent.freshnessDays, now: Date.parse(now()) })) {
          repository.appendDiscoveryLog({
            id: ids.log(),
            runId,
            searchIntentId: intent.id,
            query: candidate.query,
            expandedKeywords: keywords.terms,
            searchSource: candidate.searchSource,
            searchedAt: now(),
            resultUrl: opening.sourceUrl,
            resultRank: candidate.rank,
            outcome: 'NO_RECENT_JOBS',
            metadata: { publishedAt: opening.publishedAt },
          });
          continue;
        }
        repository.upsertJobOpening(opening);
        counters.jobsStored += 1;
      }
    }
    const status = counters.jobsStored >= intent.targetCount ? 'COMPLETE' : 'PARTIAL';
    const terminalStatus = ['DEFERRED_BY_BUDGET', 'NOT_CONFIGURED'].includes(discovery.status)
      ? discovery.status
      : status;
    repository.completeRun({ id: runId, status: terminalStatus, completedAt: now() });
    return {
      runId,
      intent,
      status: terminalStatus,
      ...counters,
      providerAttempts: discovery.providerAttempts,
    };
  } catch (error) {
    repository.completeRun({ id: runId, status: 'FAILED', completedAt: now(), error });
    throw error;
  }
}
```

`ids` 契约固定为：

```js
{
  intent: () => string,
  run: () => string,
  company: (candidate) => string,
  portal: (candidate) => string,
  log: () => string,
}
```

实际实现要把每次抓取、拒绝、复核、验证、无近期岗位和抽取失败写入 DiscoveryLog。单个候选失败不终止整个运行；数据库事务失败和规划 Schema 失败终止运行。

- [ ] **步骤 5：运行应用测试**

运行：

```powershell
npm.cmd test -- tests/discover-market-jobs.test.mjs
```

预期：全部 PASS。

- [ ] **步骤 6：提交应用用例**

```powershell
git add -- src/application tests/discover-market-jobs.test.mjs tests/fixtures/ai-product-manager
git commit -m "feat: orchestrate role-driven job discovery"
```

### 任务 10：组装 Runtime、CLI 和 Doctor

**文件：**
- 创建：`src/runtime/create-market-discovery-runtime.mjs`
- 创建：`src/runtime/fetch-page.mjs`
- 创建：`src/cli/discover.mjs`
- 修改：`src/cli/main.mjs`
- 修改：`src/cli/doctor.mjs`
- 修改：`src/index.mjs`
- 测试：`tests/market-discovery-cli.test.mjs`
- 测试：`tests/fetch-page.test.mjs`
- 测试：`tests/cli.test.mjs`

- [ ] **步骤 1：编写失败的 CLI 测试**

```js
test('discover requires role and market', () => {
  const result = run(['discover', '--market', 'CN', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /discover requires --market and --role/);
});

test('discover runs offline with planning, search and page fixtures', async () => {
  const result = run([
    'discover',
    '--market', 'CN',
    '--role', 'AI产品经理',
    '--industry', 'AI,互联网',
    '--since-days', '90',
    '--limit', '20',
    '--planning-fixture', planningFixture,
    '--manual', searchFixture,
    '--fixture-pages', pagesFixture,
    '--database', databaseFile,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.jobsStored, 1);
  assert.equal(output.portalsVerified, 1);
});

test('discover without an LLM configuration reports not configured', () => {
  const result = run(['discover', '--market', 'CN', '--role', 'AI产品经理', '--json']);
  assert.equal(JSON.parse(result.stdout).status, 'NOT_CONFIGURED');
});
```

在 `tests/fetch-page.test.mjs` 增加：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPublicHttpUrl, createPageFetcher } from '../src/runtime/fetch-page.mjs';

test('page fetcher rejects local and private network targets', () => {
  assert.throws(() => assertPublicHttpUrl('file:///etc/passwd'), /http/i);
  assert.throws(() => assertPublicHttpUrl('http://localhost/admin'), /public/i);
  assert.throws(() => assertPublicHttpUrl('http://127.0.0.1/admin'), /public/i);
  assert.throws(() => assertPublicHttpUrl('http://10.0.0.1/admin'), /public/i);
});

test('page fetcher enforces response size', async () => {
  const fetchPage = createPageFetcher({
    maxBytes: 16,
    resolver: async () => [{ address: '93.184.216.34' }],
    fetcher: async () => new Response('x'.repeat(17), {
      status: 200,
      headers: { 'content-length': '17' },
    }),
  });
  await assert.rejects(fetchPage('https://example.com/jobs'), /response too large/);
});
```

- [ ] **步骤 2：运行 CLI 测试验证失败**

运行：

```powershell
npm.cmd test -- tests/market-discovery-cli.test.mjs tests/fetch-page.test.mjs
```

预期：FAIL，因为 `discover` 命令和受限 Page Fetcher 尚不存在。

- [ ] **步骤 3：实现受限 Page Fetcher**

`src/runtime/fetch-page.mjs` 必须：

- 只允许 `http:` 和 `https:`。
- 拒绝 `localhost`、`.local`、IP literal 的回环、链路本地和私网段。
- 每次请求和每次重定向前解析 DNS，任一解析地址属于私网时拒绝。
- 使用 `redirect: 'manual'`，最多跟随 5 次，并重新校验每个 Location。
- 默认 15 秒超时。
- 默认最大读取 5 MiB；同时校验 `content-length` 和实际读取字节数。
- 只返回 `{ status, finalUrl, html, headers }`，不返回 Cookie 或 Authorization。

导出接口：

```js
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

function isPrivateIpLiteral(value) {
  const host = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31
      || a === 192 && b === 168;
  }
  if (family === 6) {
    if (host.startsWith('::ffff:')) return isPrivateIpLiteral(host.slice(7));
    return host === '::' || host === '::1'
      || host.startsWith('fc') || host.startsWith('fd')
      || /^fe[89ab]/.test(host);
  }
  return false;
}

export function assertPublicHttpUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http(s) URLs are allowed');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || isPrivateIpLiteral(host)) {
    throw new Error('URL must target a public host');
  }
  return url;
}

export function createPageFetcher({
  fetcher = fetch,
  timeoutMs = 15_000,
  maxBytes = 5 * 1024 * 1024,
  maxRedirects = 5,
  resolver = (hostname) => lookup(hostname, { all: true, verbatim: true }),
} = {}) {
  return async function fetchPage(rawUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let current = assertPublicHttpUrl(rawUrl);
    try {
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        const addresses = await resolver(current.hostname.replace(/^\[|\]$/g, ''));
        if (!addresses.length || addresses.some((item) => isPrivateIpLiteral(item.address))) {
          throw new Error('URL must resolve to a public host');
        }
        const response = await fetcher(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'user-agent': 'Lite-Job-Search/0.2 (+public recruitment discovery)' },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new Error('redirect response missing location');
          if (redirectCount === maxRedirects) throw new Error('too many redirects');
          current = assertPublicHttpUrl(new URL(location, current).href);
          continue;
        }
        const declaredLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          throw new Error('response too large');
        }
        const chunks = [];
        let total = 0;
        if (response.body) {
          for await (const chunk of response.body) {
            const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            total += bytes.byteLength;
            if (total > maxBytes) {
              controller.abort();
              throw new Error('response too large');
            }
            chunks.push(bytes);
          }
        }
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return {
          status: response.status,
          finalUrl: current.href,
          html: new TextDecoder().decode(body),
          headers: {
            contentType: response.headers.get('content-type') || '',
            etag: response.headers.get('etag') || '',
            lastModified: response.headers.get('last-modified') || '',
          },
        };
      }
      throw new Error('too many redirects');
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('page fetch timeout');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}
```

`isPrivateIpLiteral()` 必须覆盖 IPv4 的 `127/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`0/8`，以及 IPv6 `::1`、`fc00::/7`、`fe80::/10`。实现代码使用 `node:net` 的 `isIP()` 判断 literal，再对标准化地址做网段判断。

- [ ] **步骤 4：实现 Runtime 组装**

`createMarketDiscoveryRuntime(options)` 复用现有：

- `loadRuntimeConfig()`
- `createSearchProviders()`
- `SearchRouter`
- `FileSearchCache`
- `DailyBudget`

新增：

- Planning fixture 或 LLM Adapter。
- SQLite Repository。
- `createPageFetcher()` 的可注入版本。
- SearchSource、Verification 和 JobExtraction Adapter。
- `pageAdvisoryClassifier`，只在确定性结果为 `REVIEW` 时调用。

Runtime 不得加载或修改 `engine/upstream/providers/*`。

- [ ] **步骤 5：实现 CLI 参数解析**

`src/cli/discover.mjs` 将：

```js
{
  market: options.market,
  roleType: options.role,
  industryTags: String(options.industry || '').split(',').map((value) => value.trim()).filter(Boolean),
  freshnessDays: Number(options.sinceDays || 90),
  targetCount: Number(options.limit || 20),
}
```

传给 `discoverMarketJobs()`。`--planning-fixture`、`--manual` 和 `--fixture-pages` 只用于离线、可重复测试；输出必须标记 `liveSearchExecuted: false`。

- [ ] **步骤 6：扩展 Doctor**

Doctor 新字段：

```js
{
  llmPlanning: 'configured' | 'not_configured',
  database: 'ready' | 'not_ready',
  marketDiscoveryReady: Boolean,
}
```

不得输出 endpoint 查询参数、API Key、Authorization 或数据库中的岗位内容。

- [ ] **步骤 7：导出稳定 API**

`src/index.mjs` 新增：

```js
export { discoverMarketJobs } from './application/discover-market-jobs.mjs';
export { createSearchIntent } from './domain/search-intent.mjs';
export { verifyCareerPortal } from './verification/verification-engine.mjs';
export { openSqliteMarketDiscoveryRepository } from './storage/sqlite-job-repository.mjs';
```

保留当前所有导出。

- [ ] **步骤 8：运行 CLI 和旧 CLI 回归**

运行：

```powershell
npm.cmd test -- tests/market-discovery-cli.test.mjs tests/fetch-page.test.mjs tests/cli.test.mjs tests/legacy-compatibility.test.mjs
```

预期：全部 PASS。

- [ ] **步骤 9：提交 Runtime 和 CLI**

```powershell
git add -- src/runtime/create-market-discovery-runtime.mjs src/runtime/fetch-page.mjs src/cli/discover.mjs src/cli/main.mjs src/cli/doctor.mjs src/index.mjs tests/market-discovery-cli.test.mjs tests/fetch-page.test.mjs tests/cli.test.mjs
git commit -m "feat: expose market discovery CLI"
```

### 任务 11：更新文档和 Skill 契约

**文件：**
- 修改：`README.md`
- 修改：`docs/architecture.md`
- 修改：`.agents/skills/lite-job-search/SKILL.md`
- 修改：`.agents/skills/lite-job-search/references/data-contract.md`
- 修改：`.agents/skills/lite-job-search/references/china-market.md`
- 修改：`tests/skill-package.test.mjs`

- [ ] **步骤 1：编写失败的 Skill 文档测试**

新增断言：

```js
assert.match(skill, /lite-job-search discover/);
assert.match(skill, /LLM.*关键词.*Query/s);
assert.match(skill, /不能.*官网真实性/s);
assert.match(skill, /SQLite/);
assert.match(dataContract, /Company/);
assert.match(dataContract, /CareerPortal/);
assert.match(dataContract, /JobOpening/);
assert.match(dataContract, /DiscoveryLog/);
```

- [ ] **步骤 2：运行 Skill 测试验证失败**

运行：

```powershell
npm.cmd test -- tests/skill-package.test.mjs
```

预期：FAIL，缺少岗位驱动命令和新模型说明。

- [ ] **步骤 3：更新文档**

README 必须包含：

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

并明确：

- LLM 只扩展关键词和 Query。
- Candidate、Verified Portal、Usable Apply Entry 分开统计。
- 未知发布日期不算近期岗位。
- 聚合站、高校、新闻和培训机构不能作为官方入口。
- 无法达到数量时返回 `PARTIAL`。
- 学生 XLSX 输出通过兼容投影消费 JobOpening，本计划不重做 XLSX。

- [ ] **步骤 4：运行 Skill 校验**

运行：

```powershell
npm.cmd test -- tests/skill-package.test.mjs
npm.cmd run validate:skill
```

预期：全部 PASS。

- [ ] **步骤 5：提交文档和 Skill**

```powershell
git add -- README.md docs/architecture.md .agents/skills/lite-job-search tests/skill-package.test.mjs
git commit -m "docs: document role-driven job discovery"
```

### 任务 12：真实 Canary、全量验证和交付检查

**文件：**
- 修改：`package.json`
- 创建：`scripts/run-ai-product-manager-canary.mjs`
- 测试：全部测试

- [ ] **步骤 1：增加 Canary 脚本**

`run-ai-product-manager-canary.mjs` 只读取环境配置并调用公开 API：

```js
import { discoverMarketJobs } from '../src/index.mjs';
import { createMarketDiscoveryRuntime } from '../src/runtime/create-market-discovery-runtime.mjs';

const runtime = await createMarketDiscoveryRuntime({
  databaseFile: process.env.LITE_JOB_DATABASE_FILE,
});

const result = await discoverMarketJobs({
  market: 'CN',
  roleType: 'AI 产品经理',
  industryTags: ['AI', '互联网'],
  freshnessDays: 90,
  targetCount: 20,
}, runtime);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
```

不得自动填写或提交申请，不得绕过验证码。Canary 输出写入已忽略的 `test-output/`，数据库写入已忽略的 `data/`。

- [ ] **步骤 2：增加 package script**

```json
{
  "scripts": {
    "test:market-discovery": "node --test tests/domain-models.test.mjs tests/verification-engine.test.mjs tests/query-planner.test.mjs tests/company-discovery.test.mjs tests/upstream-adapters.test.mjs tests/sqlite-repository.test.mjs tests/discover-market-jobs.test.mjs tests/market-discovery-cli.test.mjs",
    "canary:ai-product-manager": "node ./scripts/run-ai-product-manager-canary.mjs"
  }
}
```

- [ ] **步骤 3：运行静态和全量测试**

运行：

```powershell
node --check src/application/discover-market-jobs.mjs
node --check src/runtime/create-market-discovery-runtime.mjs
npm.cmd run test:market-discovery
npm.cmd test
git diff --check
```

预期：所有命令退出码为 0。

- [ ] **步骤 4：运行离线闭环**

运行：

```powershell
node bin/lite-job-search.mjs discover `
  --market CN `
  --role "AI产品经理" `
  --industry "AI,互联网" `
  --since-days 90 `
  --limit 20 `
  --planning-fixture tests/fixtures/ai-product-manager/planning.json `
  --manual tests/fixtures/ai-product-manager/search-results.json `
  --fixture-pages tests/fixtures/ai-product-manager/pages.json `
  --database test-output/ai-product-manager-fixture.sqlite `
  --json
```

预期：

- `portalsVerified = 1`
- `jobsStored = 1`
- 聚合页为 `REJECTED`
- 无身份锚点 ATS 页为 `REVIEW`
- `liveSearchExecuted = false`

- [ ] **步骤 5：检查联网配置和预算**

运行：

```powershell
npm.cmd run doctor -- --json
```

只有 Doctor 报告 LLM、Search Provider、数据库均就绪且预算允许时，才运行：

```powershell
npm.cmd run canary:ai-product-manager *> test-output/ai-product-manager-canary.json
```

若未配置，记录 `NOT_CONFIGURED`；若预算耗尽，记录 `DEFERRED_BY_BUDGET`；若被验证码或访问控制阻断，记录 `BLOCKED`。这些状态都不能改写成“无岗位”。

- [ ] **步骤 6：核对真实 Canary 结果**

逐条检查：

- 每个 `VERIFIED` Portal 都有非 LLM 身份锚点。
- 每个正式 JobOpening 都关联 `VERIFIED` Portal。
- 发布时间位于 90 天窗口内，缺失日期记录未计入正式结果。
- 详情和投递链接保持角色分离。
- 搜索线索、官方入口和可投递入口分别计数。
- 未达到目标数量时结果为 `PARTIAL` 并列出阻断原因。

- [ ] **步骤 7：检查打包和 Git 范围**

运行：

```powershell
npm.cmd pack --dry-run
git status --short
git diff --name-only main...HEAD
```

预期：

- 包含新 `src/`、migration、脚本、Skill 和文档。
- 不包含 `.env.local`、SQLite 运行数据库、cache、`test-output/` 或密钥。
- `engine/upstream/providers/*` 未修改。
- 不包含其他 worktree 的 XLSX 变更。

- [ ] **步骤 8：提交 Canary 和验收脚本**

```powershell
git add -- package.json package-lock.json scripts/run-ai-product-manager-canary.mjs
git commit -m "test: add AI product manager discovery canary"
```

### 规格覆盖映射

| 规格要求 | 实施任务 |
|---|---|
| 旧 API 和 Provider 保持兼容 | 任务 1、6、10、第一阶段检查点 |
| Company、CareerPortal、JobOpening、DiscoveryLog | 任务 2、7 |
| LLM 仅扩词、Query 和中性辅助分类 | 任务 4、8、11 |
| 官网真实性由确定性规则判断 | 任务 3、6、9 |
| 候选 URL 不得自证官网 | 任务 3、6、12 |
| 聚合、高校、新闻、培训机构负向规则 | 任务 3、6、9、12 |
| 岗位 Query 发现公司主体 | 任务 5 |
| ATS、页面角色和岗位抽取复用上游 | 任务 6 |
| SQLite、事务、幂等和正式岗位门禁 | 任务 7、9 |
| “AI 产品经理”完整闭环 | 任务 9、10、12 |
| 未知日期不计入近期岗位 | 任务 2、6、9、12 |
| 预算、阻断和数量不足如实报告 | 任务 5、9、10、12 |
| Skill、旧投影和 XLSX 消费边界 | 任务 6、11 |

### 最终完成条件

- [ ] 第一阶段和第二阶段检查点全部通过。
- [ ] 全量测试通过且旧 CLI 行为保持兼容。
- [ ] LLM 输出无法设置官网真实性或验证分数。
- [ ] 候选 URL 不能用自己的注册域名自证官网。
- [ ] 硬拒绝规则先于 ATS 指纹。
- [ ] SQLite 重跑幂等且拒绝未验证 Portal 的岗位。
- [ ] 离线完整闭环可重复。
- [ ] 真实 Canary 只报告实际执行结果，不承诺固定命中数量。
- [ ] 工作区不包含密钥、运行数据库、缓存或无关输出。
