# 自然语言招聘检索指令设计

## 目标

在现有本地浏览器 Worker 前增加一个确定性的任务编译层，使用户可以输入：

```text
检索近90天内中国，开放产品经理方向岗位公司100个
```

程序自动生成完整任务清单、选择未被 SQLite 收录的公司、调用现有 Worker，并保留 SQLite、运行报告和 XLSX 输出。

## 边界

- 不修改 Provider Contract、Verification Engine、Domain Model 或数据库 Schema。
- 自然语言只生成运行参数，不参与官网真实性、ATS 归属或置信度判断。
- 已被 SQLite 收录的公司按规范名称、中文名、英文名、别名和官方域名去重。
- 公司名单按“指定 registry、其他本地 registry、可插拔补充模块”顺序补充。
- 补充模块未配置且本地名单不足时，任务仍处理现有公司，同时明确记录 `NOT_CONFIGURED` 和缺口。
- 未明确的行业、地区等字段保持空值；不从公司总部或常识推断。

## 组件

### 指令编译器

`src/application/compile-search-instruction.mjs` 将中文指令编译为不可变任务对象：

- `market`
- `countryRegion`
- `role`
- `industry`
- `location`
- `freshnessDays`
- `targetCount`
- `batchId`
- 默认 registry、SQLite、输出目录、XLSX 和浏览器参数

支持天、周、月时间表达以及中国大陆、美国、加拿大和北美市场别名。无法识别市场、岗位或数量时明确失败，不猜测。

### 公司解析器

`src/application/resolve-task-companies.mjs` 读取兼容现有 Golden Dataset 的数组或 `companies`/`rawCompanies` 数据，标准化公司身份，排除 SQLite 已知公司，并按稳定顺序选择目标数量。

去重键包括：

- 规范公司名称；
- 中文名和英文名；
- Alias；
- 官方可注册域名。

### 指令运行器

`scripts/run-search-instruction.mjs`：

1. 编译指令；
2. 打开 SQLite 并读取已知公司；
3. 解析本地名单并选择未收录公司；
4. 写入 `task-manifest.json` 和 `selected-companies.json`；
5. 调用 `company-browser-discovery.mjs`；
6. 在断路器保持关闭且仍有 PENDING 公司时，以相同 batch-id 续跑；
7. 写入 `instruction-run-report.json`。

`--plan-only` 只生成计划与公司清单，便于安全验证，不启动浏览器。默认执行完整任务，遇到 CAPTCHA、Provider 断路器、浏览器失败或无可处理公司时停止。

## 输出与真实状态

任务目录除现有 Worker 文件外增加：

- `task-manifest.json`
- `selected-companies.json`
- `instruction-run-report.json`

最终状态区分：

- `COMPLETE`
- `COMPLETE_WITH_ERRORS`
- `PARTIAL`
- `BLOCKED`
- `NOT_CONFIGURED`
- `NO_UNSEEN_COMPANIES`

不得把本地名单不足、补充源未配置、网络失败或 CAPTCHA 写成成功空结果。

