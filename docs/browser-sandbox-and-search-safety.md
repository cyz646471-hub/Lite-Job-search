# Browser sandbox and search safety

Production discovery uses a dedicated persistent Chrome profile and Playwright
with `chromiumSandbox: true`. `--no-sandbox` and `--disable-setuid-sandbox` are
not production options. They reduce Chromium process isolation and are never a
default response to a launch failure.

The Worker records only non-secret runtime diagnostics: browser channel/version,
headless mode, hashed profile path, sandbox request, and browser-exposed values.
It does not alter user agent, webdriver, language, timezone, display properties,
cookies, or local storage. A requested sandbox setting is recorded as a
Playwright launch configuration; OS-level sandbox enforcement still requires an
environment-specific diagnostic run.

Production search is Baidu-only and sequential. A challenge, CAPTCHA, 429,
unusual-traffic, or access-denied signal opens Baidu's SQLite circuit. The worker stores a
small screenshot, final URL, title, and classified reason; it does not click or
solve challenges, refresh the page, or turn the challenge into an official job
result. Resume occurs only after a person completes the visible Baidu security
verification in the dedicated automation profile, then runs one health probe.

Use `scripts/diagnose-browser-search-challenge.mjs` for a small controlled A/B
comparison. Variant A only records a manual normal-Chrome observation. Variant
B is Playwright with a dedicated profile and sandbox enabled. Variant C is
diagnostic-only sandbox-disabled and must never be used for production searches.
