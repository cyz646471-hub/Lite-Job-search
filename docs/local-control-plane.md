# LJS 本地控制面

本地控制面只负责结构化任务、SQLite 状态、人工确认、协作停止和结果下载。
它不导入 Playwright，也不持有 Chrome 生命周期。

## 启动

```powershell
npm.cmd run web -- `
  --database data/lite-job-search.sqlite `
  --port 4317 `
  --xlsx outputs/student-applications.xlsx
```

打开 `http://127.0.0.1:4317`。默认仅监听回环地址。

Web 创建任务后，由独立任务 Runner 读取本地企业名录并分批调用持久化
Supervisor。控制面不会在 HTTP 请求中直接启动 Chrome：

```powershell
npm.cmd run task:run -- `
  --task <task-id> `
  --registry data/company-registry/golden-seed-companies-current.json `
  --database data/lite-job-search.sqlite `
  --output-dir outputs/<task-id> `
  --profile-dir data/browser-profiles/career-op-main `
  --max-companies-per-run 10
```

任务进度只统计该任务批次中实际物化的公司；不会用数据库中的历史门户或
历史岗位冒充当前任务成果。百度断路器开启时，本地官网与已知 ATS 队列仍可继续。
批次执行期间只写 SQLite、断点和日志；最终任务退出后才生成一次完整汇总与学生 XLSX。

## CLI 控制

```powershell
npm.cmd run control -- status --database data/lite-job-search.sqlite

npm.cmd run control -- stop `
  --batch <batch-id> `
  --database data/lite-job-search.sqlite `
  --confirm

npm.cmd run control -- resume `
  --batch <batch-id> `
  --database data/lite-job-search.sqlite `
  --confirm
```

`stop` 是指定批次的协作停止请求，不会模糊结束所有 Node 或 Chrome 进程。
Worker 在公司边界读取请求，保存当前断点后退出。

## 搜索引擎人工恢复

百度或 Google 出现 CAPTCHA、SECURITY_CHALLENGE、UNUSUAL_TRAFFIC、HTTP 429
或访问拒绝时，该引擎任务进入 `DEFERRED`，其独立断路器进入 `OPEN`。本地官网
核验队列继续运行，系统不会自动切换搜索引擎。

人工完成验证码后：

```powershell
npm.cmd run control -- provider-ack `
  --provider google `
  --database data/lite-job-search.sqlite `
  --confirm
```

该命令只写入人工确认，不会直接关闭断路器。随后由唯一探针 Worker 执行：

```powershell
node scripts/company-browser-discovery.mjs `
  --resume-provider google `
  --health-probe `
  --database data/lite-job-search.sqlite `
  --profile-dir data/browser-profiles/career-op-main
```

探针必须进入所选引擎的真实结果页并识别结果结构。成功后才进入 `CLOSED`；再次
出现验证则回到 `OPEN`。`HALF_OPEN` 探针使用 SQLite 租约，同一时刻只允许
一个 Owner。旧的 `baidu-ack` 命令仍兼容百度断路器。

## Chrome 诊断

不访问搜索引擎的进程诊断：

```powershell
npm.cmd run diagnose:chrome -- `
  --profile-dir data/browser-profiles/diagnostic `
  --output-dir test-output/browser-diagnostic `
  --url https://example.com `
  --variant B
```

输出包含实际 Profile、Worker PID、Chrome PID、可执行文件和真实 CommandLine。
`chromiumSandbox: true` 只表示已向 Playwright 请求 Sandbox；报告继续使用
`sandbox_verified=NOT_OS_VERIFIED`，不能据此宣称操作系统级 Sandbox 已完整验证。

## 写操作确认

Web API 写操作必须带 `X-LJS-Confirm: yes` 或 JSON `confirm: true`，并写入
`audit_logs`。未确认请求返回 `CONFIRMATION_REQUIRED`。
