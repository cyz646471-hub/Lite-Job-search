# North America market search

## Preferred discovery paths

1. Reuse a known company career domain or ATS tenant.
2. Query the employer name plus `careers`, `jobs`, `internship`, `university`, or `new grad`.
3. Prefer employer-owned domains and confirmed ATS tenants.
4. Use LinkedIn or Indeed as discovery evidence when no official page is available; do not label ordinary board pages as employer-owned.

## Extracted provider coverage

The engine retains more than 60 Career OP providers. Core North American ATS coverage includes:

- Greenhouse
- Lever
- Ashby
- Workday
- SmartRecruiters
- Teamtailor
- Workable
- iCIMS/Jibe-style career pages
- SuccessFactors
- Phenom

It also retains public remote-job and portfolio seed providers, but those remain discovery sources until the employer or ATS identity is verified.

## Verification

Require a company-domain match or a tenant/company match on the ATS. Inspect the final redirected URL, not only the search-result URL.

Reject or downgrade:

- generic board searches;
- a different employer tenant;
- news, product and investor-relations pages;
- expired or no-longer-accepting postings;
- pages that require bypassing authentication or CAPTCHA.

## Recency

Prefer explicit publication timestamps. If a provider omits the timestamp, keep it null; do not invent a current date. Cache official company roots longer than campaign and vacancy health checks.

