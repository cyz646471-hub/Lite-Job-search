# 从 Career OP 迁移

## 当前策略

本次采用复制抽取而非立即删除原模块，避免破坏 Career OP 的现有数据库、日报和工作簿流程。

## 新代码应该放在哪里

| 需求 | 位置 |
|---|---|
| 新招聘信息源或 ATS | Lite Job Search `engine/` 与稳定适配器 |
| 搜索服务、缓存、预算 | Lite Job Search `src/search`、`src/runtime` |
| 官网身份验证和页面下钻 | Lite Job Search `src/pipeline` 与抽取引擎 |
| 简历、匹配、申请跟踪 | Career OP |
| 学生输出表格的业务样式 | Career OP 消费 Lite Job Search 结果后处理 |

## 数据交换

Career OP 应读取 Lite Job Search 的 JSON/JSONL 标准结果。不要让 Lite Job Search 读取 Career OP 的 CV、用户画像或申请历史。

批次级展示可按：

```text
companyStandardId + cohortYear + recruitmentType
```

分组，但应保留原始岗位行和来源证据。

## 后续迁移步骤

1. 在相同输入上并行运行旧检索与 Lite Job Search。
2. 比较 provider 数、候选数、官方入口准确率和页面角色。
3. 让 Career OP 的定期任务改为调用新 CLI。
4. 观察至少一个完整增量周期。
5. 只有在等价验证后，才删除 Career OP 中重复的检索实现。
