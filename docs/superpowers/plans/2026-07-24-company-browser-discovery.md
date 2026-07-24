# 公司招聘浏览器检索实现计划

> **面向 AI 代理的工作者：** 使用 `superpowers:executing-plans` 逐任务实现；每一步先运行失败测试，再写最小实现。

**目标：** 用独立 Playwright 脚本从公司清单发现官方招聘候选及严格隔离的第三方 `LEAD_ONLY` 线索。

**架构：** 新脚本负责浏览器结果读取、过滤、分类与招聘页面下钻，只写 JSON 发现工件。现有 CLI 继续负责官网验证、岗位提取和存储，因此不改变 Provider contract、验证规则或 SQLite schema。

**技术栈：** Node.js ESM、Playwright、现有 `node:test`、现有公共 URL 安全工具。

---

### 任务 1：定义可测试的浏览器发现分类器

**文件：**
- 新建：`scripts/company-browser-discovery.mjs`
- 新建：`tests/company-browser-discovery.test.mjs`

- [ ] **步骤 1：写失败测试**

```js
import { classifySearchResult } from '../scripts/company-browser-discovery.mjs';

assert.equal(classifySearchResult({
  company: '小红书', officialDomain: 'xiaohongshu.com',
  title: '小红书招聘', url: 'https://job.xiaohongshu.com/social/position', kind: 'organic',
}).classification, 'OFFICIAL_CANDIDATE');
```

增加断言：广告/新闻为 `REJECTED`，主站首页为 `REJECTED`，猎聘主体页为 `LEAD_ONLY`。

- [ ] **步骤 2：运行失败测试**

运行：`node --test tests/company-browser-discovery.test.mjs`

预期：失败，原因是 `classifySearchResult` 尚未导出。

- [ ] **步骤 3：写最小实现**

```js
export function classifySearchResult(result) {
  // Validate public HTTP(S), reject non-organic/news/advertisement records,
  // classify first-party recruitment URLs, and isolate known platform leads.
}
```

- [ ] **步骤 4：运行测试**

运行：`node --test tests/company-browser-discovery.test.mjs`

预期：通过。

- [ ] **步骤 5：提交**

```powershell
git add scripts/company-browser-discovery.mjs tests/company-browser-discovery.test.mjs
git commit -m "feat(discovery): classify browser company search results"
```

### 任务 2：实现招聘入口页面下钻

**文件：**
- 修改：`scripts/company-browser-discovery.mjs`
- 修改：`tests/company-browser-discovery.test.mjs`

- [ ] **步骤 1：写失败测试**

```js
const discovered = discoverCareerLinks('https://hr.4399om.com/campus/', [
  { text: '实习生招聘', href: '/campus/internship' },
  { text: '应届生招聘', href: '/campus/graduate/' },
]);
assert.deepEqual(discovered.map(({ recruitmentType, url }) => ({ recruitmentType, url })), [
  { recruitmentType: 'INTERNSHIP', url: 'https://hr.4399om.com/campus/internship' },
  { recruitmentType: 'GRADUATE', url: 'https://hr.4399om.com/campus/graduate/' },
]);
```

- [ ] **步骤 2：运行失败测试**

运行：`node --test tests/company-browser-discovery.test.mjs`

预期：失败，原因是 `discoverCareerLinks` 尚未导出。

- [ ] **步骤 3：写最小实现**

```js
export function discoverCareerLinks(baseUrl, links) {
  // Resolve one-level public links and label social/campus/internship/graduate/job-list pages.
}
```

页面读取器只抽取可见链接与空态/岗位卡片文本；遇到验证码或登录页返回 `BLOCKED`。

- [ ] **步骤 4：运行测试**

运行：`node --test tests/company-browser-discovery.test.mjs`

预期：通过。

- [ ] **步骤 5：提交**

```powershell
git add scripts/company-browser-discovery.mjs tests/company-browser-discovery.test.mjs
git commit -m "feat(discovery): drill browser career entry pages"
```

### 任务 3：增加显式脚本入口与工件报告

**文件：**
- 修改：`scripts/company-browser-discovery.mjs`
- 修改：`tests/company-browser-discovery.test.mjs`
- 新建：`examples/company-browser-discovery-input.json`
- 修改：`README.md`（若该文件存在；否则新建 `docs/company-browser-discovery.md`）

- [ ] **步骤 1：写失败测试**

```js
const report = buildDiscoveryReport({ companies: 2, results: [
  { status: 'COMPLETED', officialCandidates: [{}], leads: [] },
  { status: 'BLOCKED', officialCandidates: [], leads: [] },
] });
assert.deepEqual(report.summary, {
  companies: 2, completed: 1, blocked: 1, failed: 0,
  officialCandidates: 1, leadOnly: 0,
});
```

- [ ] **步骤 2：运行失败测试**

运行：`node --test tests/company-browser-discovery.test.mjs`

预期：失败，原因是 `buildDiscoveryReport` 尚未导出。

- [ ] **步骤 3：写最小实现**

实现 `--input`、`--output-dir`、`--headful`、`--max-results` 参数；写出 `candidates.json`、`leads.json`、`report.json`。没有 Chromium 或无法访问搜索页时返回非零并写出 `FAILED` 工件。

- [ ] **步骤 4：运行测试与静态检查**

运行：

```powershell
node --test tests/company-browser-discovery.test.mjs
node --check scripts/company-browser-discovery.mjs
npm.cmd test
```

预期：新增测试及全量测试均通过。

- [ ] **步骤 5：提交**

```powershell
git add scripts/company-browser-discovery.mjs tests/company-browser-discovery.test.mjs examples/company-browser-discovery-input.json README.md docs/company-browser-discovery.md
git commit -m "feat(discovery): add browser company list runner"
```

### 任务 4：真实小样本 Canary（仅配置就绪后）

**文件：**
- 新建：`data/benchmarks/company-browser-canary/README.md`

- [ ] **步骤 1：运行环境检查**

运行：`npx playwright install --dry-run chromium` 与 `node scripts/company-browser-discovery.mjs --help`。

- [ ] **步骤 2：运行 2–3 家已知公司**

运行：`node scripts/company-browser-discovery.mjs --input examples/company-browser-discovery-input.json --output-dir <temporary-output> --max-results 10`。

只在公开可访问、无验证码的前提下执行；不登录、不提交申请、不绕过访问控制。

- [ ] **步骤 3：记录真实状态**

将 `COMPLETED`、`BLOCKED`、`FAILED` 与证据写入 Canary README；禁止将未实际访问的搜索结果写为成功。

- [ ] **步骤 4：提交**

```powershell
git add data/benchmarks/company-browser-canary/README.md
git commit -m "test(discovery): record browser company canary"
```

## 计划自检

- 官网候选、第三方线索与拒绝结果均有独立测试和输出路径。
- 4399 下钻和小红书招聘子域名均有固定测试，不依赖实时搜索。
- `LEAD_ONLY` 永远不会进入官方候选或官网验证成功统计。
- 浏览器、网络、登录/验证码失败会在逐公司报告中显式呈现。
- 没有修改 Provider、核心验证、数据库或既有 CLI。
