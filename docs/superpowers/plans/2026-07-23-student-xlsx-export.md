# 学生投递 XLSX 自动导出实现计划

> **面向 AI 代理的工作者：** 使用 `superpowers-zh:executing-plans` 在当前会话逐项执行；步骤使用复选框跟踪。

**目标：** 让中国与北美的 `batch`、`verify` 和显式 `export --format xlsx` 生成可直接用于学生投递的、带原生超链接的 XLSX。

**架构：** 新建专门的学生视图模块以选择最深投递链接并创建工作簿。CLI 在既有 JSON/JSONL/CSV 输出成功后生成同名 `.student.xlsx`；显式 XLSX 导出直接调用工作簿模块。工作簿使用 Codex Desktop 随附的 `@oai/artifact-tool` 创建，现有机器可读输出保持不变。

**技术栈：** Node.js ESM、Node 内置测试运行器、`@oai/artifact-tool`。

---

## 文件结构

- 新建 `src/cli/student-workbook.mjs`：学生字段映射、入口 URL 优先级、状态文本和 XLSX 写入。
- 修改 `src/cli/main.mjs`：为 `batch`、`verify` 和 `export` 接入工作簿。
- 修改 `src/cli/io.mjs`：阻止 XLSX 进入文本序列化路径。
- 修改 `tests/cli.test.mjs`：覆盖自动副产物、显式 XLSX、链接优先级与 CN/NA 输入。
- 修改 `README.md`、`.agents/skills/lite-job-search/SKILL.md`：说明固定流程和运行时要求。

## 任务 1：定义学生视图映射

**文件：** `src/cli/student-workbook.mjs`、`tests/cli.test.mjs`

- [ ] **步骤 1：写失败测试。** 覆盖 `toStudentRow()`：传入同时含 `applyUrl`、`jobDetailUrl`、来源 URL 和内部证据的记录，断言只输出公司、市场、招聘批次或岗位、地点、日期、岗位方向、投递 URL、状态八个字段，且 URL 为 `applyUrl`。
- [ ] **步骤 2：运行失败测试。** 运行 `npm.cmd test -- --test-name-pattern "student row prefers"`；预期模块或函数不存在。
- [ ] **步骤 3：实现最小映射。** 定义 URL 顺序 `applyUrl → jobDetailUrl → jobListUrl → campaignLandingUrl → companyCareerHomeUrl`；日期选择 `campaignStartAt → publishedAt → postedAt`；仅 `applicationActive === true` 显示“在招”，false 显示“已关闭”，否则显示“待确认”。
- [ ] **步骤 4：运行测试确认通过。** 再次运行同一测试，预期通过。
- [ ] **步骤 5：提交。** `git add src/cli/student-workbook.mjs tests/cli.test.mjs`，然后 `git commit -m "feat: map job records to student workbook rows"`。

## 任务 2：创建带超链接的工作簿

**文件：** `src/cli/student-workbook.mjs`、`tests/cli.test.mjs`

- [ ] **步骤 1：写失败测试。** 覆盖 `writeStudentWorkbook(output, records)`：用一条 NA 记录写入临时 XLSX，并断言输出文件存在；另用一条 CN 记录确认市场文本和岗位方向可写入。
- [ ] **步骤 2：运行失败测试。** 运行 `npm.cmd test -- --test-name-pattern "student workbook exports"`；预期函数不存在。
- [ ] **步骤 3：实现工作簿。** 使用 `Workbook.create()`、`SpreadsheetFile.exportXlsx()` 创建“投递清单”表，写入八列标题和数据，冻结标题行、关闭网格线、启用筛选、使用 `yyyy-mm-dd` 日期格式、限制列宽并打开自动换行。入口单元格显示“查看职位并投递”，设置原生外部超链接；无 URL 时留空。
- [ ] **步骤 4：运行结构与视觉验证。** 使用 `workbook.inspect` 检查 `投递清单!A1:H4`，扫描 `#REF!|#DIV/0!|#VALUE!|#NAME? |#N/A`，并渲染 `A1:H12`；预期表头无截断、无公式错误、入口列可读。
- [ ] **步骤 5：提交。** `git add src/cli/student-workbook.mjs tests/cli.test.mjs`，然后 `git commit -m "feat: export student application workbook"`。

## 任务 3：接入所有 CLI 输出流程

**文件：** `src/cli/main.mjs`、`src/cli/io.mjs`、`tests/cli.test.mjs`

- [ ] **步骤 1：写失败测试。** 为 `batch --output candidates.json` 和 `verify --output verified.json` 添加断言：产生 `candidates.student.xlsx` 或 `verified.student.xlsx`；测试输入同时含 CN 与 NA 记录。
- [ ] **步骤 2：运行失败测试。** 运行 `npm.cmd test -- --test-name-pattern "create sibling student workbooks"`；预期副产物不存在。
- [ ] **步骤 3：补充报告输入兼容测试。** 向 `readRecords()` 输入 `{ companies: [...] }` 形式的中国招聘报告，断言返回该数组而不是包含包装对象的一行；运行对应测试并确认它先失败。
- [ ] **步骤 4：实现自动副产物和报告读取。** 在 `batch`、`verify` 的 `options.output` 成功分支调用 `writeStudentWorkbook`，通过 `path.parse(options.output)` 命名为 `<name>.student.xlsx`，并在 JSON 响应中返回 `studentWorkbook` 路径。让 `readRecords()` 识别 `companies` 数组。对于 `export --format xlsx`，直接写入指定路径并绕过 `writeRecords`。
- [ ] **步骤 5：运行 CLI 回归。** 运行 `npm.cmd test -- --test-name-pattern "student|verify and export"`；预期普通 CSV、JSON、JSONL 行为不变，且 100 公司报告包装对象可直接导出。
- [ ] **步骤 6：提交。** `git add src/cli/main.mjs src/cli/io.mjs tests/cli.test.mjs`，然后 `git commit -m "feat: generate student workbook with cli outputs"`。

## 任务 4：文档与真实数据验收

**文件：** `README.md`、`.agents/skills/lite-job-search/SKILL.md`、`output/cn-recruitment-100-2026-07-23.json`

- [ ] **步骤 1：更新文档。** 说明 `batch`、`verify` 的自动 XLSX 副产物、显式 `export --format xlsx`、八个学生字段、链接优先级及审计字段不会进入学生表。
- [ ] **步骤 2：导出真实数据。** 运行 `node bin/lite-job-search.mjs export --input output/cn-recruitment-100-2026-07-23.json --output outputs/student-applications.xlsx --format xlsx --json`；预期 100 行并且没有来源证据列。
- [ ] **步骤 3：完整验证。** 运行 `npm.cmd test`，并对真实工作簿重复结构、公式错误和视觉渲染检查；预期全部通过。
- [ ] **步骤 4：提交。** `git add README.md .agents/skills/lite-job-search/SKILL.md`，然后 `git commit -m "docs: document automatic student workbook exports"`。
