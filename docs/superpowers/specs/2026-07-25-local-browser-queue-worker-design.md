# 本地浏览器队列 Worker 设计

## 目标

将现有公司浏览器发现脚本改造成可恢复的本地队列 Worker。真实 Chrome 仍是中国大陆公司招聘入口的主要发现来源；百度 API 仅作为小额度、可配置的补充来源。LLM 不参与公司官网真实性判断，也不位于公司名单检索的必经路径。

## 数据流

1. 从公司 registry 读取待处理公司。
2. 通过 SQLite `batch_runs` / `batch_items` 排除已成功公司并恢复失败项。
3. 优先消费真实 Chrome 已产生的百度搜索观察；没有观察时，Worker 可使用本地可见浏览器模式执行低频搜索。
4. 候选清洗器仅保留 HTTP/HTTPS，拒绝百度内部页面、广告、新闻、聚合站、`jobui.com`、`51job.com`、猎聘与 BOSS 正式岗位来源。
5. 每家公司最多保留 3 个候选招聘 URL。
6. 候选页面只导航一次；第一次导航获得的最终 URL、DOM、文本和链接直接形成页面观察，不重复加载。
7. 招聘站内入口默认最大深度 2、最多检查 5 个页面；优先 `position/jobs/social/campus/internship/graduate`。
8. 页面观察交给现有 Verification Engine。只有 `VERIFIED` 门户进入 Job Extraction。
9. 每家公司处理完立即写 SQLite 和 checkpoint；单家公司失败不终止批次。

## Chrome 与百度 API

- 真实 Chrome 是默认发现源，使用用户正常浏览器会话，低频顺序执行。
- 百度 API 不作为批次主路径，仅在显式启用且 Chrome 结果为空、失败或不可用时补充；每日预算由现有 `DailyBudget` 控制。
- Headless Playwright 不用于高频百度搜索，避免验证页；它仅适合直接招聘页的本地核验回退。

## 性能边界

- 搜索结果候选：默认 3 个/公司。
- 招聘入口递归：默认 5 页/公司，最大深度 2。
- 页面导航：默认 10 秒。
- 公司处理：顺序执行；不对百度并发。
- URL 按 canonical URL 去重；同一页面观察在当前公司处理内复用。

## 失败语义

- CAPTCHA、403、429：`BLOCKED`。
- Chrome/网络未配置：`NOT_CONFIGURED` 或 `FAILED`，不得当作空结果成功。
- 页面超时：记录 URL、阶段和错误，继续下一候选或公司。
- 未通过 Verification Engine：不得创建正式岗位。

## 非目标

- 不修改 Provider Contract。
- 不修改 Domain Model 或数据库 Schema。
- 不弱化 Verification Engine。
- 不自动提交申请、处理 CAPTCHA 或绕过访问控制。

