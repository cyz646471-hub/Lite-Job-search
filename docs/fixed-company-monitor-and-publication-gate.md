# 固定公司池增量监控与岗位发布门禁

## 工程基线

- 可回滚基线提交：`1ba4fd2 feat(runtime): establish local-first discovery baseline`
- 数据库迁移按 `src/storage/migrations` 文件名顺序执行，并记录在
  `schema_migrations`。
- `data/`、`output/`、`patches/` 等运行数据不进入 Git；数据库升级前应先备份。
- 基线验证命令：`npm.cmd test`。

## 固定公司池监控

默认公司池为
`data/company-registry/golden-seed-companies-current.json`，优先队列来自
`data/company-registry/cn-company-search-seed-v1.json`。优先队列是本地维护的
确定性排序，不调用 LLM 判断公司知名度。

增量计划只选择同时满足以下条件的公司：

1. 存在于固定 JSON 公司池；
2. SQLite 中已登记该公司；
3. 至少有一个 `VERIFIED` 且归属已确认的官网或官方 ATS 入口；
4. 招聘入口超过设定天数未检查，或显式使用 `--include-fresh`。

此模式固定 `allowBaiduFallback=false`。Worker 直接访问已确认入口并沿招聘链接
下钻，不对缺失入口的公司重复进行全网搜索。

只生成待执行队列：

```powershell
npm.cmd run monitor:fixed-pool:prepare -- `
  --database data/lite-job-search.sqlite `
  --stale-days 7 `
  --target-count 200
```

生成队列并执行：

```powershell
npm.cmd run monitor:fixed-pool -- `
  --database data/lite-job-search.sqlite `
  --profile-dir data/browser-profiles/career-op-main `
  --stale-days 7 `
  --target-count 200
```

## 岗位 A/B/C 质量等级

| 等级 | 条件 | 系统动作 |
| --- | --- | --- |
| A | 官网/官方 ATS 已验证，岗位和活动开放，地点及投递入口完整，具有核验时间 | `PUBLISHED`，可进入学生正式投递表 |
| B | 来源可信但关键字段缺失或开放状态不完整 | `REVIEW_REQUIRED`，自动创建 ReviewTask |
| C | 第三方平台、未确认来源、关闭或失效记录 | 候选/审核或过期，不进入学生正式投递表 |

第三方招聘平台只用于保留线索、岗位候选和审核证据。即使当前没有官网替代项，
`PLATFORM_ONLY` 记录也不会通过正式发布门禁。

## 审核、分配和用户行为

SQLite 新增：

- `review_tasks`：记录系统结论、原因码、审核人和结构化修正；
- `job_assignments`：把岗位分配给学生、规划师或团队；
- `user_actions`：记录查看、收藏、投递和失效反馈等行为。

本地控制面提供：

- `GET/POST /api/reviews`
- `POST /api/reviews/:id/resolve`
- `GET/POST /api/assignments`
- `GET/POST /api/actions`

所有 POST 请求沿用 `x-ljs-confirm: yes` 确认门禁。`REPORT_INVALID` 会自动创建
数据复核任务，不会直接删除岗位。
