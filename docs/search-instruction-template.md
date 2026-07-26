# 一句话招聘检索任务指导

## 推荐指令

```text
检索近<时间>内<市场>，开放<岗位>方向岗位公司<数量>个
```

例如：

```text
检索近90天内中国，开放产品经理方向岗位公司100个
检索近3个月内中国，开放AI产品经理方向岗位公司50个
检索近8周内北美地区，在多伦多开放后端开发岗位的公司25家
```

执行：

```powershell
npm.cmd run discover:instruction -- `
  "检索近90天内中国，开放产品经理方向岗位公司100个"
```

只生成任务清单，不启动浏览器：

```powershell
npm.cmd run discover:instruction -- `
  "检索近90天内中国，开放产品经理方向岗位公司100个" `
  --plan-only
```

## 自动填充字段

程序从指令中确定性提取：

- 市场：`CN` 或 `NA`；
- 岗位；
- 时间范围，统一换算为天；
- 地区；
- 目标公司数量。

随后自动填充：

- 本地公司 registry；
- SQLite 路径；
- 输出目录；
- XLSX 路径；
- 稳定任务 ID 和与公司清单绑定的 batch ID；
- 可见 Chrome 模式；
- 每轮 10 家；
- 搜索最少间隔 10 秒并增加 0–20 秒随机抖动；
- 候选页、招聘入口和递归访问上限。

生成的 `task-manifest.json` 是本次运行的实际指导文件。自然语言原文、
编译后的参数、名单来源、去重数量、缺口、数据库和输出路径全部保留在
该文件中。

## 公司名单与去重

1. 优先读取 `data/company-registry/golden-seed-companies-merged-current.json`。
2. 默认继续读取同一目录中的其他 JSON registry。
3. 按公司规范名、中文名、英文名、Alias 和官方域名，与 SQLite 已收录
   公司去重。
4. 只有尚未收录的公司进入 `selected-companies.json`。
5. 本地名单不足时，可以传入可替换补充模块：

```powershell
--company-supplement-module C:\path\to\company-provider.mjs
```

模块导出 `provideCompanies({ task, knownCompanies, needed })` 或默认函数，
返回兼容 Golden Dataset 的公司数组。模块不得决定官网真实性。

如果补充模块未配置，程序将缺口标记为 `NOT_CONFIGURED`，处理已有本地
公司，不把缺口伪造成成功。

## 固定生产链路

```text
自然语言指令
→ task-manifest.json
→ 本地名单与可替换补充源
→ SQLite 公司去重
→ selected-companies.json
→ 可见 Chrome 搜索
→ 候选页面访问
→ Verification Engine
→ CareerPortal
→ RecruitmentEvent
→ JobOpening
→ SQLite
→ 完整报告
→ 学生投递 XLSX
```

LLM 不参与官网真实性、ATS 归属、verification status 或 confidence score
判断。出现 CAPTCHA、网络失败、Provider 失败或浏览器断开时，必须保留
`BLOCKED`、`FAILED`、`DEFERRED` 或 `NOT_CONFIGURED`，并停止不安全的继续
检索。

## 输出

任务目录至少包含：

- `task-manifest.json`
- `selected-companies.json`
- `instruction-run-report.json`
- `candidates.json`
- `leads.json`
- `report.json`
- `run-report.json`
- `student-application-rows.json`
- `student-applications.xlsx`

岗位、地区、届次、开始和截止日期只使用页面明确证据；未知值保持空白。
XLSX 投递链接使用经过验证的招聘事件或届次目录链接，不使用搜索结果、
新闻、聚合页或虚构链接。

