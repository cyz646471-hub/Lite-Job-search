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
