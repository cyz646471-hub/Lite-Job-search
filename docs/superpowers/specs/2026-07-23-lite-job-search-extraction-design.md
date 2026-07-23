# Lite Job Search 拆分设计

## 目标

将 Career OP 中的岗位发现、招聘官网发现、ATS 识别、候选验证、页面下钻、去重、缓存、预算和批量导出能力拆成一个独立项目。新项目同时支持中国与北美市场，可由不同模型通过 CLI、Node API 或 Agent Skill 调用，不包含简历生成、岗位匹配评分、投递跟踪、面试准备和薪资分析。

## 方案选择

采用“稳定外壳 + 功能等价引擎快照”：

1. `src/` 提供小而稳定的公共接口、CLI、配置、批处理和统一结果格式。
2. `engine/` 保存从 Career OP 抽取的检索引擎及其传递依赖，尽量保持原路径，降低大规模改名导致的回归风险。
3. `scripts/sync-from-career-ops.mjs` 根据白名单入口和静态 import 依赖闭包更新 `engine/`，并生成来源清单。
4. `.agents/skills/lite-job-search/` 提供完整 Skill，模型优先调用稳定 CLI，不直接理解全部引擎内部实现。

不采用纯包装 Career OP 的方案，因为它无法独立运行；不采用一次性全面重写，因为难以证明功能无损。

## 功能边界

### 包含

- 中国：聚合线索解析、百度/Chrome、Baidu API、Tavily、Brave、Apify、人工候选、确定性官网发现、公司身份验证、ATS 指纹、招聘页面角色下钻、官方入口治理。
- 北美：公司招聘站发现、Greenhouse、Lever、Ashby、Workday、SmartRecruiters 及现有 provider 扫描、职位详情提取、去重与新鲜度过滤。
- 共享：环境 doctor、密钥脱敏、缓存、日预算、批处理、标准 JSON/JSONL/CSV 输出、错误分级和审计信息。

### 不包含

- 简历与求职信生成。
- 用户画像、岗位匹配评分和申请决策。
- 申请提交、登录、验证码处理或访问控制绕过。
- 申请追踪、面试准备、薪酬分析、Dashboard。

## 公共数据契约

统一招聘结果至少包含：

```json
{
  "market": "CN",
  "company": "示例公司",
  "title": "岗位名称",
  "location": "城市",
  "employmentType": "internship",
  "publishedAt": null,
  "sourceUrl": "https://...",
  "companyCareerHomeUrl": "https://...",
  "campaignLandingUrl": null,
  "jobListUrl": "https://...",
  "jobDetailUrl": null,
  "applyUrl": null,
  "officialIdentityConfirmed": true,
  "applicationActive": true,
  "source": "provider-name",
  "evidence": [],
  "discoveredAt": "ISO-8601"
}
```

链接角色不得无条件复用；聚合、高校、媒体和政府页面只作为来源证据，除非规则明确允许作为降级入口。

## CLI

```text
lite-job-search doctor
lite-job-search search --market CN --company 小红书
lite-job-search search --market NA --company Stripe
lite-job-search batch --input companies.csv --output results.jsonl
lite-job-search verify --input candidates.jsonl --output verified.jsonl
lite-job-search export --input verified.jsonl --format csv
```

所有命令支持 `--json`；无搜索服务时返回 `not_configured`，不把缺少备用服务误报为整体不可运行。

## 安全与成本

- 只从 `.env.local` 或系统环境读取密钥；日志仅显示 `configured` / `not_configured`。
- 不绕过登录、验证码、指纹或访问控制。
- 默认本地 HTTP → 本地 Playwright → Apify 降级；住宅代理关闭。
- 公司官网、招聘批次和失败查询使用不同 TTL；预算耗尽标记 deferred，不等同于无结果。
- Skill 不自动提交申请。

## 验证

- 对公共契约、区域隔离、去重、链接角色、搜索路由、缓存预算、CLI 和 Skill 进行离线测试。
- 用夹具比较 Career OP 与 Lite Job Search 的关键输出。
- 在已配置环境中执行 doctor；联网测试可选且必须明确标记是否真实执行。
- 运行 Skill `quick_validate.py`，并从仓库外目录调用 CLI，证明不依赖 Career OP 工作目录。

