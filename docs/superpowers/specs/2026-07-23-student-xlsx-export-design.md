# 学生投递 XLSX 自动导出设计

## 目标

在中国和北美招聘工作流中，只要 CLI `batch` 或 `verify` 写出结果文件，就自动生成同目录的学生版 XLSX。显式执行 `export --format xlsx` 时也生成同一结构的工作簿。

## 触发与命名

- `batch --output <file>`：保留既有主输出，并额外生成 `<basename>.student.xlsx`。
- `verify --output <file>`：保留既有主输出，并额外生成 `<basename>.student.xlsx`。
- `export --format xlsx --output <file>`：直接生成指定 XLSX，不再额外派生第二个文件。
- 未提供 `--output` 的只读标准输出命令不创建文件。

## 学生视图

工作簿只包含一个名为“投递清单”的工作表，展示以下列：

1. 公司
2. 市场
3. 招聘批次或岗位
4. 地点
5. 启动或发布时间
6. 岗位方向
7. 投递入口
8. 投递状态

“投递入口”显示为“查看职位并投递”，并使用 Excel 原生超链接。URL 选择严格按以下优先级：`applyUrl`、`jobDetailUrl`、`jobListUrl`、`campaignLandingUrl`、`companyCareerHomeUrl`。

## 数据边界

- 不向学生视图暴露 `sourceUrl`、`sourceUrls`、`evidence`、内部验证原因、抓取时间或原始来源等审计字段。
- JSON、JSONL 与 CSV 的现有输出行为保持不变，继续承担审计与机器处理用途。
- 没有有效投递链接时，入口单元格为空；不得以来源页或聚合平台链接替代。
- 状态以现有 `applicationActive`、`officialIdentityConfirmed` 与 `campaignConfirmed` 派生，不能将未知状态显示为“在招”。

## 工作簿可用性

- 冻结标题行，启用筛选，日期使用 `yyyy-mm-dd` 格式。
- 对公司、岗位方向和状态使用可读的中文标签；长文本自动换行，列宽受限以避免横向溢出。
- 生成后检查数据行数、超链接数量和关键区域渲染；不得出现公式错误或截断的标题。

## 验证

- 为 URL 优先级、空链接、CN/NA 混合记录和自动副产物命名新增回归测试。
- 在真实 100 家中国招聘数据上导出一次，并验证学生表仅含指定字段、链接可点击、行数与输入一致。
