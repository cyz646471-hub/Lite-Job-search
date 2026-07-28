# Worker 错误自动处理

控制任务采用“单家公司隔离、短批次重试、无法安全恢复则暂停”的策略。所有
自动动作写入 `audit_logs`，不会把阻断或异常记成成功。

| 情况 | 自动处理 | 最终状态 |
| --- | --- | --- |
| 当前 Node 进程身份 | 使用进程内稳定令牌，不调用 PowerShell | 继续启动 |
| PowerShell/CIM 超时 | 短批次指数退避重试 | 重试耗尽后 `PAUSED/PARTIAL` |
| SQLite `BUSY/LOCKED` | 短批次指数退避重试 | 重试耗尽后 `PAUSED/PARTIAL` |
| 浏览器上下文断开 | 关闭本次 Supervisor 后重建并重试 | 重试耗尽后暂停 |
| 临时网络错误 | 重试当前短批次 | 重试耗尽后暂停 |
| Profile 已被其他 Worker 使用 | 不抢占、不并发启动 | 立即暂停 |
| 无法确认旧 Profile 所有者 | 保持锁，不猜测 Chrome 已退出 | 立即暂停 |
| CAPTCHA 或搜索引擎访问阻断 | 沿用 Provider 断路器和 `DEFERRED` | 等待人工验证 |
| 单家公司页面失败 | 只标记该公司，继续批次 | `FAILED` checkpoint |
| 配置错误或未知程序错误 | 保留断点并快速失败 | 任务 `FAILED` |

默认允许两次 Supervisor 重试，间隔为 2 秒、4 秒。可以为诊断调整：

```powershell
npm.cmd run task:run -- `
  --task <task-id> `
  --registry <company-queue.json> `
  --database data/lite-job-search.sqlite `
  --output-dir <output-directory> `
  --profile-dir data/browser-profiles/career-op-main `
  --max-supervisor-retries 2 `
  --supervisor-retry-delay-ms 2000
```

自动暂停不会生成最终学生 XLSX。恢复外部条件后，用控制面恢复同一批次并重新
运行相同任务；`SUCCEEDED` 条目会跳过，孤立的 `RUNNING` 条目会重新执行，
需要重试已明确失败的公司时增加 `--retry-failed`。
