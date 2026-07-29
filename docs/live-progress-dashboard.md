# LJS 实时进度看板

本地控制面的首页用于查看当前采集任务的实时进度：

```powershell
npm.cmd run web -- `
  --database data/lite-job-search.sqlite `
  --port 4317 `
  --xlsx test-output/full-recheck/final-student-applications.xlsx
```

打开 `http://127.0.0.1:4317`。页面每 10 秒自动刷新一次。

进度口径明确区分：

- 已处理：`SUCCEEDED`、`FAILED` 和 `DEFERRED`；
- 已经装载到当前短批次但尚未完成的公司；
- 属于任务目标、但尚未装载到短批次的公司。

因此，即使一个 1,000 家公司的任务暂时只装载了 10 家，看板也不会将其
误报为接近完成。页面同时展示当前公司、Worker 心跳、最近失败、失败原因、
搜索引擎断路器、已验证招聘入口和已抽取岗位总数。

相同的有界快照可以通过 JSON API 获取：

```text
GET /api/progress
GET /api/progress?batch_id=<batch-id>
```
