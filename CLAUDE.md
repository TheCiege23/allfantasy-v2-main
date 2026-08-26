# AllFantasy — repo instructions

## Sports data providers

The API contracts are committed at `contracts/`:

- `contracts/rolling-insights/`
- `contracts/thesportsdb/`

**Do not call either provider's API to determine a response shape.** Read
`ENDPOINTS.yaml` and `fixtures/` in the relevant contract directory. Unknowns are
tracked in that directory's `GAPS.md` — append to it and ask. Do not probe to
resolve them.

Probing is allowed only via the contract's own `scripts/probe.sh`, only when
adding a new endpoint/sport combination, and the captured fixture must be
committed in the same change. An uncommitted probe gets repeated.

> `fixtures/` is referenced throughout both contracts but is **not yet
> populated**. Until it is, `ENDPOINTS.yaml` is the only committed shape
> authority, and its per-sport `confidence:` field tells you how much to trust
> it — several sports are marked `low` or `none`.

### Credentials

`RSC_token` (Rolling Insights) and the TheSportsDB API key are secrets. They must
never appear in logs, error messages, client responses, or committed fixtures.
Rolling Insights passes its token as a **query parameter**, so naive URL logging
leaks a long-lived credential — redact before logging, and never log a full
request URL.

Env var names have drifted; the codebase does not agree with itself. Before
adding a provider call, grep for the name actually read on the path you are
touching rather than assuming. Observed spellings for the RI token alone:
`ROLLING_INSIGHTS_RSC_TOKEN` (most common), `RSC_TOKEN`,
`ROLLING_INSIGHTS_CLIENT_SECRET`, `ROLLING_INSIGHTS_API_KEY`,
`ROLLING_INSIGHTS_KEY`. Base URL: `ROLLING_INSIGHTS_REST_BASE_URL` (most common),
`ROLLING_INSIGHTS_REST_BASE`, `ROLLING_INSIGHTS_BASE_URL`,
`ROLLING_INSIGHTS_API_BASE`.

The contract's documented names (`RSC_TOKEN`, `ROLLING_INSIGHTS_BASE_URL`) are
**minority spellings in this repo**. Setting only those will silently no-op on
most call paths.

### DB-first boundary

The intended architecture is that application code reads from Postgres and only
ingestion/sync modules call a provider. `scripts/check-db-first-api-boundary.mjs`
enforces this.

**The monitored-host list is NOT a census of our providers — check it before you
assume a provider is watched.** `DATA_API_HOST_PATTERNS` at the top of the guard
is the only authority; a provider absent from it is invisible to the guard no
matter how heavily it is used.

Rolling Insights was added 2026-08-22 (PR #584) and described at the time as "the
last one missing". That was wrong. RI genuinely is the most exposed — it passes
`RSC_token` as a query parameter, so a direct call from a request path leaks a
credential into any URL that gets logged — but it was not the last. CollegeFootballData
(`api.collegefootballdata.com`) was never on the list at all, and it is the **sole**
NCAAF source behind the whole devy/college stack; it was added 2026-08-25.

`api-sports.io`, `api.fantasycalc.com` and `api.openweathermap.org` were added
the same day for the same reason. Two things about `api-sports.io`: it is a
**different vendor** from `api.sportsdata.io`, which was already listed — that
near-collision is how it stayed invisible — and `media.api-sports.io` is
deliberately **excluded**, because an image CDN URL consumed as an `<img src>`
is not a data-API call and matching it reported four test fixtures as violations.

`lib/sports-data-gateway/inventory.ts` is the closest thing to a provider census,
but it is a Phase-5 audit snapshot and is itself incomplete — its
`clientLocations` for CFBD listed three files; there are six.

**The code does not comply yet, and the guard says so.** A full scan reports 95
violations across tracked source (the count drifts — re-run rather than quoting
this number). Nothing is allowlisted to hide them.

### CFBD is the worked example of what compliance looks like

CFBD is at **zero** violations, and it got there by moving surfaces rather than
by allowlisting them. The shape is worth copying:

- `lib/cfb-player-data.ts` is the **adapter** — every export is a live fetch. It
  is allowlisted, but only because its sole runtime importer is the ingestion
  module. That exemption is conditional: `grep -rn "from '@/lib/cfb-player-data'"`
  must show ingestion plus `import type` lines and nothing else.
- `lib/devy-classification.ts` is the **ingestion** layer, writing `DevyPlayer`.
- `lib/devy/devyPlayerReads.ts` is the **DB-first read** layer that request paths
  use. `/api/market-alerts` and `/api/legacy/cfb-players` go through it.
- The ingestion runs on a schedule from `/api/cron/import-players`, bounded by
  the shared run budget, in `devyPool` → `devyStats` → `devyIntel` phases.

**The scheduled writer is the part that is easy to skip and fatal to skip.**
`ingestCFBDStats` existed for months with no scheduled caller, so the DevyPlayer
stat columns were never kept current in production — which is precisely why
`/api/market-alerts` fetched CFBD live instead of reading them. Pointing a
surface at a table nothing refreshes is worse than the live call it replaced: it
fails silently and looks correct. Migrate the read and wire the writer together,
or not at all.

### Remaining debt, triaged

Twelve lines came from the three providers added on 2026-08-25. Three were
resolved (below); **nine remain**, all genuine:

- **Adapters with request-path callers** — `lib/fantasycalc.ts` (two lines; ~30
  direct importers, many under `app/api/`), `lib/api-football.ts`,
  `lib/api-sports.ts`, `lib/openweathermap.ts`,
  `lib/world-cup/apiSportsWorldCup.ts`, `lib/brackets/providers/index.ts`. These
  must NOT be allowlisted the way `lib/cfb-player-data.ts` was — that exemption
  was earned by first moving the callers off them. FantasyCalc already has a
  DB-first path (`lib/fantasycalc-db.ts`, fed by
  `scripts/sync-fantasycalc-valuations.ts`); the work is migrating callers to
  it, which is a project of its own and has not been done.
  ⚠ **Confirm that sync is actually scheduled before pointing anything at
  `fantasycalc-db`.** `ingestCFBDStats` was written, correct, and had no
  scheduled caller for months; the same mistake here would be silent.
- **A service, not an adapter** — `lib/trade-intel/marketValueService.ts:31`
  calls FantasyCalc directly rather than going through `lib/fantasycalc.ts`, so
  migrating the adapter's callers would miss it. It needs its own move.
- **Non-request paths.** Resolved individually, never in bulk:
  - `scripts/compare-player-apis.ts` — hand-run (absent from package.json and
    CI). `compare` joined the scripts verb list next to `audit`, for the reason
    already written there: a comparison tool cannot compare without calling.
  - `lib/admin-dashboard/SystemHealthResolver.ts` — marked
    `db-first-exception: live provider health probe`, which is what its sleeper,
    yahoo and espn entries already carried. FantasyCalc only lacked the marker
    because FantasyCalc was not monitored until today. Line-scoped on purpose:
    allowlisting the file would exempt any future non-probe call in it too.
  - `app/api/start-sit/weather.route.js` — **deleted, not exempted.** It was
    dead: nothing imported it, its own header declared its path as
    `weather/route.js`, and that path now holds a `route.ts` using
    `lib/weather/weatherService`. Next.js does not route a `X.route.js` sitting
    beside the directory. Five identical strays remain in `app/api/start-sit/`
    (`chimmy`, `injuries`, `leagues`, `matchups`, `roster`), each superseded by
    a live directory route; they trip no guard and were left for a deliberate
    dead-code pass.
  - `lib/weather/weatherService.ts:806` — **stays reported.** It is imported by
    six request paths, so it is real debt, not a naming accident. The call
    geocodes an address to lat/lon, and a geocode never changes, which makes it
    an unusually good candidate for a durable cache.

**On `db-first-exception:` for health probes.** The rule above calls the marker
temporary, and a health probe is permanent. The probe is the recognised standing
exception: checking whether a provider is up is the one job that *cannot* be done
by reading Postgres, and the convention predates this note in
`SystemHealthResolver.ts`. That is the only permanent use. Everything else the
marker touches still needs a migration plan.

Treat both contracts' "the app never calls the vendor" line as the **target**
architecture, not a description of current state.

Two consequences worth knowing before you touch provider code:

- CI runs the guard in `--changed` mode, so `main` stays green and only a PR that
  **touches** one of those files is stopped. That is the guard working, not a
  regression you introduced — check whether the violation predates your change.
- `db-first-exception:` silences a line, and is reserved for a **temporary**
  violation with a migration plan. It is not a way past a pre-existing one, and
  widening `ALLOWED_PATH_PATTERNS` is a deliberate per-file decision — the two
  entries there are audited individually on purpose.

### The 304 rule

**What a Rolling Insights `304` means is disputed between two vendor sources and
is currently UNRESOLVED** — see `304_conflict` in
`contracts/rolling-insights/ENDPOINTS.yaml`. The skill repo says it is a cache
artifact to be defeated; the newer OpenAPI spec declares a `NotModified`
component meaning "valid request, empty result set."

Do not wait for that to be settled, and do not make product behaviour depend on
it. The rule is safe under **both** readings:

1. Send no-cache headers and a fresh millisecond cache-buster on every call.
2. Retry once on a 304.
3. Detect change by hashing the payload, never by HTTP status.

If it is a cache artifact, busting defeats it. If it genuinely means empty, you
pay one extra request and no-op on an unchanged hash. Either way you are right.

What is **not** acceptable either way: returning `[]` on a 304 without a
cache-busted retry. That reports "no data" for what may be a cache hit, and it is
indistinguishable from a real empty result.

## Git

The working tree is sometimes shared with concurrent sessions; HEAD can move
underneath you mid-task. Stage explicit paths, never `git add -A`, and verify the
staged set before committing.

**This repo is public.** Secret-scan before every push.
