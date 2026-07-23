# Lite Job Search

Lite Job Search 是从 Career OP 中拆出的独立招聘检索与验证工具。它面向中国和北美市场，提供公司招聘官网发现、公开 ATS 扫描、候选链接验证、招聘页面下钻、去重、缓存、预算控制和 JSON/JSONL/CSV 导出。

它不包含简历生成、岗位匹配评分、自动申请、申请跟踪、面试准备或薪酬分析。

## 能力

| 模块 | 中国市场 | 北美市场 |
|---|---|---|
| 搜索服务 | 百度 API、可见 Chrome 百度工作流、Tavily、Brave、Apify Google、人工候选 | Tavily、Brave、人工候选 |
| 发现源 | Gank Interview、牛客招聘日程、牛企直聘、实习僧等公开线索；浪浪网申已移除 | 企业官网、VC portfolio seeds、公开职位板 |
| ATS / 招聘系统 | Moka、北森/Hotjob、飞书招聘、智联招聘系统、Moseeker 等 | Greenhouse、Lever、Ashby、Workday、SmartRecruiters、Teamtailor 等 |
| 验证 | 企业主域、品牌信号、ATS 租户、招聘语义、页面角色 | 企业域名、ATS 租户、职位列表/详情/申请动作 |
| 输出 | 统一 JSON、JSONL、CSV | 统一 JSON、JSONL、CSV |

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

输入支持 JSON、JSONL 和 CSV。无搜索 API 时，可用 `--manual manual-candidates.json` 导入浏览器或人工确认的候选。

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

高级调用可直接导入 `runCnDiscovery()`、`runAtsDiscovery()`、`ApifyGoogleSearchProvider` 和招聘页面下钻函数。

## 浏览器与 Apify

- 浏览器搜索使用正常可见会话；不绕过验证码、登录或访问控制。
- Apify 只作为增量搜索与动态页面降级，不保存业务主数据。
- Apify Google 查询应按 20–100 条批量提交，每条只取第一页和前 8 个自然结果。
- 默认不启用住宅代理。
- 预算耗尽返回 `search_deferred_by_budget`，不等于“没有官网”。

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
