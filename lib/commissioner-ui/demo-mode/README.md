# Commissioner OS Demo Mode

Three data modes, one abstraction: **Stub** (developer fixtures), **Demo**
(realistic curated data for sales/screenshots/QA/training), **Live** (the
real Decision OS, once it exists). No module knows which one it's reading
from — every Decision OS client factory (`getDecisionOSClient()` per
module) resolves the active mode and returns the matching implementation.

## How it works

Mode is stored in a cookie (`commissioner_os_data_mode`), read server-side
via `resolveServerDataMode()` — the same pattern already established for
theme (`lib/theme`), not a new mechanism. Default is `demo`, since that's
the mode every non-developer audience should see without configuration.

`DataModeIndicator` (header, dev-only — returns `null` in production) lets
engineering/QA/design switch modes at a glance. Switching triggers a full
page reload rather than a reactive update — an intentional simplification;
mode changes are rare, dev/QA-only actions, not something that needs
instant, non-disruptive switching the way theme does for real users.

## The live placeholder is honest, not fake

`live.ts` never returns fixture data dressed up as real. Every method
returns `{ data: null, error: {...}, source: 'live' }` with a typed
`upstream_unavailable` error, because the real Decision OS backend
doesn't exist yet. A UI consuming `'live'` mode sees an honest absence,
never something that could be mistaken for a real computed fact.

## Migrating a module to Demo Mode

1. Add `demo.ts` (curated data) and `live.ts` (honest placeholder,
   matching `decision-os-client/live.ts`'s pattern) alongside the
   module's existing `stub.ts`.
2. Make the module's client factory `async`, call
   `resolveServerDataMode()`, and switch on the result.
3. Update the one call site (`await getXClient()` instead of
   `getXClient()`). No other UI code changes.

Mission Control was the first migration; its `PreviewDataBanner` also
became mode-aware in the process — a real accuracy bug (it said "stub"
while showing demo data) was caught and fixed during browser verification
of this exact change.
