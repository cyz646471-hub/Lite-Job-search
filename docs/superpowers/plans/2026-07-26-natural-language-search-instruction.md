# 自然语言招聘检索指令实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:executing-plans 在当前隔离工作树中逐项实施，步骤使用复选框跟踪进度。

**目标：** 将中文招聘检索指令确定性编译为现有本地浏览器 Worker 的完整参数，并自动选择 SQLite 未收录公司、断点执行和输出 XLSX。

**架构：** 新增纯函数指令编译器和公司选择器，由新的组合 CLI 写任务清单并启动既有 Worker。核心验证、Provider、Domain Model、SQLite Schema 与原 CLI 保持不变。

**技术栈：** Node.js 20+、ESM、node:test、better-sqlite3、现有 Lite-Job-search Worker。

---

### 任务 1：实现确定性指令编译

**文件：**
- 创建：`tests/search-instruction.test.mjs`
- 创建：`src/application/compile-search-instruction.mjs`

- [ ] 编写测试，断言“检索近90天内中国，开放产品经理方向岗位公司100个”生成 `CN`、`产品经理`、90 天和 100 家。
- [ ] 测试天、周、月表达、NA 市场以及缺失必填字段的明确错误。
- [ ] 运行 `node --test tests/search-instruction.test.mjs`，确认因模块缺失失败。
- [ ] 实现最小确定性解析器和稳定 batch-id。
- [ ] 重跑测试并确认全部通过。

### 任务 2：实现本地名单解析与 SQLite 去重

**文件：**
- 创建：`tests/task-company-resolver.test.mjs`
- 创建：`src/application/resolve-task-companies.mjs`

- [ ] 编写测试，覆盖数组、`companies`、`rawCompanies` 和 Golden Dataset 字段。
- [ ] 编写测试，覆盖名称、Alias、双语名称和官方域名与 SQLite 已知公司去重。
- [ ] 编写测试，断言本地不足时返回明确缺口和补充状态。
- [ ] 运行测试并确认因实现缺失失败。
- [ ] 实现标准化、稳定去重和目标数量选择。
- [ ] 重跑测试并确认全部通过。

### 任务 3：增加组合 CLI 和固定指导文档

**文件：**
- 创建：`tests/search-instruction-cli.test.mjs`
- 创建：`scripts/run-search-instruction.mjs`
- 创建：`docs/search-instruction-template.md`
- 修改：`package.json`
- 修改：`README.md`

- [ ] 编写 CLI `--plan-only` 集成测试，使用临时 registry 和 SQLite，断言生成任务清单且排除已知公司。
- [ ] 运行测试并确认 CLI 或 npm script 尚不存在。
- [ ] 实现参数解析、任务文件写入、可插拔补充模块与 Worker 子进程循环。
- [ ] 将固定执行约束写入指导文档并增加 README 用法。
- [ ] 重跑 CLI 测试并确认通过。

### 任务 4：验证并执行一次真实指令

**文件：**
- 生成但不提交：`test-output/instruction-cn-product-manager-100-*`
- 生成但不提交：SQLite 和 XLSX

- [ ] 运行 `npm.cmd run test:local-worker`。
- [ ] 运行 `npm.cmd test`。
- [ ] 运行 `git diff --check` 并检查受保护 Provider 路径零变化。
- [ ] 执行“检索近90天内中国，开放产品经理方向岗位公司100个”。
- [ ] 如百度阻断，保存 `BLOCKED/DEFERRED`、SQLite、任务清单和报告，不伪造成功。
- [ ] 检查输出文件和 SQLite 完整性，报告真实结果。

