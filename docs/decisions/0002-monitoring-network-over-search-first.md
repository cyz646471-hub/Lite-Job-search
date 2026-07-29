# ADR-0002：以入口增量监控替代搜索优先采集

日期：2026-07-29
状态：Accepted

## 背景

现有企业库规模已经远高于正式发布岗位规模。搜索引擎和浏览器安全验证会导致大量公司
任务进入延后状态，而已知招聘入口的岗位更新本身并不需要再次执行全网搜索。

## 决策

1. 保留现有领域模型、Verification Engine、Provider Adapter 和 SQLite 仓储。
2. 新增 SourceEndpoint、FetchObservation、JobRevision 和 MonitorPolicy。
3. 将生产任务拆为 `PORTAL_MONITOR`、`PORTAL_RECOVERY`、
   `MARKET_DISCOVERY`、`REVIEW_FEEDBACK` 四条队列。
4. 搜索引擎只服务 `MARKET_DISCOVERY`；其 Circuit 不影响已知入口监控。
5. 招聘状态使用连续观测和岗位版本判断，不用一次失败推断无招聘或岗位关闭。
6. 国内 ATS 的 Adapter 投资顺序由实际数据库覆盖率决定。

## 结果

优点：

- 减少重复搜索和浏览器使用；
- 搜索安全验证不会停止固定池监控；
- 可以基于快照差异发现新增和关闭岗位；
- 失败与“无岗位”保持语义隔离；
- 调度可以吸收审核和用户反馈。

代价：

- SQLite 增加观测历史和调度表；
- 需要维护端点 Adapter 和快照生命周期；
- 新公司发现仍需低频搜索或公共线索；
- 七天稳定性仍必须通过真实运行验证，不能由测试替代。
