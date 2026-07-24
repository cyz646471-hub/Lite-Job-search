# 公司招聘浏览器检索

此工具使用公开的百度自然搜索结果，按“公司名 + 招聘”发现招聘页面。它会忽略广告、新闻及主业务首页；将官网招聘候选和第三方 `LEAD_ONLY` 线索写入不同文件。

```powershell
node scripts/company-browser-discovery.mjs `
  --input examples/company-browser-discovery-input.json `
  --output-dir .\test-output\company-browser-discovery `
  --max-results 10
```

输出：

- `candidates.json`：供现有 `lite-job-search search --manual` 继续验证的候选；
- `leads.json`：猎聘、BOSS 等主体匹配但并非官网的 `LEAD_ONLY` 线索；
- `report.json`：每家公司查询、失败原因、候选数和线索数。

使用 `--headful` 可显示浏览器。工具不会登录、绕过验证码或提交申请；发生验证码、登录墙、网络故障或浏览器启动失败时会显式标记 `BLOCKED` 或 `FAILED`。
