# Persistent Chrome Supervisor

Production discovery runs in one long-lived Node.js process. The Supervisor
owns scheduling, SQLite-backed batch checkpoints, a single browser manager and
one sequential company worker.

```text
Scheduler -> SQLite batch queue -> Company worker -> Persistent Chrome context
```

The browser manager uses Playwright `launchPersistentContext(profileDir)` with
a dedicated automation profile. Never pass a daily Chrome profile or the
default `Google Chrome/User Data` directory. The Supervisor creates an
exclusive lock file inside the profile directory and fails closed if another
Supervisor already owns it.

```powershell
npm.cmd run discover:persistent-supervisor -- `
  --input data/company-registry/golden-seed-companies-current.json `
  --output-dir test-output/persistent-supervisor/cn-100 `
  --database data/lite-job-search.sqlite `
  --profile-dir data/persistent-chrome-worker-profile `
  --batch-id persistent-cn-100 `
  --target-count 100 `
  --max-companies-per-run 100 `
  --search-engine google `
  --search-delay-ms 10000 `
  --search-jitter-ms 4000
```

The same profile directory must not be used by another browser or Worker. A
Baidu or Google CAPTCHA, unusual-traffic, consent, or access-control page opens
that engine's independent provider circuit and stops its search queue. It is
never refreshed, solved, bypassed, or followed by an automatic engine switch.
