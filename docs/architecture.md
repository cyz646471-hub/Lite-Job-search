# 架构说明

## 分层

`src/` 是稳定层，负责统一数据契约、搜索路由、缓存、预算、市场工作流、CLI 和导出。调用方应优先使用这里的接口。

`engine/upstream/` 是功能等价层，保留 Career OP 的 provider、ATS 解析、搜索评分、身份验证和页面下钻实现。保持原有相对路径可降低抽取过程的改名回归风险。

`.agents/skills/lite-job-search/` 是模型交互层。Skill 只描述决策边界和 CLI 调用，不要求模型加载完整引擎。

## 数据流

```text
聚合源 / 搜索服务 / ATS
          ↓
统一 SearchRouter（缓存、预算、故障切换）
          ↓
CN / NA 候选评分
          ↓
企业身份与 ATS 租户验证
          ↓
CAREER_HOME / CAMPAIGN / JOB_LIST / JOB_DETAIL / APPLY
          ↓
去重、审计、JSON / JSONL / CSV
```

岗位驱动的新入口采用旁路升级，不改写旧 Provider：

```text
SearchIntent（岗位、行业、时间、数量）
          ↓
LLM：关键词扩展与 Query 规划（无验证权）
          ↓
SearchRouter → Company 候选与 DiscoveryLog
          ↓
受限 HTTP 抓取 → 确定性 Verification Engine
          ↓
Company → VERIFIED CareerPortal → recent JobOpening
          ↓
SQLite → legacy JobResult / student XLSX compatibility projection
```

验证引擎的证据码、方向和权重由程序固定。候选 URL 自身域名是中性证据；聚合、高校、新闻、培训和身份冲突是硬拒绝。LLM 对 `REVIEW` 页面只能附加权重为 0 的 advisory。

SQLite Repository 在写入 `JobOpening` 前再次检查关联 `CareerPortal.verificationStatus === VERIFIED`，形成应用层和存储层双重门禁。未知发布时间不会通过近期窗口判断。

## 同步 Career OP

`config/extraction-manifest.json` 声明入口文件、动态 provider 目录和排除项。

```powershell
npm.cmd run sync:career-ops -- --source C:\path\to\career-ops
```

同步脚本：

1. 解析静态和字面量动态 import；
2. 计算传递依赖闭包；
3. 拒绝越过源仓库边界的相对导入；
4. 复制白名单 provider 目录；
5. 为每个文件保存 SHA-256；
6. 生成不含本机路径和时间戳的确定性清单。

`engine/manifest.json` 可用于审计来源与变化，不作为运行数据库。

## 功能归属

Lite Job Search 负责：

- 公开岗位与招聘项目发现；
- 官方入口与 ATS 识别；
- 页面角色和有效性验证；
- 去重、缓存、预算和导出。

Career OP 继续负责：

- 学生/用户画像；
- 岗位匹配与优先级；
- CV、求职信和材料；
- 申请、面试、跟进与薪酬分析。

## 兼容策略

首次拆分不删除 Career OP 的原文件。现有命令继续运行；新自动化可逐步改为调用 Lite Job Search。完成一段时间的等价运行后，再考虑将 Career OP 内部检索改成包依赖。
