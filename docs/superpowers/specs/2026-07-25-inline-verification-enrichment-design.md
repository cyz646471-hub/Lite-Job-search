# 浏览器检索同步核验与岗位字段补齐设计

## 背景

当前 Golden Dataset 浏览器批处理完成了 568 家公司的搜索发现，但批次文件只保存搜索结果和候选 URL，没有进入现有的 `discover-market-jobs` 应用流水线。

当前数据审计结果：

- 568 家唯一公司；
- 批次文件含 32 条范围重叠记录，按公司身份去重后不影响 568 家覆盖；
- 88 家发现候选页面，共 97 个候选链接；
- 477 家没有可见候选；
- 3 家搜索失败；
- 448 家有 Golden Dataset 提供的官方域名；
- 地区、开始日期、截止日期和招聘批次的覆盖率均为 0%。

项目现有正式应用流水线已经支持确定性官网验证、ATS 识别、招聘页面角色识别、岗位抽取和 SQLite 写入。缺口是浏览器发现脚本绕过了该流水线。

## 目标

浏览器搜索每发现一个招聘候选页面，即完成以下闭环：

1. 打开候选页面并保存可审计证据；
2. 执行确定性官网或 ATS 验证；
3. 识别招聘入口、招聘活动、岗位列表、岗位详情和投递动作；
4. 仅从验证通过的招聘门户抽取岗位；
5. 提取地区、发布日期、截止日期、招聘批次和投递链接；
6. 逐公司写入 SQLite 和断点报告；
7. 单家公司失败不影响同批次后续公司。

本设计不修改现有 Provider Contract，不重写 Verification Engine，不允许 LLM 决定官网真实性。

## 方案比较

### 方案 A：浏览器发现适配到现有应用流水线（采用）

浏览器脚本只负责获得搜索结果和页面观察，随后把候选与页面数据交给现有 Verification Engine、Job Extraction Adapter 和 Repository。

优点：

- 复用已有确定性验证和证据模型；
- 与 API、Apify 和浏览器来源保持相同业务规则；
- 不复制数据库写入、岗位去重和质量指标逻辑；
- 能逐公司提交事务和断点。

缺点：

- 需要新增浏览器发现结果到应用流水线的适配层；
- 浏览器页面结构和现有 `fetchPage` 数据结构需要统一。

### 方案 B：搜索结束后批量补充核验

继续先保存全部搜索结果，再运行第二个批处理核验。

优点是实现简单；缺点是搜索和核验之间存在断点，运行中断时容易留下大量只有候选 URL 的半成品。因此不采用。

### 方案 C：在浏览器脚本内复制验证与抽取规则

优点是单脚本直观；缺点是形成第二套 Verification Engine 和抽取规则，容易与正式流水线漂移。因此不采用。

## 架构

新增浏览器批次编排层，但不改变核心领域模型：

```text
Company Seed
  -> Browser Search
  -> Candidate URL + Browser Page Observation
  -> Browser Discovery Adapter
  -> Existing Verification Adapter
  -> Verification Engine
  -> Existing Job Extraction Adapter
  -> SQLite Repository
  -> Per-company Checkpoint + Run Report
```

浏览器适配器输出与正式页面抓取器兼容的数据：

- `requestedUrl`
- `finalUrl`
- `title`
- `html` 或受限页面文本
- `links`
- `jobs`（页面有结构化岗位时）
- `fetchStatus`
- `observedAt`

浏览器来源保留为 `discoveryMethod=chrome_baidu_visible_search`，不得计为 API 搜索。

## 官网与 ATS 核验

浏览器发现的候选 URL 不自动成为官方入口。

每个候选继续使用现有确定性证据：

- Golden Dataset 官方域名匹配；
- 企业官网指向招聘页面；
- 已知 ATS 指纹与租户匹配；
- 页面招聘结构；
- 岗位列表；
- 投递动作；
- 公司身份、Logo、版权或站点名称。

以下页面直接拒绝或降级：

- `jobui.com`；
- 高校就业网；
- 新闻、转载、培训机构；
- 无公司主体匹配的聚合平台；
- 广告和搜索引擎内部跳转。

第三方企业主体页只保留为 `THIRD_PARTY_LEAD`，不得标记为官方。

## 招聘批次与岗位字段

字段按照证据层级提取：

### 招聘批次

从明确页面标签、导航或岗位字段提取：

- `campus`：校园招聘、应届生、graduate；
- `internship`：实习、日常实习、暑期实习；
- `experienced`：社会招聘、社招、experienced；
- `special_program`：管培生、专项招聘、博士后等明确活动；
- 未明确时为空。

同一门户可以具有多个招聘类型，存入 `CareerPortal.recruitmentTypes`。岗位自身存在明确类型时，写入 `JobOpening.employmentType`。

### 开始时间

优先级：

1. 岗位明确发布日期；
2. 招聘活动明确启动日期；
3. 否则为空。

爬取时间仅写入 `observedAt`，不得写入开始时间。

### 截止时间

只接受岗位或活动页面明确给出的截止日期、有效期或 `validThrough`。没有明确证据时为空。

### 地区

优先级：

1. 岗位结构化地点字段；
2. 岗位卡片或详情页明确工作地点；
3. 活动页明确适用于全部岗位的地区；
4. 否则为空。

不得使用公司总部地址代替岗位地区。

### 岗位与投递链接

岗位标题必须来自岗位列表或详情页。链接角色保持分离：

`companyCareerHomeUrl -> campaignLandingUrl -> jobListUrl -> jobDetailUrl -> applyUrl`

只在页面存在明确申请动作时填写 `applyUrl`；否则使用已验证的岗位详情或列表页作为可查看入口。

## 缺失值策略

地区、开始日期、截止日期、招聘批次和投递链接没有明确证据时保持空值。

DiscoveryLog 或页面证据记录对应原因：

- `missing_explicit_location`
- `missing_explicit_published_at`
- `missing_explicit_closes_at`
- `missing_explicit_recruitment_type`
- `missing_explicit_apply_action`

禁止从爬取时间、公司地址、URL 路径或模型猜测生成这些值。

## 数据写入与去重

每家公司作为独立事务单元：

1. 合并 Company 与 Alias；
2. 写入验证后的 CareerPortal 和 evidence；
3. 写入 JobOpening；
4. 写入 DiscoveryLog；
5. 写入公司级 checkpoint。

岗位继续使用现有确定性去重键：

`company + normalized title + location`

批次文件的 32 条重叠记录在进入流水线前按公司身份去重。已处理公司通过 checkpoint 和数据库身份跳过。

## 失败处理

- CAPTCHA：保存断点并暂停，不绕过；
- 网络失败：记录 `FAILED`，继续同批次其他公司；
- Provider 失败：保留 Provider 状态，不解释为“没有招聘”；
- 页面受限：记录 `BLOCKED` 或 `REVIEW`；
- 无岗位：只有页面明确为空时记录 `NO_OPENINGS`；
- 抽取结果为空：记录 `no_openings_extracted`，不伪造岗位。

## 测试策略

采用测试驱动开发：

1. 浏览器候选必须进入验证，不得直接变为官方入口；
2. `jobui.com` 始终拒绝；
3. 验证通过后才调用岗位抽取；
4. 明确的岗位地点、发布日期、截止日期和招聘类型被保留；
5. 缺失字段保持空值并产生缺失证据；
6. 浏览器页面的招聘子入口被继续遍历；
7. 单家公司失败不阻止下一家公司；
8. checkpoint 能跳过已完成公司；
9. 批次重叠公司只处理一次；
10. 现有 Provider、CLI 和完整测试保持通过。

## 输出

运行报告必须区分：

- 搜索完成；
- 候选发现；
- 官网验证通过；
- ATS 验证通过；
- 待审核；
- 拒绝；
- 岗位抽取成功；
- 页面没有岗位；
- 字段缺失；
- 网络或浏览器失败。

学生 XLSX 只纳入验证通过的官方/ATS入口。未验证候选、第三方线索和失败页面保留在审核报告，不进入可投递清单。
