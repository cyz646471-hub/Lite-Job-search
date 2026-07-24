# 公司招聘浏览器检索

该工具使用公开的百度自然搜索结果，按“公司名称 + 招聘”发现招聘页面。
它忽略广告、新闻和公司主业务首页，并将官方招聘候选与猎聘、BOSS
等第三方 `LEAD_ONLY` 线索分开保存。

```powershell
node scripts/company-browser-discovery.mjs `
  --input examples/company-browser-discovery-input.json `
  --output-dir .\test-output\company-browser-discovery `
  --max-results 10
```

使用 `--headful` 可以显示浏览器。现有参数和输出文件保持兼容。

## 固定检查流程

搜索结果只表示候选发现。对于每个官方招聘候选，浏览器会继续执行：

```text
打开候选招聘页
→ 识别社招、校招、应届生、实习和通用职位入口
→ 在同一官方主域内逐个访问
→ 最多遍历两层，每个规范化 URL 只访问一次
→ 保存页面状态和有限证据
```

单个子入口访问失败或被拦截时，其他同公司入口继续检查。工具不会登录、
绕过验证码、规避访问控制或提交申请。

## 页面状态

- `DISCOVERED`：仅发现，尚未进入检查；
- `COMPLETED`：页面访问和观察完成；
- `BLOCKED`：验证码、登录、403、429 或访问控制；
- `FAILED`：网络、导航或解析失败。

招聘情况通过 `vacancyStatus` 表达：

- `NO_OPENINGS`：页面明确显示暂无职位；
- `UNKNOWN`：存在招聘或岗位结构，但浏览器观察尚不能证明有效岗位；
- `NOT_A_LIST`：页面不是岗位列表；
- `ACTIVE`：仅在正式岗位提取器成功解析出有效开放岗位后成立。

浏览器看到“职位列表”文字不能直接标记为 `ACTIVE`。候选必须继续经过
确定性官网验证和岗位提取。

## 输出

- `candidates.json`：已访问的官方招聘候选及其招聘类型、父入口、遍历深度、
  页面状态和证据；
- `leads.json`：主体匹配但不是官网的猎聘、BOSS 等降级线索；
- `report.json`：公司查询状态、失败原因、候选数量以及已检查、空岗位、
  未知、阻断和失败入口统计。

正式生产流程继续执行：

```text
候选 URL
→ Verification Engine
→ CareerPortal
→ Job Extraction
→ JobOpening
→ SQLite
```

每个子入口都必须独立验证，不能继承父页面的官网结论。`CareerPortal`
保存入口及证据，`JobOpening` 只保存验证通过且符合检索条件的岗位，
`DiscoveryLog` 保存访问结果、招聘状态和失败原因。
