# 本地 Chrome 招聘发现 Worker

本 Worker 用本机 Google Chrome 的可见会话检索公司招聘入口，进入候选页采集页面证据，再交给确定性 Verification Engine。LLM 不参与官网真实性、验证状态或置信度判断；百度 API 仅保留为独立的小额度补充来源。

## 生产链路

```text
Golden Dataset 公司
→ 每家公司一次百度 Query
→ 候选 URL 过滤
→ 官网/官方 ATS/平台公司页归属验证
→ 招聘事件与届次识别
→ 岗位、地区、明确日期抽取
→ 公司级原子快照写入 SQLite
→ 质量报告、学生投递投影和 XLSX
```

广告、新闻、高校转载、培训机构、Jobui、51job、牛客等无效来源只保留在发现日志或直接排除，不进入 Company → CareerPortal → RecruitmentEvent → JobOpening 正式链路。

## 浏览器模式

Worker 支持两种显式模式，不会静默降级：

- `persistent-chrome`：CLI 默认模式。启动独立的可见 Chrome profile，适合本地队列长期运行。
- `normal-chrome`：使用注入的 ChatGPT Chrome Extension binding。若调用环境没有注入 binding，返回 `NOT_CONFIGURED`，不会改用独立 profile。

默认启动可见 Chrome。`--headless` 仅用于诊断；无头浏览器更容易遇到安全验证，不能作为规避手段。

## 执行批次

```powershell
npm.cmd run discover:local-worker -- `
  --input data/company-registry/golden-seed-companies-merged-current.json `
  --output-dir test-output/local-worker/current `
  --database data/lite-job-search.sqlite `
  --browser-mode persistent-chrome `
  --batch-id daily-cn-current `
  --max-results 10 `
  --max-candidates 3 `
  --max-career-entries 5 `
  --max-depth 2 `
  --timeout-ms 10000 `
  --search-delay-ms 10000 `
  --search-jitter-ms 20000 `
  --max-companies-per-run 10 `
  --xlsx-output outputs/student-applications.xlsx
```

安全速率默认值：

- 搜索间隔下限为 10 秒，不能配置得更低；
- 每次叠加 0–20 秒随机抖动；
- 每家公司只发起一个百度 Query，候选页和招聘站内下钻不增加搜索 Query；
- 单轮默认最多 10 家，可配置 1–100 家，硬上限为 100。

## 百度阻断与断路器

Worker 不识别、点击、自动刷新或绕过 CAPTCHA、限流和访问控制。

第一次检测到百度安全验证时：

1. 当前公司从 `RUNNING` 变为 `DEFERRED`，不是 `FAILED`；
2. Provider 断路器变为 `OPEN`；
3. 后续公司保持 `PENDING`，本轮不再发起百度 Query；
4. SQLite、JSON 报告和断点立即保留；
5. 后续批次遇到同一 `OPEN` 状态会零 Query 暂停，并在报告中写明断路器原因。

状态语义：

- `SUCCEEDED`：本条流水线完成；数量不足仍可为业务结果 `PARTIAL`。
- `FAILED`：网络、页面、存储或程序错误；可在修复原因后用 `--retry-failed`。
- `DEFERRED`：Provider 被阻断，等待人工恢复；`--retry-failed` 不会重试。
- `PENDING`：尚未开始。
- `PAUSED`：达到单轮上限，或断路器阻止继续搜索。

## 人工健康探测与恢复

用户先在正常 Chrome 中完成百度要求的人工验证，并确认普通搜索结果页可读取，再执行一次健康探测：

```powershell
npm.cmd run discover:local-worker -- `
  --resume-provider baidu `
  --health-probe `
  --database data/lite-job-search.sqlite `
  --profile-dir data/local-chrome-worker-profile
```

探测成功后断路器变为 `CLOSED`，下一次使用原输入和原 `--batch-id` 运行时才会恢复当前 `DEFERRED` 公司。探测失败则保持 `OPEN`，不推进公司队列。

同一个 `batch-id` 必须对应完全相同的输入清单。已成功公司会跳过，单家公司失败不影响下一家公司；不同输入要使用新的 `batch-id`。

## 来源与展示边界

- `OFFICIAL_SITE`：企业自有域名下的招聘事件；正式岗位要求 Portal 为 `VERIFIED`。
- `OFFICIAL_ATS`：由已验证企业官网定向归属的 ATS 租户；正式岗位同样要求 `VERIFIED`。
- `PLATFORM_ONLY`：只有精确公司主体匹配的招聘平台公司页，不可变成 `VERIFIED`，与官方指标隔离。
- 后续发现官方事件时，平台历史保留并标记 `supersededByPortalId`，默认学生投递清单不展示被替代记录。
- 官网已找到但明确无开放岗位时，保留 Portal 和 `NO_OPENINGS`，不伪造 JobOpening。
- 日期、地区、岗位和届次只保存页面明确值；未知字段保持空白。

## 输出

每次运行的 `--output-dir` 包含：

- `candidates.json`：已访问的官方/ATS 候选；
- `leads.json`：平台或待后续核验线索；
- `report.json`：公司级搜索和页面访问结果；
- `run-report.json`：Query、Provider、候选、验证、抽取、字段缺失、质量指标、失败原因和断路器状态；
- `student-application-rows.json`：按 RecruitmentEvent 聚合、隐藏内部证据和单岗位详情的固定学生投递投影。

传入 `--xlsx-output` 时同步生成 XLSX。也可独立生成：

```powershell
node scripts/build-browser-batch-xlsx.mjs `
  --input test-output/local-worker/current/student-application-rows.json `
  --output outputs/student-applications.xlsx `
  --preview
```

XLSX 每行对应一个招聘事件/届次，字段为公司名称、公司类型、公司简介、来源等级、招聘批次、届次、开始/截止时间、地区、开放岗位、投递链接、招聘状态和最后核验时间。岗位与地区去重合并，链接只指向招聘事件目录页；证据、Provider、缓存、错误和单岗位详情链接不进入学生表。

## 数据库完整性检查

新写入数据应满足：

```sql
SELECT COUNT(*) FROM job_openings
WHERE recruitment_event_id IS NULL;

SELECT COUNT(*)
FROM job_openings jobs
JOIN career_portals portals ON portals.id = jobs.career_portal_id
WHERE jobs.source_tier != 'PLATFORM_ONLY'
  AND portals.verification_status != 'VERIFIED';

SELECT company_id, recruitment_type, cohort, directory_url, COUNT(*)
FROM recruitment_events
GROUP BY company_id, recruitment_type, cohort, directory_url
HAVING COUNT(*) > 1;
```

三个检查必须均为 0 违规记录。页面或快照写入失败时，单家公司正式 Company/Portal/Event/Job 链路整体回滚。
