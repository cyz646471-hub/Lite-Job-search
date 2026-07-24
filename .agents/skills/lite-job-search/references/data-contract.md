# Result data contract

Every normalized result uses these fields:

```json
{
  "market": "CN",
  "company": "Example",
  "title": "Product Intern",
  "location": "Shanghai",
  "employmentType": "internship",
  "publishedAt": null,
  "source": "provider-name",
  "sourceUrl": "https://discovery.example/item",
  "companyCareerHomeUrl": "https://company.example/careers",
  "campaignLandingUrl": null,
  "jobListUrl": "https://company.example/jobs",
  "jobDetailUrl": null,
  "applyUrl": null,
  "officialIdentityConfirmed": true,
  "campaignConfirmed": false,
  "hasJobList": true,
  "hasApplicationAction": false,
  "applicationActive": true,
  "evidence": [],
  "sourceUrls": [],
  "discoveredAt": "ISO-8601"
}
```

## Merge rules

- Never merge across `market`.
- Default job key: market + normalized company + normalized title + normalized location.
- Preserve every distinct `sourceUrl` in `sourceUrls`.
- Prefer the deepest verified recruitment URL without erasing shallower roles.
- Do not turn missing timestamps, locations, identity or application state into positive values.

## Campaign-level consumers

Consumers may additionally group by:

`companyStandardId + cohortYear + recruitmentType`.

Keep individual job rows available for audit even when the display groups multiple roles into one recruitment campaign.

## Role-driven market models

`Company` stores the canonical company name, aliases, official domains, industry tags, and market. A search-result hostname is not automatically an official domain.

`CareerPortal` stores the recruitment URL, ATS type, page type, verification status, confidence score, and deterministic evidence. Only `VERIFIED` portals may own formal openings.

`JobOpening` stores title, company and portal IDs, locations, publication and closing times, detail URL, apply URL, status, and source URL. An unknown publication date remains `null` and is excluded from recent-only totals.

`DiscoveryLog` stores each query, provider, discovery time, result URL, rank, outcome, and bounded metadata. It distinguishes no result from `NOT_CONFIGURED`, budget deferral, fetch failure, review, and rejection.

All four models are persisted in SQLite with stable IDs and idempotent upserts.

## Student XLSX projection

XLSX is a fixed downstream output step after verification and deduplication:

- one row per `JobOpening`, not one row per search result;
- company portals such as ByteDance or Tencent are deduplicated as one portal per canonical URL, while their jobs remain separate rows;
- visible columns are company, role, location, publication date, deadline when known, and apply/detail entry;
- the application entry is an Excel 超链接, choosing `applyUrl` before `jobDetailUrl`;
- evidence, internal IDs, raw metadata, and review/rejection details are hidden or moved out of the student-facing sheet;
- rows without a verified portal are never presented as directly actionable.

The legacy `JobResult` compatibility projection keeps URL roles separate so an XLSX exporter cannot manufacture an apply URL from a list page.

