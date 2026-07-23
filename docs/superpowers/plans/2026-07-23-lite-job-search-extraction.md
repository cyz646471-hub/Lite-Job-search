# Lite Job Search 拆分实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 从 Career OP 无损抽取中国与北美岗位检索能力，交付独立 CLI、Node API 和 Agent Skill，并发布为 GitHub 仓库 `Lite-Job-search`。

**架构：** 使用 `src/` 稳定外壳统一跨市场契约，`engine/` 保存经依赖闭包抽取的 Career OP 检索实现，Skill 只调用稳定 CLI。通过来源清单和契约回归测试控制后续同步风险。

**技术栈：** Node.js 20+、ESM、Node test runner、Playwright（可选浏览器降级）、dotenv、js-yaml、tldts。

---

### 任务 1：建立仓库骨架与抽取清单

**文件：**
- 创建：`package.json`
- 创建：`.gitignore`
- 创建：`.env.example`
- 创建：`LICENSE`
- 创建：`NOTICE.md`
- 创建：`config/extraction-manifest.json`
- 测试：`tests/extraction-manifest.test.mjs`

- [ ] 编写失败测试，要求清单覆盖 CN、NA、共享 provider、页面 provider 和 CLI 入口，且禁止简历、申请追踪、面试与薪资模块。
- [ ] 运行 `npm.cmd test -- tests/extraction-manifest.test.mjs`，确认因清单缺失而失败。
- [ ] 创建最小清单与包配置，使测试通过。
- [ ] 运行同一测试并确认通过。

### 任务 2：实现可重复的依赖闭包抽取

**文件：**
- 创建：`scripts/sync-from-career-ops.mjs`
- 创建：`src/extraction/import-graph.mjs`
- 测试：`tests/import-graph.test.mjs`

- [ ] 编写失败测试，覆盖相对 import 解析、传递依赖、越界拒绝和排除规则。
- [ ] 运行目标测试并确认因函数缺失而失败。
- [ ] 实现 `buildImportClosure()` 和只读源目录校验。
- [ ] 运行目标测试确认通过。
- [ ] 对 `C:\Users\陈逸之\Documents\工作流\career-ops` 执行同步，生成 `engine/manifest.json`。

### 任务 3：定义跨市场公共契约

**文件：**
- 创建：`src/core/contracts.mjs`
- 创建：`src/core/normalize.mjs`
- 创建：`src/core/dedupe.mjs`
- 创建：`src/index.mjs`
- 测试：`tests/contracts.test.mjs`
- 测试：`tests/dedupe.test.mjs`

- [ ] 编写失败测试，覆盖 URL 角色分离、CN/NA 区域隔离、稳定键和来源合并。
- [ ] 运行目标测试确认失败。
- [ ] 实现最小标准化与去重逻辑。
- [ ] 运行目标测试及区域隔离测试确认通过。

### 任务 4：统一搜索服务、缓存和预算

**文件：**
- 创建：`src/search/providers.mjs`
- 创建：`src/search/router.mjs`
- 创建：`src/runtime/cache.mjs`
- 创建：`src/runtime/budget.mjs`
- 创建：`src/runtime/config.mjs`
- 测试：`tests/search-router.test.mjs`
- 测试：`tests/cache-budget.test.mjs`

- [ ] 编写失败测试，覆盖 `no_provider`、`single_provider`、`primary_fallback`、失败切换、TTL 和预算 deferred。
- [ ] 运行测试确认失败。
- [ ] 将 Career OP provider 适配到统一 `search(request)` 协议，日志输出脱敏状态。
- [ ] 运行测试确认通过。

### 任务 5：实现中国与北美工作流适配器

**文件：**
- 创建：`src/markets/cn.mjs`
- 创建：`src/markets/na.mjs`
- 创建：`src/pipeline/search-company.mjs`
- 创建：`src/pipeline/search-batch.mjs`
- 创建：`src/pipeline/verify-candidates.mjs`
- 测试：`tests/cn-workflow.test.mjs`
- 测试：`tests/na-workflow.test.mjs`
- 测试：`tests/engine-parity.test.mjs`

- [ ] 编写失败测试，用离线夹具验证中国官网候选与 ATS 下钻、北美 ATS 职位发现及功能等价结果。
- [ ] 运行测试确认失败。
- [ ] 实现市场适配器，复用 `engine/` 中的原有检索函数。
- [ ] 运行目标测试确认通过。

### 任务 6：实现独立 CLI 与输出

**文件：**
- 创建：`bin/lite-job-search.mjs`
- 创建：`src/cli/doctor.mjs`
- 创建：`src/cli/io.mjs`
- 创建：`src/cli/main.mjs`
- 测试：`tests/cli.test.mjs`

- [ ] 编写失败测试，覆盖 `doctor`、单公司 `search`、`batch`、`verify` 和 `export`。
- [ ] 运行测试确认失败。
- [ ] 实现命令、参数校验、JSON/JSONL/CSV 输出和非零错误码。
- [ ] 从仓库外工作目录运行 CLI 测试并确认通过。

### 任务 7：创建完整 Agent Skill

**文件：**
- 创建：`.agents/skills/lite-job-search/SKILL.md`
- 创建：`.agents/skills/lite-job-search/agents/openai.yaml`
- 创建：`.agents/skills/lite-job-search/references/china-market.md`
- 创建：`.agents/skills/lite-job-search/references/north-america-market.md`
- 创建：`.agents/skills/lite-job-search/references/data-contract.md`
- 创建：`.agents/skills/lite-job-search/scripts/run-search.ps1`
- 创建：`scripts/install-skill.ps1`
- 测试：`tests/skill-package.test.mjs`

- [ ] 使用 `init_skill.py` 初始化 skill 骨架。
- [ ] 编写失败测试，检查 frontmatter、CLI 引用、区域说明、安全边界和引用文件。
- [ ] 完成 Skill 与简洁参考文档。
- [ ] 运行 `quick_validate.py` 与 Skill 测试并确认通过。

### 任务 8：文档、兼容性与发布

**文件：**
- 创建：`README.md`
- 创建：`docs/architecture.md`
- 创建：`docs/migration-from-career-ops.md`
- 修改：`C:\Users\陈逸之\Documents\工作流\career-ops\docs\LITE_JOB_SEARCH_EXTRACTION.md`

- [ ] 编写 README，分别给出模型调用、CLI、Node API、CN 和 NA 示例。
- [ ] 在 Career OP 中记录职责边界与兼容策略，不删除现有检索文件。
- [ ] 运行 `npm.cmd test`、`npm.cmd run doctor -- --json`、Skill 校验、秘密扫描和仓库外 smoke test。
- [ ] 检查 Git 状态、暂存内容、大文件、缓存、密钥和许可证。
- [ ] 初始化 Git 仓库，创建 `main` 提交。
- [ ] 使用已认证 GitHub 账号创建并推送 `Lite-Job-search` 独立仓库。

