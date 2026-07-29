# Company Registry

`cn-company-search-seed-v1.json` is the user-maintained mainland China company
discovery queue.

The raw list is preserved verbatim for provenance. `canonicalMappings` contains
only high-confidence duplicate or alias mappings. Group subsidiaries, business
units and recruitment projects remain separate discovery targets until
deterministic domain or ATS evidence proves that they share a `CareerPortal`.

Daily processing must resolve a raw name to its canonical name before checking
SQLite. A company is not permanently complete merely because one search returned
no results. Apply the scheduled cooldown policy:

- verified portal plus completed extraction: 30 days;
- deterministic rejection or no results: 7 days;
- review or browser-blocked: 3 days;
- transient provider/network failure: 1 day.

New entries should be appended to `rawCompanies`, update
`provenance.rawRecordCount`, and add a canonical mapping only when the identity
relationship is supported by evidence.

## Golden company registry

`golden-seed-companies-current.json` is the provenance-preserving source registry.
`golden-seed-companies-merged-current.json` is its deterministic normalized view
for search planning and SQLite registration.

Audit without changing SQLite:

```powershell
node scripts/register-company-registry.mjs `
  --registry data/company-registry/golden-seed-companies-current.json `
  --database data/lite-job-search.sqlite `
  --report test-output/company-registry-registration/dry-run-report.json `
  --normalized-output data/company-registry/golden-seed-companies-merged-current.json
```

After reviewing the report, add `--apply` to register or enrich companies. The
importer merges exact official-domain identities, compatible exact company names,
and domainless incomplete records that resolve to one complete company. It does
not merge different domain-owning group companies, subsidiaries, listed entities,
or brands merely because they share a broad alias.

## Reviewed identity evidence

`config/company-domain-overrides-v1.json` contains reviewed corrections that are
applied before browser query planning. A record may replace an erroneous domain
or prepend a verified parent/careers domain without rewriting raw provenance.

`config/ats-tenant-ownership-v1.json` maps an exact company identity to an exact
ATS tenant URL prefix. ATS vendor detection alone remains neutral; only a
company-name match, ATS match, and URL-prefix match can emit reviewed ownership
evidence. Each record includes its review date and provenance.
