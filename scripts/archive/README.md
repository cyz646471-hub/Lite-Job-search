# Archived monitoring entrypoints

The fixed-company browser monitor was archived on 2026-07-29 because it
duplicated the endpoint-first monitoring network and always routed a fixed pool
through the persistent browser supervisor.

Use:

- `npm run monitor:network:prepare` to build the four-lane queue plan;
- `npm run monitor:endpoints` for verified official or ATS endpoints;
- `PORTAL_RECOVERY` only for failed, redirected, or parser-incompatible
  endpoints;
- `MARKET_DISCOVERY` only for companies without a known recruitment endpoint.

The archived scripts remain for auditability and historical replay. They are no
longer exposed as npm commands and must not be used as a production scheduler.
