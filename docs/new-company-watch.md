# 新增公司发现与持续岗位监控

新增公司清单使用本地文件 `data/company-registry/new-company-watchlist.json`。文件被
`.gitignore` 排除，避免把个人或运行时清单提交到仓库。

```json
{
  "companies": [
    {
      "company": "示例科技",
      "market": "CN",
      "industry": ["AI"],
      "aliases": ["Example Tech"],
      "officialDomain": "example.com",
      "source": "manual_watchlist",
      "addedAt": "2026-07-29T00:00:00.000Z"
    }
  ]
}
```

先生成待处理队列：

```powershell
npm.cmd run watch:new-companies:prepare -- `
  --watchlist data/company-registry/new-company-watchlist.json `
  --database data/lite-job-search.sqlite `
  --stale-days 3 `
  --target-count 50
```

执行一次浏览器 Worker：

```powershell
npm.cmd run watch:new-companies -- `
  --watchlist data/company-registry/new-company-watchlist.json `
  --database data/lite-job-search.sqlite `
  --profile-dir data/browser-profiles/career-op-main `
  --stale-days 3 `
  --target-count 50 `
  --max-companies-per-run 50
```

队列规则：

1. 未入库公司优先走官方入口发现；
2. 已入库但没有已验证官方入口的公司在过期后重新发现；
3. 已验证官方入口的公司仅访问该入口增量抽取岗位，不重复全网搜索；
4. 新近检查的公司默认跳过，`--include-fresh` 才强制重查；
5. 搜索挑战会保留 `DEFERRED` 断点，不能绕过验证码或把失败当成无招聘。

可通过 Windows 任务计划程序按天调用上述单次命令；不要启动多个 Worker 共用同一
浏览器 Profile。
