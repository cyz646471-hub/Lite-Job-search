# 中国市场未入库企业发现

`discover:cn-market` 用于先在公开搜索结果页发现企业线索，再将未入库企业交给已有的公司级官网核验、招聘入口识别和岗位采集 Worker。

它不是招聘官网验证器，也不会把搜索结果、新闻、聚合平台或公司主页直接写为可投递入口。

## 优先级与去重

搜索 Query 固定按三层执行：

1. 中国私营企业的热门行业：AI/大模型、互联网消费科技、3C/智能硬件、智能汽车/机器人、半导体/云软件；
2. 外企在中国的招聘线索；
3. 央国企、事业单位与科研机构。

候选在进入公司 Worker 前，按标准化公司名、别名、官方域名同 SQLite `Company` 去重；同一轮搜索结果也会去重。职友集、前程无忧、智联、BOSS、猎聘和牛客可用于提取“公司名称”线索，并明确标为 `THIRD_PARTY_COMPANY_LEAD`；其 URL 永远不能成为招聘入口或学生投递链接。高校就业网、新闻、广告和培训类结果仍会被排除。

## 运行

```powershell
npm.cmd run discover:cn-market -- `
  --database data/lite-job-search.sqlite `
  --role "产品经理" `
  --industry "AI" `
  --target-count 100 `
  --output output/cn-market-discovery/company-leads.json
```

输出中的 `queue` 是未入库公司清单。随后把该文件作为现有持久化 Worker 的 `--input`，再执行官网导航、确定性验证、招聘事件判断、岗位抽取与 SQLite 写入。

要按上述两阶段连续执行（浏览器会在两个阶段之间关闭并重新以同一专用 Profile 打开），使用：

```powershell
npm.cmd run discover:cn-market:cycle -- `
  --database data/lite-job-search.sqlite `
  --role "产品经理" `
  --industry "AI" `
  --target-count 100 `
  --max-pages-per-query 5 `
  --output-dir output/cn-market-discovery
```

## 成本和安全边界

- 默认完全不调用 LLM；Query、候选名提取、过滤与去重均是确定性规则。
- 默认使用 Google 的 `zh-CN` 中文结果页，并将“中国”和中文招聘词固化进 Query；可显式传入 `--search-engine baidu`。不使用 API、Apify，也不会因安全验证自动切换引擎。
- 查询之间最短间隔为 4 秒。Google 或百度出现安全验证时立即写出 `BLOCKED` 结果并保留已发现线索，等待人工完成验证后再运行。
- 每个 Query 默认最多读取 5 页，可通过 `--max-pages-per-query` 调整到 20 页。每一页完成后都会原子写入同一个输出文件；用同一命令重跑将跳过已成功的 Query 页并继续增量发现。
- 市场发现使用独立 `cn-market-lead-discovery` 浏览器 Profile，后续公司核验 Worker 使用原有专用 Profile，避免同一 Profile 被两个进程抢占。
- 搜索发现仅提供 `discoveryEvidenceUrl`，不具有官网真实性或投递资格；只有现有 Verification Engine 标为 `VERIFIED` 的门户才可进入岗位抽取。
