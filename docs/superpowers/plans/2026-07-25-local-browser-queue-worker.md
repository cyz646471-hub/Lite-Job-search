# 本地浏览器队列 Worker 实现计划

> **面向 AI 代理的工作者：** 在当前会话内逐任务执行；每项使用测试驱动开发并保留验证证据。

**目标：** 将公司浏览器脚本改造成真实 Chrome 优先、可恢复、无 LLM 热路径的本地队列 Worker。

**架构：** 保留 `runBrowserCompanyBatch`、SQLite repository、Verification Engine 和 Job Extraction。改造浏览器发现脚本的候选清洗与页面观察复用，新增可导入 Chrome 搜索观察的本地 Worker 入口。

**技术栈：** Node.js、Playwright、SQLite、现有 Lite-Job-search adapters。

---

### 任务 1：候选 URL 清洗

**文件：**
- 修改：`scripts/company-browser-discovery.mjs`
- 测试：`tests/company-browser-discovery.test.mjs`

- [ ] 写入测试：`javascript:`、百度内部页、广告、新闻、Jobui、51job 在任何导航前被拒绝。
- [ ] 运行 `node --test tests/company-browser-discovery.test.mjs`，确认因现有过滤不足失败。
- [ ] 实现纯函数候选清洗，限制每家公司默认 3 个 URL。
- [ ] 重跑测试并确认通过。

### 任务 2：消除重复导航并限制递归

**文件：**
- 修改：`scripts/company-browser-discovery.mjs`
- 测试：`tests/company-browser-discovery.test.mjs`

- [ ] 写入测试：搜索候选页只访问一次。
- [ ] 写入测试：默认站内入口最多检查 5 页、深度不超过 2。
- [ ] 运行测试确认失败。
- [ ] 将首次导航结果直接转为页面观察，取消第二次 `goto`。
- [ ] 增加 `maxCareerEntries` 和 `maxDepth` 参数，默认 5/2。
- [ ] 重跑测试确认通过。

### 任务 3：本地可恢复 Worker

**文件：**
- 创建：`scripts/local-browser-queue-worker.mjs`
- 修改：`package.json`
- 测试：`tests/local-browser-queue-worker.test.mjs`

- [ ] 写入测试：Worker 优先消费 Chrome 观察文件、逐家公司调用 ingest，并跳过已成功 checkpoint。
- [ ] 写入测试：Chrome 为空时只有显式启用才调用百度 API 补充。
- [ ] 运行测试确认入口尚不存在而失败。
- [ ] 实现输入规范化、观察文件读取、公司级 checkpoint 和失败隔离。
- [ ] 添加 `discover:local-worker` npm 命令。
- [ ] 重跑测试确认通过。

### 任务 4：回归与真实验证

**文件：**
- 验证：`tests/company-browser-discovery.test.mjs`
- 验证：`tests/local-browser-queue-worker.test.mjs`
- 验证：完整测试套件

- [ ] 运行定向测试。
- [ ] 运行 `npm.cmd test`，确认全部测试通过。
- [ ] 使用隔离 SQLite 对 1–3 家公司做真实 Chrome 观察导入烟测。
- [ ] 检查报告明确区分搜索成功、候选发现、官网验证、岗位抽取和失败。
- [ ] 检查 Git diff，仅包含本地 Worker、测试和文档，不修改 Provider Contract、Domain Model、数据库 Schema 或 Verification Engine。

