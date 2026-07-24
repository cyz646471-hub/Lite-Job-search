# Golden Company Discovery Canary v1

执行日期：2026-07-24

执行分支：`codex/job-driven-market-discovery`

目标岗位：`AI Product Manager`

目标范围：近 90 天，Golden Dataset 中选定 20 家公司

## 结论

Golden Seed 已从用户提供的 Z 盘路径加载并通过 UTF-8 JSON 校验，共 100 家
公司；本轮按可复现评分选定 20 家 AI/产品方向公司。

运行状态仍为 `NOT_CONFIGURED`，没有执行真实搜索，也没有进入候选 URL、官网
验证、Career Portal、岗位抽取或 SQLite 岗位写入阶段。

这不是“没有岗位”，而是运行前置条件不满足。报告没有手工填写招聘网址、没有
补充岗位、没有跳过 Verification，也没有把失败记为成功。

## 1. Discovery

| 指标 | 结果 |
|---|---:|
| Golden Seed 状态 | `AVAILABLE_VALID` |
| Seed 公司总数 | 100 |
| 选择公司数 | 20 |
| 实际生成 Query | 0 |
| 实际调用 Provider | 0 |
| 搜索结果数 | 0 |
| 候选 URL 数 | 0 |
| 候选公司数 | 0 |
| Live Search | `false` |

用户要求的关键词已经记录在 `run-manifest.json`，但由于 LLM Planning 未配置，
系统没有生成或执行 Query，因此这些词不能表述为“已使用 Query”。

选择快照见 `selected-companies.json`：China 13 家、US 7 家。选择评分为
AI=100、大模型=80、互联网=30、云计算=20、智能硬件=10，同分保持 Seed
原始顺序。

Doctor 结果：

- Search mode：`no_provider`
- Tavily：`not_configured`
- Brave：`not_configured`
- Baidu：`not_configured`
- Apify：`configured`，但只具备批量搜索能力，当前单次 Discovery 路径不可用
- LLM Planning：`not_configured`
- Database：`ready`
- Market Discovery Ready：`false`

## 2. Verification

没有候选 URL 进入 Verification Engine。

| 分类 | 公司数 |
|---|---:|
| verified | 0 |
| pending_review | 0 |
| rejected | 0 |

没有公司级 `candidate URLs`、最终 Portal、confidence score 或 evidence 可输出。
在未执行确定性验证前，不应从静态知识或人工判断补写这些字段。

## 3. Job Extraction

| 指标 | 结果 |
|---|---:|
| 成功提取公司数 | 0 |
| 成功提取岗位数 | 0 |
| 来源 Portal 数 | 0 |
| SQLite 岗位写入数 | 0 |

不存在可合法列出的岗位名称或来源 Portal。

## 4. Quality Metrics

由于没有任何候选、Portal 或岗位进入对应分母，质量指标均为不可计算，而不是
0%：

| 指标 | 分子 | 分母/样本 | 值 |
|---|---:|---:|---:|
| Official verification rate | 0 | 0 | `null` |
| Job extraction success rate | 0 | 0 | `null` |
| False positive rate | 0 | 0 | `null` |
| Duplicate rate | 0 | 0 | `null` |
| Average confidence score | — | 0 | `null` |

## 5. Top 10 成功案例

不可用。本轮没有执行搜索和验证，成功案例数为 0。为满足数量而列出静态已知
招聘网站会违反“禁止手工填写招聘网址”和“必须走完整流程”的要求。

## 6. Top 10 失败案例

没有公司级失败案例，因为搜索未启动。当前可确认的是以下
运行级阻塞项：

| 优先级 | 阻塞项 | 错误证据 | 原因判断 | 建议方向 |
|---:|---|---|---|---|
| 1 | LLM Planning 未配置 | `LLM_PLANNING_NOT_CONFIGURED` | Keyword Expansion 和 Query Planning 无法执行 | 配置批准的可替换 LLM Planner，并记录成本 |
| 2 | 单查询 Provider 不足 | `searchMode=no_provider` | Tavily、Brave、Baidu 均未配置 | 配置至少一个受支持的单查询 Provider |
| 3 | Apify 不能进入当前链路 | `canRunApifyBatch=true`、`canRunLiveSearch=false` | 当前 Discovery 使用单查询 SearchRouter | 由 Codex 设计批量搜索 Adapter，不在 Canary 中绕过 |
| 4 | Golden Company 限定尚未接入 | `discover` 只接受岗位 Intent | 当前闭环从岗位发现公司，不接受 Registry 限定集合 | 设计只读 Seed Adapter，经现有 Pipeline 逐公司执行 |

其余六个公司级失败名额没有观测数据，不能编造。

## 7. 问题分析

### 错误案例

执行 `AI Product Manager` Canary 后，系统在配置检查阶段返回
`NOT_CONFIGURED`，`liveSearchExecuted=false`，所有候选、验证和岗位计数为 0。

### 原因判断

这是配置和 Company Registry 接入能力缺失，不是 Verification Engine、ATS
Detection 或 Job Extraction 的功能性失败。本轮没有足够证据评价官网识别
准确率或 ATS 覆盖率。

### 建议优化方向

1. 将 Z 盘 Seed 的来源路径和 SHA-256 固化到 Benchmark 清单，并增加 Schema 检查。
2. 配置 LLM Planner 和一个单查询 Search Provider，重新运行 3 家冒烟测试。
3. 由 Codex 设计 Company Registry 只读 Adapter，使公司身份成为 Query
   Planning 的约束，但仍经过 Search、Verification、Extraction 和 SQLite。
4. 3 家测试确认 evidence 与 Portal 分类正确后，再扩大到 20–30 家。
5. 对下一轮保存原始 Provider 尝试、Candidate URL、每公司最终决策和 SQLite
   快照，才能形成可比较的 Golden Benchmark。
6. 只有出现真实 ATS 或官网识别失败样本后，再提出规则调整；不要在本轮修改
   核心 Verification 或 Provider。
