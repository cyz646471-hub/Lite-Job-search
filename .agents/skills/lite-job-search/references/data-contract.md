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

