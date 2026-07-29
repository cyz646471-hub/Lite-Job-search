# LJS Development Record

## 当前系统状态摘要

- 日期：2026-07-27
- 版本：`0.1.0`
- 分支：`codex/natural-language-search-instruction`
- 基线 commit：`4aab9a8619a23883dfd1f29dc0347fd468b607b5`
- 未提交改动：基线检查时有 26 个已跟踪文件发生修改，并存在多个未跟踪实现；这些改动包含此前的浏览器发现、验证、岗位抽取与文档工作，本轮不覆盖、不清理、不整体提交。
- 当前生产入口：`npm.cmd run discover:instruction`、`npm.cmd run discover:persistent-supervisor`、`npm.cmd run task:run`、`npm.cmd run web`
- 数据库版本：迁移文件截至 `007-local-control-plane.sql`
- Worker 架构：持久化 Browser Supervisor 持有专用 Playwright Profile；SQLite 记录 Worker heartbeat、协作停止、批次断点、Profile lock 和任务状态。
- 百度策略：仅作为本地知识、官网直连、ATS 和缓存均不足后的最后搜索手段；安全验证时只延后百度队列，本地队列继续；人工确认后由唯一 `HALF_OPEN` 探针恢复。
- Sandbox 状态：真实 Windows Chrome CommandLine 已观测且未发现项目禁止参数；`chromiumSandbox: true` 仍只能证明请求，操作系统级状态为 `NOT_OS_VERIFIED`。
- 最近全量测试：2026-07-27 执行 `npm.cmd test`，329/329 通过，0 失败。
- 已知阻塞：20 公司真实 Canary 提取岗位为 0；部分企业域名过期或不可解析；百度真实查询触发 CAPTCHA，需要人工处理；控制面任务需要独立 Runner 执行，不在 HTTP 请求中启动 Chrome。
- 下一阶段优先级：优先提高动态招聘页和 ATS 的岗位抽取成功率，并修订企业域名知识；在此之前不扩大无人值守数据生产规模。

## Baseline Audit 2026-07-27

### 架构审计

当前代码已经具备 Company、CareerPortal、RecruitmentEvent、JobOpening、DiscoveryLog、确定性 Verification Engine、SQLite 幂等写入和学生 XLSX 投影。浏览器生产入口使用 `launchPersistentContext`，但 Web、Worker 运行状态和人工恢复控制面尚不存在。

现有 `006-browser-resilience.sql` 只为 `batch_items` 增加重试字段，并建立基础 `provider_circuit_states`。它没有附件规格要求的完整 `HALF_OPEN` 租约、人工确认、并发版本和 Worker heartbeat 数据，因此后续应扩展现有表或新增不重复职责的运行状态表。

### Chrome 启动审计

生产 Persistent Worker 当前没有使用 `--no-sandbox`、`--disable-setuid-sandbox`、`--disable-gpu-sandbox`、`--disable-web-security` 或 `--ignore-certificate-errors`。项目中另有若干 `engine/upstream` Playwright 启动入口，但审计未发现上述危险参数。此前仅检查配置对象，缺少统一的启动前拒绝策略和真实 Windows Chrome CommandLine 诊断。

### Git 基线

- `git status --short`：工作区较脏，包含已有修改和未跟踪文件。
- `git diff --stat`：基线为 26 个已跟踪文件，约 940 行新增、80 行删除。
- `git diff --cached --stat`：无暂存修改。
- 本轮禁止 reset、clean、自动 stash、覆盖 checkout 或批量提交。

## Iteration 2026-07-27-01：Chrome 启动安全基线

### 1. 本次目标

完成 Phase 0 基线审计和 Phase 1 的最小安全闭环：所有生产 Persistent Chrome 启动在调用 Playwright 前统一拒绝危险参数，并提供可核对真实 Windows Chrome 进程命令行的诊断能力。

### 2. 改造前状态

生产 Adapter 已请求 `chromiumSandbox: true`，但参数在调用点内直接构造，没有统一安全策略。测试只扫描一个 Adapter 文件。诊断脚本只记录页面暴露的环境字段，不记录 Chrome PID、可执行文件和真实 CommandLine。

### 3. 架构决策

新增无状态的 `chrome-launch-policy`，由调用方在启动前同步校验；危险参数导致明确的 `BROWSER_UNSAFE_ARGUMENTS` 错误。Windows 进程诊断独立于启动策略，通过 CIM 读取 Chrome 进程，再按专用 Profile 路径筛选。

未修改浏览器指纹、User-Agent、`navigator.webdriver`、语言、时区或屏幕属性。未在本轮提前引入 Worker schema 或 Web 框架。

### 4. 用户可感知变化

生产 Worker 如果收到危险 Chrome 参数会拒绝启动。受控诊断报告可显示 Worker PID、Chrome PID、可执行文件、真实 CommandLine，以及是否发现危险参数。

### 5. 代码变化

| 文件 | 修改内容 | 修改原因 | 是否影响兼容性 |
|---|---|---|---|
| `src/runtime/chrome-launch-policy.mjs` | 新增统一危险参数拒绝和安全 Persistent 配置 | 防止调用点绕过 Sandbox 约束 | 仅危险参数调用会被拒绝 |
| `src/runtime/chrome-process-diagnostics.mjs` | 新增 Windows CIM Chrome 进程诊断 | 验证真实启动命令行 | 非 Windows 返回不支持 |
| `scripts/chrome-extension-browser-adapter.mjs` | 使用统一安全配置构造 Persistent Context | 生产入口统一校验 | 正常参数兼容 |
| `scripts/diagnose-browser-search-challenge.mjs` | 使用安全参数校验并写入实际 Profile 路径和真实进程诊断 | 提供可审计证据 | 诊断输出增加字段 |
| `scripts/run-persistent-browser-supervisor.mjs` | 区分 Sandbox 已请求与操作系统级已验证 | 禁止把配置请求误报成真实验证 | 诊断字段语义收紧 |
| `tests/browser-sandbox-safety.test.mjs` | 增加统一策略和真实报告语义回归测试 | 防止误报 Sandbox 状态 | 无 |
| `tests/chrome-launch-policy.test.mjs` | 新增危险参数和安全默认值测试 | 防止安全策略回归 | 无 |
| `tests/chrome-process-diagnostics.test.mjs` | 新增进程筛选和危险参数识别测试 | 验证诊断逻辑 | 无 |
| `tests/company-browser-discovery.test.mjs` | 更新 Persistent Context 参数断言 | 对齐统一安全配置 | 无 |
| `docs/LJS_DEVELOPMENT_RECORD.md` | 创建真实基线和迭代记录 | 建立持续审计入口 | 无 |

### 6. 数据库变化

无数据库变化。本轮没有新增 migration，不需要数据库备份或迁移回滚。

### 7. 配置与运行方式变化

没有新增环境变量或 npm script。生产 Profile 默认路径仍为 `data/browser-profiles/career-op-main`。Persistent Chrome 参数现在固定包含 `channel: chrome`、`headless: false`、`chromiumSandbox: true`、`viewport: null` 和通过校验的 `args`。

### 8. 测试和验证

- 首次定向测试：49 项中 48 项通过、1 项失败。失败原因是安全配置抽取到统一模块后，旧测试仍在 Adapter 源码中搜索 `chromiumSandbox: true` 字面量；实现未失败。
- 修正测试后再次执行定向测试：49/49 通过。
- 收紧 Sandbox 报告语义后首次执行 50 项定向测试：49 项通过、1 项失败。失败原因为新增源码断言没有覆盖条件表达式；修正测试断言后 50/50 通过。
- 更正说明：补齐全生产入口危险参数扫描和实际 Profile 路径断言后，最终定向测试为 51/51 通过。
- `npm.cmd test`：308/308 通过，0 失败，总耗时约 27.2 秒。
- 生产源码危险参数扫描：除统一拒绝策略声明外，没有发现生产路径使用五个禁止参数。
- 未执行真实百度查询。
- 未执行真实浏览器 Sandbox Canary，因此没有把配置契约测试描述为操作系统级 Sandbox 验证。

### 9. 风险和已知问题

- `chromiumSandbox: true` 只能证明 Playwright 收到启动请求，不能单独证明操作系统级 Sandbox 已完整生效。
- CIM 诊断目前仅支持 Windows。
- 旧的非 Persistent `engine/upstream` 浏览器入口未统一改造，只完成扫描确认没有已知危险参数。
- Phase 2 至 Phase 5 尚未实现。

### 10. 回滚方案

如需回滚本轮，恢复 `scripts/chrome-extension-browser-adapter.mjs`、`scripts/diagnose-browser-search-challenge.mjs`、`scripts/run-persistent-browser-supervisor.mjs`、`tests/browser-sandbox-safety.test.mjs` 和 `tests/company-browser-discovery.test.mjs` 的本轮差异，并删除本轮新增的两个 runtime 模块和两个测试文件。没有 migration 和数据写入，不会丢失 SQLite 数据。回滚后重新执行 `npm.cmd test`。

### 11. Git 检查点

- 修改前基线 commit：`4aab9a8619a23883dfd1f29dc0347fd468b607b5`
- 本轮 commit：未创建；现有未提交修改与本轮修改存在文件级重叠，不能伪造干净 commit。
- 分支：`codex/natural-language-search-instruction`
- 存在未提交变更：是
- patch snapshot：`patches/2026-07-27-phase0-1/`
- patch 范围：本轮修改的已跟踪文件保存在 `tracked-changes.patch`；本轮新增文件和本轮前已存在但未跟踪的诊断脚本、Supervisor、安全测试分别保存为独立 no-index patch。
- 恢复方式：在相同基线工作区逐个运行 `git apply --check <patch>`，确认后再运行 `git apply <patch>`。由于诊断脚本在本轮前已是未跟踪文件，其 snapshot 表示本轮结束时的完整文件，不能证明文件全部内容均由本轮创建。

### 12. 下一步

Phase 0、Phase 1 测试和 patch snapshot 已完成。下一轮从现有 `006` 迁移向后兼容扩展 Worker 状态、Profile lock owner 和百度 `HALF_OPEN` 探针租约；本轮不提前宣称这些能力已完成。

## Iteration 2026-07-27-02：Phase 2–6 本地优先生产闭环

### 1. 本次目标

在不重写 Provider、Domain Model 或既有 CLI 行为的前提下，完成持久化
Worker/Profile 生命周期、百度队列隔离与人工恢复、本地优先发现、最小本地
控制面，以及自动化测试和 1/5/20 公司真实 Canary。

### 2. 改造前状态

Supervisor 可以持有 Persistent Chrome 和批次断点，但缺少 Worker heartbeat、
可靠 Profile owner、协作停止和 SQLite 控制任务。百度阻断会影响整个批次，
已知官网、ATS、缓存和本地历史没有形成统一优先级；也没有独立 Web 状态面或
结构化任务 Runner。

### 3. 架构决策

1. Profile 锁使用文件和 SQLite 双重记录，owner 由 host、PID、进程启动令牌、
   instance、batch 和随机 lock id 共同标识；只有确认旧 owner 已死亡且 Chrome
   未占用 Profile 才允许审计后接管。
2. 队列拆为 `LOCAL_OR_DIRECT_VERIFICATION` 与
   `BAIDU_DISCOVERY_REQUIRED`。百度 CAPTCHA、429、异常流量或访问拒绝只打开
   百度断路器并延后百度项。
3. 百度断路器使用 `CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN`，人工确认不直接
   关闭断路器；SQLite 租约保证同一时刻只有一个探针。
4. Discovery Planner 固定采用：已验证 Portal → 官方域名 → 历史知识 → ATS
   tenant → 可复用成功缓存 →公开线索 →常见招聘路径 →百度 →人工。挑战与瞬时
   错误缓存禁止当作成功空结果复用。
5. 本地验证链采用 Direct HTTP → ATS Adapter →仅动态壳页面使用 Playwright；
   遍历预算不足必须记录为 deferred evidence。
6. Web 只操作 SQLite，不持有 Chrome。结构化任务由 `task:run` 读取企业名录后
   分批调用 Supervisor；任务目标只统计本任务批次，不能借用全库历史数据达标。

### 4. 用户可感知变化

- 可查看任务、批次、Worker、百度断路器、延后项和数据库统计。
- 可按批次协作停止/恢复，并在完成人工验证码后确认百度状态。
- 可创建结构化岗位发现任务，并由独立 Runner 执行。
- 可下载学生投递 XLSX；没有岗位时生成合法空表，不伪造岗位。
- 百度受阻时，已有官网或 ATS 的本地核验仍继续。

### 5. 主要代码变化

| 范围 | 主要文件 | 变化 |
|---|---|---|
| Worker/Profile | `src/runtime/process-identity.mjs`、`src/runtime/profile-lock-manager.mjs`、`scripts/run-persistent-browser-supervisor.mjs` | owner 身份、heartbeat、协作停止、安全接管、懒启动 Chrome |
| 百度韧性 | `src/application/browser-search-circuit-breaker.mjs`、`src/application/run-browser-company-batch.mjs`、`src/application/run-discovery-batch.mjs` | 双队列、OPEN/HALF_OPEN、唯一探针租约、延后原因 |
| 本地优先 | `src/application/local-first-discovery-planner.mjs`、`src/application/discover-company-locally.mjs`、`src/application/execute-verification-task.mjs` | 知识/域名/ATS/缓存/公共路径/百度优先级及 Direct→ATS→Browser |
| 存储 | `src/storage/migrations/007-local-control-plane.sql`、`src/storage/sqlite-job-repository.mjs` | Worker、Profile、知识、缓存、任务、审计和断路器字段 |
| 控制面 | `src/application/control-plane-service.mjs`、`src/web/control-plane-server.mjs`、`scripts/run-local-control-plane.mjs`、`scripts/ljs-control.mjs` | 本地 Web/CLI 状态与写操作确认 |
| 任务 Runner | `scripts/run-control-task.mjs` | 企业选择、短批次执行、任务内进度和失败状态 |
| 诊断 | `scripts/diagnose-browser-search-challenge.mjs`、`src/runtime/chrome-process-diagnostics.mjs` | Profile lock、真实 Windows Chrome 进程树和命令行 |
| 文档 | `docs/local-control-plane.md`、`README.md`、`.agents/skills/lite-job-search/SKILL.md` | 运行方式、人工恢复和技能固定流程 |
| 测试 | `tests/profile-lock-manager.test.mjs` 等 Phase 2–6 测试 | 生命周期、并发租约、队列隔离、缓存、Web、任务口径 |

### 6. 数据库变化

新增 migration `007-local-control-plane.sql`：

- `batch_runs`：`stop_requested_at`、`resumed_at`
- `batch_items`：`queue_type`、`defer_reason`
- `provider_circuit_states`：打开原因、人工确认、探针 owner/lease、失败计数和版本
- 新表：`worker_instances`、`profile_locks`、`company_web_knowledge`、
  `search_cache`、`control_tasks`、`audit_logs`

迁移将旧 `PROBE_REQUIRED` 状态转换为 `OPEN`，不删除既有数据。SQLite 迁移不做
自动降级；回滚前必须备份数据库，代码回滚时应恢复备份，而不是直接删除新增列。

### 7. 配置与运行方式

```powershell
# 本地控制面
npm.cmd run web -- --database data/lite-job-search.sqlite --port 4317 `
  --xlsx outputs/student-applications.xlsx

# 执行控制面创建的任务
npm.cmd run task:run -- --task <task-id> `
  --registry data/company-registry/golden-seed-companies-current.json `
  --database data/lite-job-search.sqlite --output-dir outputs/<task-id> `
  --profile-dir data/browser-profiles/career-op-main `
  --max-companies-per-run 10

# 状态、协作停止和恢复
npm.cmd run control -- status --database data/lite-job-search.sqlite
npm.cmd run control -- stop --batch <batch-id> `
  --database data/lite-job-search.sqlite --confirm
npm.cmd run control -- resume --batch <batch-id> `
  --database data/lite-job-search.sqlite --confirm
```

Web 写操作需 `X-LJS-Confirm: yes` 或 JSON `confirm: true`，并写 `audit_logs`。

### 8. 测试与 Canary

- Phase 2–6 专项任务桥接测试：14/14 通过。
- 1 公司真实本地 Canary：1 成功、0 失败；7 个候选，0 VERIFIED，0 岗位；
  `01.ai` 超时被保留为失败证据。
- 5 公司真实本地 Canary：4 成功、1 失败；18 个候选，4 VERIFIED，0 岗位；
  `360shuoke.com` 为 `ENOTFOUND`。
- 20 公司真实本地 Canary：7 成功、13 失败；79 个候选 URL；81 次验证中
  28 VERIFIED、6 pending、47 rejected、6 blocked；0 个岗位。官网验证率
  34.57%，岗位抽取成功率 0%，重复率 8.14%，平均置信度 37.47。
- Web smoke：读取真实 Canary SQLite；批次状态、Worker 状态可读；XLSX 下载
  HTTP 200，文件 4054 bytes。
- Task Runner 无网络烟测：真实创建 SQLite task 和 batch，以
  `NEW_COMPANIES_ONLY` 处理已入库同域名公司；CLI 返回
  `PARTIAL / NO_ELIGIBLE_COMPANIES / selected=0`，数据库任务状态同步为
  `PARTIAL`，没有启动 Chrome 或访问网络。首次烟测因测试 Company 缺少强制 id
  在 Domain Model 处失败，补齐夹具后通过。
- 百度真实诊断：首次诊断结果页可访问；第二次查询触发百度安全验证，记录
  `captcha_count=1` 后停止，没有刷新、重试、切换引擎或绕过。
- Chrome 非搜索诊断：CIM 状态 `OBSERVED`，观测到 26 个 Chrome 进程，
  25 个有 CommandLine，未发现项目禁止参数；`navigator.webdriver=true`，
  未做 stealth；系统级 Sandbox 仍为 `NOT_OS_VERIFIED`。
- 最终新增入口逐文件执行 `node --check`，全部通过。
- 最终 `npm.cmd test`：329/329 通过，0 失败，总耗时约 32.9 秒。
- 最终 `git diff --check`：通过；仅输出 Windows 工作树未来可能进行
  LF→CRLF 转换的警告，没有空白错误。

### 9. 风险和已知问题

- 本轮 20 公司 Canary 的岗位抽取为 0，说明“发现/验证”可运行，但真实岗位生产
  质量尚未达标；不能把 28 个 VERIFIED Portal 描述为岗位采集成功。
- 多数失败来自企业名录缺少/过期官方域名、域名不可解析、首页超时或动态页面；
  下一轮应先修企业域名知识和动态 ATS Adapter。
- 百度会触发 CAPTCHA，现行机制只能安全暂停并等待人工完成验证。
- 运行控制任务仍需启动独立 `task:run` 进程；Web 当前不是常驻调度服务。
- `chromiumSandbox: true` 和“没有禁止参数”不等同于操作系统级 Sandbox 已验证。

### 10. 回滚方案

1. 停止目标 batch，等待 Worker 在公司边界退出。
2. 备份当前 SQLite 和输出目录。
3. 将代码恢复到 Phase 0–1 snapshot 或基线 commit，并使用 migration 007 前的
   数据库备份；不要对已迁移数据库直接删列。
4. 删除专用自动化 Profile 前先确认没有 Chrome 进程占用；Profile 内容不应进入 Git。
5. 重新执行全量测试和一个不访问搜索引擎的本地 Canary。

### 11. Git 检查点

- 修改前基线 commit：`4aab9a8619a23883dfd1f29dc0347fd468b607b5`
- 分支：`codex/natural-language-search-instruction`
- 本轮 commit：未创建。工作树在本轮前已有大量用户和既有实现变更，且与本轮
  文件重叠；整体提交会混入无法安全归属的内容。
- Phase 2–6 patch snapshot：见 `patches/2026-07-27-phase2-6/`。

### 12. 下一步

先用 5–10 家已知动态招聘站建立 Adapter 回归样本，目标是把“VERIFIED Portal
有岗位”的抽取率从 0 提升到可量化的非零结果；同时修订错误域名知识。达到该
门槛后再运行 50/100 公司批次，并继续保留百度人工恢复边界。
