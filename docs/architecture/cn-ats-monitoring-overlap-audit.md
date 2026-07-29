# China ATS monitoring overlap audit

Date: 2026-07-29

## Reused components

- The page-provider registry remains the single static HTML and hydration-state
  dispatch point.
- `_cn-ats.mjs` remains the shared China ATS parser.
- `dynamic-recruitment-site-adapter.mjs` remains the browser fallback parser for
  structured JSON and visible job-detail links.
- Existing deterministic portal verification remains authoritative. The new
  adapters do not decide company ownership.
- `SourceEndpoint`, `FetchObservation`, `JobRevision`, `MonitorPolicy`, and the
  four-lane planner remain the monitoring network foundation.

No production provider contract under `engine/upstream/providers/**` was
changed.

## Added coverage

- Moka: `mokahr.com` and `mokahr.cn`.
- Beisen, Zhiye, iTalent: `beisen.com`, `beisencloud.com`, `zhiye.com`, and
  `italent.cn`.
- Feishu Recruitment: `jobs.feishu.cn` and `jobs.bytedance.com`.
- Hotjob: existing adapter retained.
- Moseeker: `moseeker.com` and `moseeker.cn`.
- Current self-hosted job-producing domains: Xiaohongshu and iQiyi use named
  profiles over the existing embedded JSON and link fallback. No undocumented
  private API URL is invented.

## Archived overlap

The old fixed-pool browser monitor duplicated `PORTAL_MONITOR` and sent known
verified endpoints back through the browser supervisor. Its scripts are
preserved under `scripts/archive/`, but its npm commands are removed.

## Queue boundary

- `PORTAL_MONITOR`: direct conditional HTTP/ATS checks for verified endpoints.
- `PORTAL_RECOVERY`: redirects, endpoint failures, blocks, or parser failures.
- `MARKET_DISCOVERY`: only unknown companies and unknown recruitment entries.
- `REVIEW_FEEDBACK`: user invalidation, review tasks, and re-verification
  signals.

A search-engine circuit may defer only `MARKET_DISCOVERY`. It does not stop
known official endpoint monitoring. Browser recovery does not bypass CAPTCHA or
other access controls.
