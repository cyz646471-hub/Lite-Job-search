# Lite Job Search

## 自然语言任务入口

一条指令可以生成任务清单、排除 SQLite 已收录公司并启动完整浏览器
生产链路：

```powershell
npm.cmd run discover:instruction -- `
  "检索近90天内中国，开放产品经理方向岗位公司100个"
```

先检查自动填充内容而不启动浏览器：

```powershell
npm.cmd run discover:instruction -- `
  "检索近90天内中国，开放产品经理方向岗位公司100个" `
  --plan-only
```

字段、名单补充接口、去重和失败状态说明见
[一句话招聘检索任务指导](docs/search-instruction-template.md)。

Lite Job Search 是从 Career OP 中拆出的独立招聘检索与验证工具。它面向中国和北美市场，提供公司招聘官网发现、公开 ATS 扫描、候选链接验证、招聘页面下钻、去重、缓存、预算控制和 JSON/JSONL/CSV/XLSX 导出。

它不包含简历生成、岗位匹配评分、自动申请、申请跟踪、面试准备或薪酬分析。

## 能力

| 模块 | 中国市场 | 北美市场 |
|---|---|---|
| 搜索服务 | Persistent Chrome 中显式选择百度或 Google；百度 API 与 Apify 已禁用 | Tavily、Brave、人工候选 |
| 发现源 | Gank Interview、牛客招聘日程、牛企直聘、实习僧等公开线索；浪浪网申已移除 | 企业官网、VC portfolio seeds、公开职位板 |
| ATS / 招聘系统 | Moka、北森/Hotjob、飞书招聘、智联招聘系统、Moseeker 等 | Greenhouse、Lever、Ashby、Workday、SmartRecruiters、Teamtailor 等 |
| 验证 | 企业主域、品牌信号、ATS 租户、招聘语义、页面角色 | 企业域名、ATS 租户、职位列表/详情/申请动作 |
| 输出 | JSON、JSONL、CSV、SQLite、按招聘事件聚合的 XLSX | JSON、JSONL、CSV、SQLite、按招聘事件聚合的 XLSX |

抽取引擎保留 60+ 个 Career OP provider、8 个招聘页面 provider、5 个职位详情 provider。公开接口只暴露稳定工作流，减少其他模型需要读取的上下文。

## 安装

要求 Node.js 20+：

```powershell
git clone https://github.com/cyz646471-hub/Lite-Job-search.git
cd Lite-Job-search
npm.cmd install --ignore-scripts
```

复制 `.env.example` 为 `.env.local`，只填需要的服务。密钥不会写入日志或 Git。

```dotenv
SEARCH_PROVIDER_PRIMARY=tavily
SEARCH_PROVIDER_FALLBACK=none
TAVILY_API_KEY=
SEARCH_MAX_RESULTS=8
SEARCH_TIMEOUT_MS=15000
SEARCH_DAILY_QUERY_BUDGET=300
```

只配置一个服务时，系统进入 `single_provider`，不会因为缺少备用服务而停止运行。

## CLI

检查配置：

```powershell
npm.cmd run doctor -- --json
```

检索单个公司：

```powershell
node bin/lite-job-search.mjs search --market CN --company "小红书" --official-domain xiaohongshu.com --json
node bin/lite-job-search.mjs search --market NA --company "Stripe" --json
```

批量检索：

```powershell
node bin/lite-job-search.mjs batch --input .\companies.json --output .\candidates.json --json
```

验证页面并分离链接角色：

```powershell
node bin/lite-job-search.mjs verify --input .\candidates.json --output .\verified.json --json
```

导出：

```powershell
node bin/lite-job-search.mjs export --input .\verified.json --output .\verified.csv --format csv --json
```

按岗位和行业发现招聘市场：

```powershell
node bin/lite-job-search.mjs discover `
  --market CN `
  --role "AI产品经理" `
  --industry "AI,互联网" `
  --since-days 90 `
  --limit 20 `
  --database ".\data\lite-job-search.sqlite" `
  --json
```

该流程为：岗位关键词输入 → LLM 扩展关键词与 Query → 搜索候选公司/URL → 程序验证官网与 ATS → 抽取岗位 → 写入 SQLite。LLM 不参与官网真实性、验证状态或置信度评分。

完整 Canary 支持 `--location`，并输出 Query、候选 URL/公司、验证结果、
岗位提取、逐阶段失败、LLM 调用及质量指标。缺少配置返回
`NOT_CONFIGURED`，Provider 或网络失败返回 `FAILED`/`BLOCKED`，不会被解释为
“没有岗位”。

首批行业/岗位组合可断点执行：

```powershell
node bin/lite-job-search.mjs discover-batch `
  --input .\examples\first-data-batch.json `
  --batch-id cn-first-production `
  --database .\data\lite-job-search.sqlite `
  --json
```

重复执行会跳过成功条目；修复外部故障后使用 `--retry-failed`。单条失败不会
中止后续组合。

系统分别统计 Candidate、Verified Portal 和 Usable Apply Entry。聚合站、高校就业网、新闻转载和培训机构不能作为官方招聘入口；未知发布日期不计入近期岗位。数量不足时返回 `PARTIAL`，不会用低置信度页面补足。

学生投递 XLSX 是固定输出：每行对应一个 `RecruitmentEvent`（公司 + 招聘类型 + 届次 + 目录 URL），同一事件下的岗位和地区去重合并。投递链接只使用届次/活动目录 URL，并以 Excel 超链接展示；缺失日期、地区、行业和简介保持空白。内部 ID、验证证据、Provider、缓存、错误和单岗位详情链接不进入学生表。

学生投递清单（XLSX，投递入口为可点击超链接）：

```powershell
node bin/lite-job-search.mjs export --input .\verified.json --output .\verified.student.xlsx --format xlsx --json
```

`batch` 和 `verify` 只要使用非 XLSX 的 `--output`，都会保留该主输出，并自动在同目录创建 `<文件名>.student.xlsx`。工作簿固定为八列：公司名称、公司类型（模型判断）、开放批次、开放岗位、地区、开始时间、截止时间、投递链接。每个岗位一行，投递链接显示为“查看岗位并投递”的 Excel 超链接；不会把检索证据、来源 URL 等审计字段展示给学生。

公司类型只展示置信度不低于 `0.8` 的模型分类，否则写为“待确认”。日期缺失时写为“未披露”，明确的 `until_filled` 截止规则写为“招满即止”。链接优先级为直接申请页、职位详情、职位列表、招聘活动页、企业招聘主页；未经验证的入口不会被包装成可投递链接。

XLSX 导出使用 Codex Desktop 附带的电子表格运行时；在该环境外缺少运行时时，命令会明确报错而不会生成伪 XLSX 文件。

输入支持 JSON、JSONL 和 CSV，也接受包含 `market` 和 `companies` 的持久化招聘报告 JSON。无搜索 API 时，可用 `--manual manual-candidates.json` 导入浏览器或人工确认的候选。

## 作为 Skill 使用

Skill 位于：

```text
.agents/skills/lite-job-search/
```

在本仓库中直接让模型使用：

```text
Use $lite-job-search to search and verify recent internship openings in China.
Use $lite-job-search to find official new-grad job lists for 50 North American companies.
```

可选安装到当前用户的 Codex Skill 目录：

```powershell
.\scripts\install-skill.ps1
```

该命令不会自动执行；只有手动运行才会修改用户级 Skill 目录。

## Node API

```js
import {
  DailyBudget,
  FileSearchCache,
  SearchRouter,
  createSearchProviders,
  loadRuntimeConfig,
  searchCompany,
} from 'lite-job-search';

const config = loadRuntimeConfig(process.env);
const providers = createSearchProviders(process.env);
const router = new SearchRouter(
  [providers.tavily].filter((provider) => provider.configured),
  {
    cache: new FileSearchCache({ file: './cache/search.json' }),
    budget: new DailyBudget({ limit: config.search.dailyQueryBudget }),
  },
);

const result = await searchCompany({
  market: 'NA',
  company: 'Stripe',
  router,
});
```

岗位驱动 API：

```js
import {
  createMarketDiscoveryRuntime,
  discoverMarketJobs,
} from 'lite-job-search';

const runtime = await createMarketDiscoveryRuntime({ market: 'CN' });
try {
  const result = await discoverMarketJobs({
    market: 'CN',
    roleType: 'AI 产品经理',
    industryTags: ['AI', '互联网'],
    freshnessDays: 90,
    targetCount: 20,
  }, runtime);
  console.log(result);
} finally {
  runtime.close();
}
```

高级调用可直接导入 `runCnDiscovery()`、`runAtsDiscovery()` 和招聘页面下钻函数。

## 浏览器搜索

- 中国生产 Worker 使用长期运行的 Persistent Chrome Supervisor 和独立自动化 Profile，不连接用户日常 Chrome Profile。
- 发现顺序是已验证 Portal、官方域名、历史入口、ATS、缓存、公开线索外链、常见招聘路径、显式选择的百度或 Google、人工发现。
- Direct HTTP 与 ATS Adapter 优先；只有动态渲染、分页或交互确有需要时才启动 Playwright。
- 浏览器搜索默认至少间隔 10 秒并叠加抖动；首次安全验证立即将该引擎任务记为 `DEFERRED` 并打开独立断路器，直接官网核验任务继续执行。
- 浏览器搜索不绕过验证码、登录、限流或访问控制；人工健康探测成功后才恢复延迟队列。
- 不得通过自动切换引擎、百度 API、Apify 或新 Profile 规避安全验证。
- 默认不启用住宅代理。
- 预算耗尽返回 `search_deferred_by_budget`，不等于“没有官网”。

完整命令、断点恢复、来源边界、SQLite 完整性与 XLSX 输出见[本地 Chrome 招聘发现 Worker](docs/local-browser-worker.md)。

## Persistent Chrome Supervisor

Production browser discovery runs through `npm.cmd run
discover:persistent-supervisor`. The Supervisor is a long-running Node.js
process that owns one Playwright persistent context and a dedicated automation
profile for its entire SQLite-backed company queue. It never attaches to a
user's daily Chrome profile or extension host. The profile is exclusive to one
process and uses a lock file to fail closed on a second worker. CAPTCHA and
access challenges remain `BLOCKED`; the worker does not try to bypass them.

See [Persistent Chrome Supervisor](docs/persistent-chrome-supervisor.md) for
the service/container command and profile requirements.

Local task creation, Worker state, batch stop/resume, Baidu/Google manual
acknowledgement and XLSX download are available through the
[local control plane](docs/local-control-plane.md).

For periodic maintenance of the local 1,000+ company registry, use the
[fixed company monitor and A/B/C publication gate](docs/fixed-company-monitor-and-publication-gate.md).
This path rechecks confirmed official/ATS entries without repeating web search;
third-party platform records remain review candidates and never enter the
student-facing workbook.

## 项目结构

```text
src/                         稳定 API、CLI、跨市场契约
engine/upstream/             功能等价的 Career OP 检索引擎快照
config/extraction-manifest.json  抽取白名单和边界
scripts/sync-from-career-ops.mjs 可重复同步传递依赖
.agents/skills/lite-job-search/ 完整 Agent Skill
tests/                       契约、等价、CLI 与 Skill 测试
```

详见 [架构说明](docs/architecture.md) 和 [Career OP 迁移说明](docs/migration-from-career-ops.md)。

## 安全边界

本项目只处理公开招聘信息。不得绕过 CAPTCHA、登录、指纹、限流或访问控制；不得自动提交申请、上传简历、勾选协议或发送消息。

## 许可证与来源

MIT。抽取代码来源及归属说明见 [NOTICE.md](NOTICE.md)。
